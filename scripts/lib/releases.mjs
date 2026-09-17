// scripts/lib/releases.mjs
// Release planning: the `release` verb, and the two readings every surface renders from.
//
// A release is a NAMED GROUPING the agent declares — an id, intent prose, an optional target,
// and the epics deliberately cut from it. The engine records and renders it and proposes
// nothing: no epic is ever auto-assigned, and no membership changes because an epic was added,
// re-prioritized or archived. That restraint is the requirement, not an implementation detail —
// a grouping the engine guesses at is a second opinion about scope, and the scope judgment is
// exactly what this capability exists to preserve.
//
// Membership is recorded ONE-WAY, as `epic.release` (at most one). A member list on the release
// PLUS a pointer on the epic is two records of one fact, and two records of one fact disagree;
// there is only one here, so the disagreement is not expressible.
//
// One-directional dependencies only: constants → disposition → (add-epic's parseFlags, state,
// render), the same chain update-epic.mjs walks.

import { escapeControls, findRelease, releaseLine, releaseMembers, releaseSummaries } from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { releaseDeferral, releaseDeferralError } from "./disposition.mjs";
import {
  CROSS_SPEC_MIN_SPECS, KNOWN_CROSS_SPEC_VERDICTS, crossSpecLine, crossSpecRequired,
  releaseSpecFiles, specDigest,
} from "./cross-spec-review.mjs";

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** The LAST string value of a flag that may have parsed as an array.
 *
 *  `--intent` is in parseFlags' repeatable set because it is ALSO set-tracker's flag, and that
 *  set is a global union across every subcommand rather than a per-verb list. So `--intent`
 *  arrives here as `["…"]` whatever this verb wants. A release has one intent, so the last
 *  value wins — which is also what a non-repeatable flag would have done. */
const lastStr = (v) => {
  const all = [].concat(v === undefined ? [] : v).filter(x => typeof x === "string");
  return all.length ? str(all[all.length - 1]) : undefined;
};

const die = (msg) => { process.stderr.write(`conductor: ${msg}\n`); process.exit(1); };

/** The positional that names the READ form rather than a release. RESERVED as an id, and the
 *  write path refuses it by name: a keyword resolved by guesswork ("is `show` an id or a verb
 *  here?") is exactly the ambiguity this engine refuses everywhere else. A release genuinely
 *  called `show` is not a thing anyone needs; a deterministic answer is. */
const SHOW = "show";

/** `<epicId>[:<reason>]`, with `--reason "<why>"` as the out-of-band form — gh#179.
 *
 *  FIRST COLON, which is `--deferral`'s rule and correct here for the identical reason: the left
 *  half is an epic id and an epic id cannot contain a colon, so a reason keeps every colon it
 *  carries. `--declined-deferral`'s `::` exists because BOTH of its halves are free text; that
 *  is not this shape, and copying `::` here would be a third spelling of one concept rather than
 *  a second.
 *
 *  Supplying the reason BOTH ways is REFUSED rather than resolved. Last-wins would silently pick
 *  one of two things a caller wrote deliberately, and the record it writes is the reason. */
function epicReasonPair(flagName, raw, outOfBand) {
  const value = str(raw);
  if (value === undefined) die(`--${flagName} requires an epic id`);
  const at = value.indexOf(":");
  if (at === -1) return { epic: value, reason: outOfBand };
  if (outOfBand !== undefined) {
    die(`--${flagName} "${value}" carries its reason inline AND --reason "${outOfBand}" was ` +
      "given — two reasons for one record. Say which: drop --reason, or drop the inline half. " +
      "Nothing was written.");
  }
  return { epic: value.slice(0, at).trim(), reason: str(value.slice(at + 1)) };
}

/** One entry in a release's `amendments[]` — the audit trail the two INVERSES write (gh#178).
 *
 *  It is NOT a second membership record and cannot become one: membership stays derived from
 *  `epic.release`, and nothing reads this array to decide who is in a release. What it holds is
 *  the judgment a removal carried, which is the half that used to vanish — `--member`'s implicit
 *  undefer announced the deferral it deleted on stderr and stored nothing, so the reason survived
 *  exactly as long as the terminal scrollback did. */
const amend = (rel, entry) => {
  if (!Array.isArray(rel.amendments)) rel.amendments = [];
  rel.amendments.push({ ...entry, at: new Date().toISOString() });
};

/** `release <id> --intent "<prose>" [--target <t>] [--member <epicId>]… [--defer <epicId>[:<why>]]
 *  [--unmember <epicId>[:<why>]] [--undefer <epicId>[:<why>]]` — create or amend a release,
 *  associate epics with it, record an exclusion with its required reason, and UNDO either of the
 *  last two. `release show [<id>]` is the read form and lives in releaseShow() below. */
export function release() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  // THE READ FORM, dispatched before anything else parses. `show` is a reserved positional (see
  // SHOW above), so this branch is unambiguous and the write path below can never see that id.
  if (argv[0] === SHOW) { releaseShow(argv.slice(1)); return; }
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    process.stderr.write("conductor: release requires a release id as its first POSITIONAL argument\n");
    process.stderr.write("usage: conductor.mjs release <id> [--intent \"<what this release is for>\"] [--target <t>] [--member <epicId>]... [--defer \"<epicId>:<why it was cut>\"] [--unmember \"<epicId>:<why>\"] [--undefer \"<epicId>:<why>\"]\n");
    process.stderr.write("       conductor.mjs release show [<id>]   — READ it back: intent, target, derived members, deferrals, the cross-spec verdict and any amendments\n");
    process.exit(1);
  }
  // Undeclared flags were refused before dispatch by the pre-dispatch command-line check (lib/argv-surface.mjs).
  const f = parseFlags(argv.slice(1));
  // #149 — one rule for every value-bearing flag, from the registry. A valueless `--target` or
  // `--member` was dropped by str()/lastStr() and the release was written without it; only
  // `--reason` had a check of its own, and only because a deferral demands one.
  requireFlagValues("release", f);

  const state = loadState();
  if (!Array.isArray(state.releases)) state.releases = [];
  const intent = lastStr(f.intent);
  const target = str(f.target);

  let rel = findRelease(state, id);
  if (!rel) {
    // A release with no intent prose is an id nobody can read six months later, which is the
    // failure this whole capability exists to end. So creation DEMANDS it, and the same refusal
    // covers "you named a release that does not exist" — those are one condition, not two.
    if (intent === undefined) {
      process.stderr.write(
        `conductor: release '${id}' does not exist — create it first with ` +
        `\`release ${id} --intent "<what this release is for>"\`. Nothing was written.\n`);
      process.exit(1);
    }
    rel = { id, intent, deferred: [] };
    if (target !== undefined) rel.target = target;
    state.releases.push(rel);
  } else {
    if (intent !== undefined) rel.intent = intent;
    if (target !== undefined) rel.target = target;
    if (!Array.isArray(rel.deferred)) rel.deferred = [];
  }

  const knownEpic = (epicId) => state.epics.find(e => e.id === epicId) || null;

  // --member: associate epics, one-way. Validated against the real epic list — a membership
  // pointer to an id that does not exist renders as a member of nothing and is unfindable.
  const members = [].concat(f.member === undefined ? [] : f.member).filter(v => typeof v === "string");
  if (f.member !== undefined && !members.length) {
    process.stderr.write("conductor: --member requires an epic id\n"); process.exit(1);
  }
  for (const epicId of members) {
    if (!knownEpic(epicId)) {
      process.stderr.write(`conductor: --member '${epicId}' is not a known epic id. Nothing was written.\n`);
      process.exit(1);
    }
  }

  // THE THREE REASON-BEARING FLAGS, parsed through ONE helper (gh#179). `--defer` excludes an
  // epic; `--unmember` and `--undefer` are the two inverses gh#178 reports missing. Each takes
  // `<epicId>[:<reason>]` inline or an out-of-band `--reason`, and each REQUIRES its reason —
  // a removal recorded with none is indistinguishable from one nobody decided, which is the
  // silence the required reason exists to remove.
  const outOfBand = str(f.reason);
  const reasonFlags = ["defer", "unmember", "undefer"].filter(k => f[k] !== undefined);
  // ONE `--reason` cannot serve two records. Refused rather than copied into both: a reason
  // silently attached to a record nobody wrote it for is the exact defect that keeps `--defer`
  // non-repeatable.
  if (reasonFlags.length > 1 && outOfBand !== undefined) {
    process.stderr.write(
      `conductor: --reason cannot serve --${reasonFlags.join(" and --")} in one invocation — ` +
      "one reason, one record. Give each its own inline reason: " +
      `--${reasonFlags[0]} "<epicId>:<why>". Nothing was written.\n`);
    process.exit(1);
  }

  const deferred = f.defer !== undefined ? epicReasonPair("defer", f.defer, outOfBand) : undefined;
  const unmember = f.unmember !== undefined ? epicReasonPair("unmember", f.unmember, outOfBand) : undefined;
  const undefer = f.undefer !== undefined ? epicReasonPair("undefer", f.undefer, outOfBand) : undefined;

  // ONE epic, ONE operation per invocation. This used to be a single `members.includes(deferEpic)`
  // test; the two new flags are the sibling call sites that check would not have covered, and an
  // epic both added and removed in one write is a contradiction whichever pair expresses it.
  const named = [
    ...members.map(e => ({ flag: "member", epic: e })),
    ...(deferred ? [{ flag: "defer", epic: deferred.epic }] : []),
    ...(unmember ? [{ flag: "unmember", epic: unmember.epic }] : []),
    ...(undefer ? [{ flag: "undefer", epic: undefer.epic }] : []),
  ];
  for (const one of named) {
    const others = named.filter(o => o.epic === one.epic && o.flag !== one.flag);
    if (others.length) {
      process.stderr.write(
        `conductor: '${one.epic}' cannot be both --${one.flag} and --${others[0].flag} of ` +
        `'${id}' in one invocation — say which one it is. Nothing was written.\n`);
      process.exit(1);
    }
  }

  if (deferred) {
    if (!knownEpic(deferred.epic)) {
      process.stderr.write(`conductor: --defer '${deferred.epic}' is not a known epic id. Nothing was written.\n`);
      process.exit(1);
    }
    const derr = releaseDeferralError({ epic: deferred.epic, reason: deferred.reason });
    if (derr) { process.stderr.write(`conductor: ${derr}\n`); process.exit(1); }
  }

  // --unmember: the inverse of --member. It is NOT --defer wearing another name: --defer records
  // an EXCLUSION (this epic was considered and cut, and it stays in the backlog), where this says
  // the pointer should never have been there — the `remove-epic` analogue at release scope. Both
  // clear the pointer; only one leaves a deferral behind.
  if (unmember) {
    const epic = knownEpic(unmember.epic);
    if (!epic) {
      process.stderr.write(`conductor: --unmember '${unmember.epic}' is not a known epic id. Nothing was written.\n`);
      process.exit(1);
    }
    if (unmember.reason === undefined) {
      process.stderr.write(
        `conductor: --unmember requires a reason — why '${unmember.epic}' does not belong to ` +
        `'${id}': --unmember "${unmember.epic}:<why>" (or --reason "<why>"). A membership removed ` +
        "with no reason is indistinguishable from one nobody decided. Nothing was written.\n");
      process.exit(1);
    }
    // The SIBLING GUARD, and the one a removal path most needs: without it `--unmember` on an
    // epic that belongs to a DIFFERENT release deletes that release's pointer while reporting
    // success against this one.
    if (epic.release !== id) {
      process.stderr.write(
        `conductor: '${unmember.epic}' is not a member of '${id}' — ` +
        `${epic.release ? `it belongs to '${epic.release}'` : "it belongs to no release"}. ` +
        "Nothing was written.\n");
      process.exit(1);
    }
  }

  // --undefer: the inverse of --defer. The exclusion it removes carried a recorded judgment, so
  // the removal keeps it (`was`) alongside the reason for pulling the epic back into scope. It
  // does NOT make the epic a member — that is `--member`, a separate decision.
  if (undefer) {
    if (!knownEpic(undefer.epic)) {
      process.stderr.write(`conductor: --undefer '${undefer.epic}' is not a known epic id. Nothing was written.\n`);
      process.exit(1);
    }
    if (undefer.reason === undefined) {
      process.stderr.write(
        `conductor: --undefer requires a reason — why '${undefer.epic}' is back in scope for ` +
        `'${id}': --undefer "${undefer.epic}:<why>" (or --reason "<why>"). Nothing was written.\n`);
      process.exit(1);
    }
    if (!rel.deferred.some(d => d && d.epic === undefer.epic)) {
      process.stderr.write(
        `conductor: '${undefer.epic}' is not deferred from '${id}' — there is no exclusion to ` +
        "remove. Nothing was written.\n");
      process.exit(1);
    }
  }

  // Validate EVERY member and the deferral before writing ANY of them, so a typo in the third
  // `--member` cannot leave the first two associated and the command reporting a failure.
  for (const epicId of members) {
    const wasDeferred = rel.deferred.find(d => d && d.epic === epicId);
    if (wasDeferred) {
      rel.deferred = rel.deferred.filter(d => !d || d.epic !== epicId);
      process.stderr.write(
        `conductor: '${epicId}' was deferred from '${id}' — that record is now removed ` +
        `(it read: ${wasDeferred.reason})\n`);
      // THE SIBLING CALL SITE. `--member` has been performing an implicit undefer since the verb
      // shipped, announcing the deleted judgment on stderr and storing nothing — so recording the
      // explicit `--undefer` here and not this one would be the absent-edit-at-a-sibling-site
      // class this repository names as its dominant defect. `via` says which path removed it and
      // NO `reason` is invented: `--member` demands none, and a fabricated one would be worse
      // than the absence.
      amend(rel, { op: "undefer", epic: epicId, was: wasDeferred.reason, via: "member" });
    }
    knownEpic(epicId).release = id;
  }

  if (deferred) {
    // An excluded epic stays in the backlog. Exclusion is a scoping call about THIS release and
    // never an ending: nothing here touches the epic's status or writes it a disposition. What
    // it does clear is membership — an epic cannot be in a release it was cut from.
    const epic = knownEpic(deferred.epic);
    if (epic.release === id) delete epic.release;
    const record = releaseDeferral({ epic: deferred.epic, reason: deferred.reason });
    const at = rel.deferred.findIndex(d => d && d.epic === deferred.epic);
    if (at === -1) rel.deferred.push(record); else rel.deferred[at] = record;
  }

  if (unmember) {
    delete knownEpic(unmember.epic).release;
    amend(rel, { op: "unmember", epic: unmember.epic, reason: unmember.reason });
    process.stderr.write(
      `conductor: '${unmember.epic}' is no longer a member of '${id}' — ${unmember.reason}. ` +
      "It keeps its place in the backlog; nothing about the epic itself changed.\n");
  }

  if (undefer) {
    const was = rel.deferred.find(d => d && d.epic === undefer.epic);
    rel.deferred = rel.deferred.filter(d => !d || d.epic !== undefer.epic);
    amend(rel, { op: "undefer", epic: undefer.epic, reason: undefer.reason, was: was && was.reason });
    process.stderr.write(
      `conductor: '${undefer.epic}' is no longer deferred from '${id}' — ${undefer.reason} ` +
      `(the exclusion read: ${was && was.reason}). It is NOT a member: say so with --member.\n`);
  }

  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: release '${id}' — ${releaseLine(releaseSummaries(state, state.epics).find(s => s.id === id))}`,
    unchanged: `conductor: release '${id}' already held exactly what this invocation supplied — ` +
      `${STATE_UNCHANGED}`,
  });
}

// ─────────────────── the READ form (gh#178) ───────────────────

/** `release show [<id>]` — render a release back, or list them all.
 *
 *  WHY THIS EXISTS. `release` was a write verb with no reader, so the only way to inspect what a
 *  release held was to open `.conductor/state.json` by hand — and what a hand-reader found there
 *  was actively misleading: `deferred[]` sits ON the release object while membership does not,
 *  because membership is DERIVED from `epic.release` (see the one-way note at the top of this
 *  file). A release with six members and two exclusions therefore reads, in the raw record, as
 *  "two exclusions and no members" — the opposite of the truth.
 *
 *  Deriving membership stays right; the gap was that nothing ever PRESENTED the derived view.
 *  This does, and it is the only place the two halves appear together.
 *
 *  A PURE READ: no `saveState()`, no `render()`. Both would rewrite files for an inspection, and
 *  the second would make `PROJECT.md`'s mtime a function of who looked at what.
 */
export function releaseShow(rest) {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const flags = rest.filter(t => typeof t === "string" && t.startsWith("--"));
  if (flags.length) {
    die(`release show is the READ form and takes no flags (got ${flags.join(", ")}). ` +
      `\`${SHOW}\` is RESERVED as the read keyword, so it cannot also name a release — which is ` +
      "the point: a positional that means one thing here and another there is resolved by " +
      "guesswork, and this engine resolves nothing by guesswork. Name the release something else.");
  }
  if (rest.length > 1) {
    die(`release show takes at most one release id (got ${rest.length}: ${rest.join(", ")})`);
  }
  const state = loadState();
  const epics = Array.isArray(state.epics) ? state.epics : [];
  const releases = Array.isArray(state.releases) ? state.releases : [];
  const id = rest[0];

  // THE LIST. Same `releaseLine()` + `crossSpecLine()` every other surface renders, so the three
  // cannot disagree about how many epics a release holds.
  if (id === undefined) {
    if (!releases.length) {
      process.stdout.write(
        "conductor: no releases are declared in this repo. Declare one with " +
        "`release <id> --intent \"<what this release is for>\"`.\n");
      return;
    }
    const out = [`conductor: ${releases.length} release${releases.length === 1 ? "" : "s"}:`];
    for (const r of releaseSummaries(state, epics)) {
      out.push(`  • ${releaseLine(r)}${crossSpecLine(state, epics, r.id)}` +
        `${r.intent ? ` — ${r.intent}` : ""}${r.target ? ` (target: ${r.target})` : ""}`);
    }
    out.push("  Read one back with `release show <id>`.");
    // One entry per line: escaping each is what keeps a stored id, intent or target on its line.
    process.stdout.write(out.map(escapeControls).join("\n") + "\n");
    return;
  }

  const rel = findRelease(state, id);
  if (!rel) {
    // A release that does not exist is NOT a release with nothing in it, and rendering an empty
    // object for one would be the same confusion this verb exists to end.
    die(`release '${id}' does not exist. ` +
      (releases.length
        ? `Declared here: ${releases.map(r => `'${r.id}'`).join(", ")}.`
        : "No releases are declared in this repo yet."));
  }

  const members = releaseMembers(epics, id);
  const deferred = Array.isArray(rel.deferred) ? rel.deferred : [];
  const amendments = Array.isArray(rel.amendments) ? rel.amendments : [];
  const out = [`conductor: release \`${rel.id}\`${rel.intent ? ` — ${rel.intent}` : ""}`];
  out.push(`  target: ${rel.target || "—"}`);
  out.push(`  members (${members.length}) — derived from \`epic.release\`, never stored on the release:`);
  if (!members.length) out.push("    (none)");
  for (const e of members) {
    out.push(`    • \`${e.id}\`${e.title ? ` — ${e.title}` : ""} · ${e.status || "?"}` +
      `${e.priority ? ` · ${e.priority}` : ""}`);
  }
  out.push(`  deferred (${deferred.length}):`);
  if (!deferred.length) out.push("    (none)");
  for (const d of deferred) {
    out.push(`    • \`${d.epic}\` — ${d.reason}${d.recordedAt ? ` (${d.recordedAt})` : ""}`);
  }
  // The release-scope gate's verdict, in the SHARED wording — including its `⚠ no cross-spec
  // review (N specs)` when the gate applies and nothing was recorded, because silence and
  // reviewed-and-clean must not look the same here either.
  //
  // The helper's output is a SUFFIX (` · <something>`) with THREE shapes: the verdict, that ⚠,
  // and `""` where the gate does not apply. Only the leading separator is stripped — an earlier
  // version stripped ` · cross-spec`, which matched the verdict shape alone and rendered the ⚠ as
  // `cross-spec review: · ⚠ no cross-spec review (2 specs)`: a doubled label and a stray
  // separator, on precisely the warning gh#126 shipped to make unmissable.
  const cross = crossSpecLine(state, epics, id);
  out.push(cross ? `  ${cross.replace(/^ · /, "")}` : "  cross-spec review: — (below the gate's threshold)");
  if (amendments.length) {
    out.push(`  amendments (${amendments.length}):`);
    for (const a of amendments) {
      const via = a.via ? ` (via --${a.via})` : "";
      const was = a.was ? ` [it read: ${a.was}]` : "";
      out.push(`    • ${a.op} \`${a.epic}\`${via} — ${a.reason || "no reason given"}${was}` +
        `${a.at ? ` (${a.at})` : ""}`);
    }
  }
  process.stdout.write(out.map(escapeControls).join("\n") + "\n");
}

// ─────────────────── the RELEASE-scope review gate (gh#126) ───────────────────

/**
 * `record-cross-spec-review <releaseId> --verdict pass|fail [--reviewer "<identity>"]`
 *
 * Records the RELEASE-scope review's verdict: do these specs agree with each other? Gate 1 and
 * Gate 2 each take one CHANGE as their unit, so nothing above them asked the cross-document
 * question until this verb existed.
 *
 * The EVIDENCE is engine-derived and never agent-asserted. The verb enumerates the release's
 * spec set from disk and hashes each file it read; a spec list supplied by the party being
 * reviewed is a list typed from memory, and it goes stale the moment a capability is added —
 * which is the exact staleness this record exists to detect.
 *
 * pm stays an INSTRUCTION layer here: nothing in this verb performs a review, dispatches a
 * reviewer or reads a spec's prose. It records what a reviewer concluded, with evidence a later
 * reader can check.
 */
export function recordCrossSpecReview() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  // Undeclared flags were refused before dispatch by the pre-dispatch command-line check (lib/argv-surface.mjs), reading this verb's two
  // registry rows — the same shared entries `record-gate-review` declares.
  // #149 — the fifth write surface. A valueless `--reviewer` recorded the cross-spec verdict
  // with no reviewer identity at all, which is exactly what that field exists to prevent.
  requireFlagValues("record-cross-spec-review", f);
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  const reviewer = typeof f.reviewer === "string" ? f.reviewer : undefined;
  if (!id || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-cross-spec-review <releaseId> --verdict pass|fail " +
      "[--reviewer \"<identity>\"]\n");
    process.exit(1);
  }
  if (!KNOWN_CROSS_SPEC_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_CROSS_SPEC_VERDICTS.join("|")}\n`);
    process.exit(1);
  }

  const state = loadState();
  const rel = findRelease(state, id);
  if (!rel) {
    process.stderr.write(
      `conductor: release '${id}' does not exist — create it first with ` +
      `\`release ${id} --intent "<what this release is for>"\`. Nothing was written.\n`);
    process.exit(1);
  }

  const specs = releaseSpecFiles(state, state.epics, id);
  // Below the threshold the gate does not apply, and a verdict about a question nobody needed to
  // ask is a record that reads as coverage. Refused rather than stored: Gate 1 covers a single
  // spec completely.
  if (!crossSpecRequired(specs)) {
    process.stderr.write(
      `conductor: release '${id}' has ${specs.length} spec file(s) — the cross-spec gate applies ` +
      `at ${CROSS_SPEC_MIN_SPECS} or more, and Gate 1 covers a single spec completely. ` +
      `Nothing was written.\n`);
    process.exit(1);
  }

  const recorded = [];
  const unreadable = [];
  for (const s of specs) {
    const sha256 = specDigest(s.abs);
    if (sha256 === null) unreadable.push(s.key); else recorded.push({ key: s.key, sha256 });
  }
  // A `pass` MUST carry evidence for every spec in the set, exactly as a passing gate verdict
  // must carry the range it covered. A digest the engine could not compute is a spec whose later
  // amendment would be undetectable, so the pass it licenses is unfalsifiable. A `fail` may be
  // recorded regardless: there is nothing for it to have covered.
  if (verdict === "pass" && unreadable.length) {
    process.stderr.write(
      `conductor: cannot record a 'pass' for '${id}' — these spec file(s) could not be read, so ` +
      `no digest covers them and a later amendment would be undetectable: ${unreadable.join(", ")}\n`);
    process.exit(1);
  }

  const entry = { verdict, reviewedAt: new Date().toISOString(), specs: recorded };
  if (reviewer !== undefined) entry.reviewer = reviewer;
  // Supersede, never destroy — the same shape record-gate-review uses and for the same reason: a
  // review that was re-run must stay readable. ONE nested level; the prior entry's own
  // `superseded` is dropped rather than chained, or the record's depth becomes a function of how
  // many rounds ran (four ran on 0.27.0).
  const prior = rel.crossSpecReview;
  if (prior && typeof prior === "object") {
    const kept = { ...prior };
    delete kept.superseded;
    entry.superseded = kept;
  }
  rel.crossSpecReview = entry;

  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: recorded cross-spec review '${verdict}' for release '${id}' ` +
      `(${recorded.length} spec${recorded.length === 1 ? "" : "s"})`,
    unchanged: `conductor: release '${id}' already carried this exact cross-spec verdict over the ` +
      `same ${recorded.length} spec${recorded.length === 1 ? "" : "s"} — ${STATE_UNCHANGED}`,
  });
}
