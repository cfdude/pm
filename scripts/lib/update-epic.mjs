// scripts/lib/update-epic.mjs
// The update-epic write-back verb: title/status/priority/links/story mutations on an
// existing epic. One-directional dependencies only.

import { KNOWN_LANES, KNOWN_STATUSES, KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, epicFlagsFor } from "./constants.mjs";
import { activate } from "./active-pointer.mjs";
import { globalReviewMode } from "./rules.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { noteEntry, parentError, parseFlags, parseLinkFlags, parseStoryFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { archiveGate, AGENT_OUTCOMES } from "./archive-gate.mjs";
import { deferralAssertion, isStoryDisposed, storyDisposition, storyDispositionError } from "./disposition.mjs";
import { claimArtifacts } from "./source-artifacts.mjs";
import { linkTypeVocabulary } from "./links.mjs";

// The flags update-epic recognizes. Anything else is a rejected error, not a
// silent no-op — an unrecognized flag (e.g. a typo) used to parse, run, and
// print "updated" with nothing actually changed.
//
// A PROJECTION of the shared EPIC_FLAGS registry, never a literal: this list, add-epic's and
// add-many's all have to grow for every flag this release adds, and a literal here is exactly
// the copy that would reject another capability's flag by name. Registering a flag on
// `update-epic` in EPIC_FLAGS is the whole edit; nothing changes in this file.
export const UPDATE_EPIC_FLAGS = epicFlagsFor("update-epic");

/** Which of `shas` are NOT in `state`'s record of epic `id` — read from a state loaded FROM DISK,
 *  never from the in-memory object the command has been mutating.
 *
 *  #140: four `--attribute-commit` invocations reported success and the arrays read `[]`
 *  afterwards. saveState() now verifies its own bytes reached the disk, and that covers every
 *  verb — but this command does not END at saveState(): render() runs afterwards and writes
 *  again (its reconcileArchived() self-heal saves a state it re-loaded). #140's first candidate
 *  mechanism is exactly that shape — "a later engine invocation re-serialising state.json from a
 *  copy read before the attribution" — and a guard inside saveState structurally cannot see a
 *  write that happens after it returns. So the claim this command prints is checked against the
 *  disk at the moment the command makes it, which is the only moment that matters to a caller.
 *
 *  An absent epic or an absent array counts as everything missing: both mean the record does not
 *  hold what the caller was told it holds. */
export function missingAttributions(state, id, shas) {
  const epic = (state.epics || []).find(e => e && e.id === id);
  const held = new Set(Array.isArray(epic && epic.attributedCommits) ? epic.attributedCommits : []);
  return shas.filter(sha => !held.has(sha));
}

/** Update an EXISTING epic's title/externalId/externalUrl/parent/status/priority/links.
 *  The id is POSITIONAL (parseFlags skips non-`--` tokens). Closes the tracker
 *  sync loop: after the agent creates an issue it records the key here.
 *  --link REPLACES the links array wholesale (unlike the other flags, which patch single
 *  fields) — this is the CLI path to fix a malformed link without hand-editing state.json;
 *  "fixing" means replacing the bad entry, not layering a new one on top of it. */
export function updateEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  // #71: `update-epic --id my-epic --priority P1` is the mistake everyone makes, because every
  // OTHER epic-writing command takes `--id`. This one's id is POSITIONAL and stays that way —
  // accepting `--id` as an alias would make the same argument mean two things depending on which
  // verb you typed. So DIAGNOSE it: name the flag, show the positional form, and rewrite the
  // exact line the caller meant. A bare usage dump naming ~25 flags answers a question nobody
  // asked and never mentions `--id` at all, which is why the mistake kept recurring.
  //
  // TWO distinct diagnoses. "You put the id behind a flag" and "you gave no id at all" are
  // different mistakes and get different messages; collapsing them back into one usage dump is
  // the regression this guards against.
  if (!id) {
    const at = argv.indexOf("--id");
    if (at !== -1) {
      const value = argv[at + 1] !== undefined && !argv[at + 1].startsWith("--") ? argv[at + 1] : "<id>";
      const rest = argv.filter((_, i) => i !== at && i !== at + 1);
      process.stderr.write(
        `conductor: update-epic takes its epic id POSITIONALLY, not as --id — write ` +
        `\`update-epic <id> ...\`, i.e. \`update-epic ${value}${rest.length ? ` ${rest.join(" ")}` : ""}\`. ` +
        "Nothing was written.\n");
      process.exit(1);
    }
    process.stderr.write("conductor: update-epic requires an epic id as its first POSITIONAL argument\n");
    process.stderr.write(`usage: conductor.mjs update-epic <id> [--title T] [--external-id X] [--external-url U] [--parent P] [--status S] [--priority P] [--lane openspec|superpowers|claude-code|decision|external] [--plan <path>] [--spec <path>] [--link \"<${linkTypeVocabulary()}>:<epic>[:<reason>]\"] [--clear-links] [--review-mode off|standard|thorough] [--add-story \"<title>\"] [--story <n> --done|--wont-do "<reason>"] [--attribute-commit <sha>] [--outcome ${AGENT_OUTCOMES.join("|")}] [--reason \"<why>\"] [--correct-disposition \"<why the recorded one was wrong>\"] [--carried-to <epicId>] [--deferral \"<epicId>:<section>\"] [--declined-deferral \"<what>:<why not>\"] [--no-deferrals] [--description D] [--notes \"<text>\"] [--external-updated-at <iso>]\n`);
    process.exit(1);
  }
  const f = parseFlags(argv.slice(1));
  const unknown = Object.keys(f).filter(k => !UPDATE_EPIC_FLAGS.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: update-epic: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${UPDATE_EPIC_FLAGS.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  // #149 — every value-bearing flag this command accepts must carry a usable value, read from
  // the shared registry. It replaces the per-flag checks this command had grown for `--plan`,
  // `--spec`, `--description` and `--notes` — four of the value-bearing flags it accepts;
  // `--outcome`, `--reason`, `--carried-to`, `--base-sha` and the rest were never checked here
  // at all. Before loadState(), so a refusal can leave no partial write.
  requireFlagValues("update-epic", f);
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  const parent = str(f.parent);
  if (parent !== undefined) {
    const perr = parentError(state.epics, id, parent);
    if (perr) { process.stderr.write(`conductor: ${perr}\n`); process.exit(1); }
  }
  const status = str(f.status);
  if (status !== undefined && !KNOWN_STATUSES.includes(status)) {
    process.stderr.write(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")}\n`); process.exit(1);
  }
  // --lane: re-route an epic in place. Validated against the SAME KNOWN_LANES creation validates
  // against, so a lane addEpic() would refuse cannot arrive through this door instead. Tested on
  // `f.lane !== undefined` rather than on the str() result, so a VALUELESS `--lane` (which
  // parseFlags yields as boolean true) is refused by name rather than dropped by str() into an
  // exit-0-write-nothing — the #79 shape.
  const lane = str(f.lane);
  if (f.lane !== undefined && (lane === undefined || !KNOWN_LANES.includes(lane))) {
    process.stderr.write(`conductor: --lane must be one of ${KNOWN_LANES.join("|")}\n`); process.exit(1);
  }
  // --plan / --spec: attach (or repoint) the plan, and the DESIGN DOCUMENT an epic's work was
  // drawn from (#92). Written by their own explicit lines because the EPIC_FLAGS row makes this
  // command ACCEPT the flag and nothing in the registry copies a value onto a key — registering
  // a row and stopping there is the exit-0-write-nothing shape of #79. Their valueless refusals
  // moved to requireFlagValues() above, which covers every flag rather than these two.
  const planPath = str(f.plan);
  const specPath = str(f.spec);
  // Clearing the links is a NAMED flag, and the valueless `--link` that used to do it by
  // accident is refused. `--link` is repeatable, so `--link` with nothing after it parses as
  // `[true]`; parseLinkFlags filters non-strings away and yields `[]`, which then REPLACED the
  // array — a wipe that looks exactly like a typo and reports "updated". Both spellings now say
  // what they mean, and the refusal names the one that clears.
  let links;
  if (f["clear-links"] !== undefined) {
    if (f["clear-links"] !== true) {
      process.stderr.write("conductor: --clear-links takes no value\n"); process.exit(1);
    }
    if (f.link !== undefined) {
      process.stderr.write("conductor: --clear-links and --link are mutually exclusive — pass the links you want, or clear them\n");
      process.exit(1);
    }
    links = [];
  } else if (f.link !== undefined) {
    // The "--link requires a value, and --clear-links is the one that empties" refusal that
    // stood here now lives on the `--link` ROW in EPIC_FLAGS, as its `requires` phrase, and
    // fires from requireFlagValues() above. Same words, and now on `add-epic` too — which
    // accepted a valueless `--link`, filtered it to `[]` and created the epic. Keeping a second
    // copy here would be unreachable code asserting a rule the registry already carries.
    try {
      links = parseLinkFlags(f.link, new Set(state.epics.map(e => e.id)));
    } catch (e) {
      process.stderr.write(`conductor: ${e.message}\n`); process.exit(1);
    }
  }

  // --review-mode: a per-epic escalation-only override of the repo-global review-mode dial
  // (set-review-mode). It must never be usable to quietly de-escalate below the global dial —
  // that would let one epic silently weaken review rigor a human explicitly raised repo-wide.
  const reviewMode = str(f["review-mode"]);
  if (reviewMode !== undefined) {
    if (!KNOWN_REVIEW_MODES.includes(reviewMode)) {
      process.stderr.write(`conductor: --review-mode must be one of ${KNOWN_REVIEW_MODES.join("|")}\n`);
      process.exit(1);
    }
    const global = globalReviewMode(state);
    if (REVIEW_MODE_RANK[reviewMode] < REVIEW_MODE_RANK[global]) {
      process.stderr.write(
        `conductor: --review-mode '${reviewMode}' would de-escalate below the repo-global dial ` +
        `('${global}') — an epic-level override may only escalate above the global dial, never below it\n`);
      process.exit(1);
    }
  }

  // The valueless --description / --notes loop that stood here is requireFlagValues()' job now.
  const description = str(f.description);
  const note = str(f.notes);

  // --add-story "<title>" appends { title, done: false } to the epic's inline stories[]
  // (creating the array if this is its first inline story) -- closes the recurring
  // hand-edit-of-state.json risk (a naive JSON re-escape of an em dash has corrupted the
  // file before). --story <n> --done marks an existing story done; <n> is 1-indexed (the
  // natural reading for a human-facing CLI flag: "--story 1" means the first story).
  // `--add-story` is repeatable as of gh#95, so it arrives as an ARRAY and is parsed by the
  // same helper add-epic uses — one validation rule, not two that drift.
  let addedStories;
  try { addedStories = parseStoryFlags(f["add-story"]); }
  catch (e) { process.stderr.write(`conductor: ${e.message}\n`); process.exit(1); }

  // `--story <n>` now takes TWO mutations: `--done` (it shipped) and `--wont-do "<reason>"`
  // (it will not be done, and here is why). The second is the honest key to the archive gate's
  // pre-existing handoff refusal, whose other remedy — the `<!-- pm:lifecycle -->` marker —
  // cannot be applied to an inline story at all, there being no task source to write it in.
  const wontDo = f["wont-do"];
  let storyIndex, storyMutation;
  if (f.story !== undefined) {
    const asked = [f.done === true ? "done" : null, wontDo !== undefined ? "wont-do" : null].filter(Boolean);
    if (asked.length === 0) {
      process.stderr.write("conductor: --story <n> requires a mutation — --done (it shipped) or --wont-do \"<reason>\" (it will not be done, and why)\n");
      process.exit(1);
    }
    if (asked.length > 1) {
      process.stderr.write("conductor: --done and --wont-do are mutually exclusive — a story either shipped or it did not\n");
      process.exit(1);
    }
    storyMutation = asked[0];
    // The reason is validated BEFORE the range check reads state, so a valueless `--wont-do`
    // (which parseFlags yields as boolean `true`) is refused by its own rule and never falls
    // through str() into an exit-0-write-nothing.
    if (storyMutation === "wont-do") {
      const err = storyDispositionError({ state: "wont-do", reason: typeof wontDo === "string" ? wontDo : "" });
      if (err) { process.stderr.write(`conductor: ${err}\n`); process.exit(1); }
    }
    const n = Number(f.story);
    const stories = Array.isArray(epic.stories) ? epic.stories : [];
    if (!Number.isInteger(n) || n < 1 || n > stories.length) {
      process.stderr.write(`conductor: --story ${f.story} is out of range — '${id}' has ${stories.length} stor${stories.length === 1 ? "y" : "ies"} (1-indexed)\n`);
      process.exit(1);
    }
    storyIndex = n - 1;
    // The REPLACEMENT RULE, one level down from archiveGate()'s refusal to overwrite an
    // agent-recorded epic disposition, and for the same reason: a recorded terminal judgment is
    // somebody's decision and this verb does not silently destroy it. Correcting a mistaken
    // story disposition is deliberately not something this command does.
    const target = stories[storyIndex];
    if (isStoryDisposed(target)) {
      process.stderr.write(
        `conductor: story ${n} of '${id}' already carries a recorded disposition ` +
        `('${target.disposition.state}': ${target.disposition.reason}). Replacing it would ` +
        "destroy a judgment somebody made.\n");
      process.exit(1);
    }
    if (storyMutation === "wont-do" && target.done) {
      process.stderr.write(`conductor: story ${n} of '${id}' is already done — work that shipped cannot be dropped\n`);
      process.exit(1);
    }
  } else if (f.done === true) {
    process.stderr.write("conductor: --done requires --story <n>\n"); process.exit(1);
  } else if (wontDo !== undefined) {
    process.stderr.write("conductor: --wont-do requires --story <n>\n"); process.exit(1);
  }

  // --attribute-commit <sha>: append, in the order given, the commits this epic's work landed
  // in. The last entry is the endpoint a recorded Gate 2 `headSha` is compared against, so the
  // ORDER is the meaning and the engine appends exactly what it is handed.
  const attributed = f["attribute-commit"] === undefined
    ? [] : [].concat(f["attribute-commit"]).filter(v => typeof v === "string" && v.trim());
  if (f["attribute-commit"] !== undefined && !attributed.length) {
    process.stderr.write("conductor: --attribute-commit requires a commit sha\n"); process.exit(1);
  }

  // The archive transition's conditions live in archive-gate.mjs, which every path that can
  // leave an epic at `archived` imports. They were inline here, which is precisely how they
  // came to bind this one path and none of the other four. The gate returns a refusal; this
  // command owns the exit code and the stderr, as it does for every other validation above.
  //
  // This command therefore holds NO lane test of its own. The one it used to hold compared
  // `epic.lane === "openspec"` strictly, so a lane-less epic — openspec-lane on every rendered
  // surface since resolveEpics() started normalizing it — slipped the gate entirely. The gate
  // now decides membership through constants.mjs's isOpenspecLane, the single predicate every
  // such site goes through.
  // The deferral assertion is BUILT here and validated by the gate: three flags, one record.
  // `--no-deferrals` makes "there are none" sayable, which is the whole point — an absence is
  // otherwise indistinguishable from never having looked.
  const pairs = (raw, a, b) => [].concat(raw === undefined ? [] : raw)
    .filter(v => typeof v === "string")
    .map(v => { const i = v.indexOf(":"); return i === -1
      ? { [a]: v.trim(), [b]: "" } : { [a]: v.slice(0, i).trim(), [b]: v.slice(i + 1).trim() }; });
  const asserted = f.deferral !== undefined || f["declined-deferral"] !== undefined || f["no-deferrals"] === true
    ? deferralAssertion({
        deferrals: pairs(f.deferral, "epic", "section"),
        declined: pairs(f["declined-deferral"], "what", "reason"),
      })
    : undefined;

  // `--correct-disposition "<why the recorded one was wrong>"`: the ONE way past the refusal
  // that protects an agent-recorded disposition (#130). Two refusals before any write, both
  // #79's shape:
  //   1. VALUELESS — parseFlags yields boolean `true`, str() drops it, and the correction would
  //      be silently downgraded to an ordinary (refused) archive with a confusing message.
  //   2. UNREACHABLE — the whole disposition block below sits inside `status === "archived"`,
  //      so `--correct-disposition` alone parses, writes nothing, exits 0 and prints "updated".
  //      Diagnosed by name rather than dropped.
  const correction = str(f["correct-disposition"]);
  if (f["correct-disposition"] !== undefined) {
    if (correction === undefined) {
      process.stderr.write(
        "conductor: --correct-disposition requires a reason saying why the recorded disposition " +
        "was wrong — it is kept on the record beside the one it supersedes\n");
      process.exit(1);
    }
    if (status !== "archived") {
      process.stderr.write(
        "conductor: --correct-disposition corrects a recorded disposition, which only happens " +
        "at the archive transition — pass --status archived together with the --outcome (and " +
        "--reason) you meant to record. Nothing was written.\n");
      process.exit(1);
    }
  }

  // Note `status === "archived"`, not "the status CHANGED to archived": an epic already at
  // `archived` runs the full gate again on this invocation and records the disposition the
  // agent supplies. Re-archiving is an established shape here — `completedAt` below is already
  // guarded on `!epic.completedAt` precisely because this verb can be run twice — and it is
  // the only moment the documented `/opsx:archive` -> heal -> record flow can say `delivered`.
  if (status === "archived") {
    const verdict = archiveGate(epic, {
      outcome: str(f.outcome), reason: str(f.reason),
      carriedTo: str(f["carried-to"]), deferralAssertion: asserted, correction,
    });
    if (!verdict.ok) { process.stderr.write(`conductor: ${verdict.message}\n`); process.exit(1); }
    // The gate BUILDS the record and this command writes it, so the disposition an epic ends
    // with is the one the gate validated — there is no second construction site to drift.
    if (verdict.disposition) epic.disposition = verdict.disposition;
    if (verdict.deferralAssertion) epic.deferralAssertion = verdict.deferralAssertion;
  }

  if (str(f.title) !== undefined) epic.title = str(f.title);
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (str(f["external-updated-at"]) !== undefined) epic.externalUpdatedAt = str(f["external-updated-at"]);
  if (parent !== undefined) epic.parent = parent;
  if (status !== undefined) epic.status = status;
  // In-place field writes: the epic keeps its position in `state.epics[]`, its startedAt, its
  // gate verdicts, its links and its stories. Re-routing an epic must cost none of those — that
  // it used to is the whole reason remove-and-re-register was the only correction available.
  if (lane !== undefined) epic.lane = lane;
  if (planPath !== undefined) epic.planPath = planPath;
  if (specPath !== undefined) epic.specPath = specPath;
  // The ONE claim site outside pushEpic(): every other way an epic comes to hold a source
  // artifact is a creation, and creation routes through that sink. Attaching an artifact says
  // it is real work, so any sync-ignore tombstone saying it is not must go — the record must
  // not hold two opposite claims about one file, and this is the un-ignore path (derived from
  // an action the operator already takes, rather than a new verb nobody would find).
  for (const p of claimArtifacts(state, epic)) {
    process.stderr.write(`conductor: cleared the sync-ignore tombstone on '${p}' — \`${epic.id}\` now claims it\n`);
  }
  // A manual `rank` is a placement among ONE band's peers, so it does not survive a move to
  // another band — it would collide with that band's own 1..N numbering, and the number would
  // claim a position nobody chose in a set nobody compared. Cleared on a REAL band change only:
  // re-stating the priority an epic already has changes nothing and must not silently discard a
  // deliberate order. Announced on stderr rather than done silently — this is the one place
  // anything but `reorder` touches the field, and an unannounced clear is indistinguishable
  // from the rank never having been set. See lib/rank.mjs for the invariant.
  const newPriority = str(f.priority);
  if (newPriority !== undefined) {
    if (newPriority !== epic.priority && epic.rank !== undefined) {
      process.stderr.write(`conductor: cleared \`${epic.id}\`'s rank (${epic.rank}) — it was a ` +
        `placement among ${epic.priority} epics, and this moves it to ${newPriority}. ` +
        `Re-run \`reorder\` on the ${newPriority} band to place it.\n`);
      delete epic.rank;
    }
    epic.priority = newPriority;
  }
  if (links !== undefined) epic.links = links;
  if (reviewMode !== undefined) epic.reviewMode = reviewMode;
  if (attributed.length) {
    if (!Array.isArray(epic.attributedCommits)) epic.attributedCommits = [];
    epic.attributedCommits.push(...attributed.map(v => v.trim()));
  }
  // `--description` REPLACES (durable rationale, one value); `--notes` APPENDS (an activity
  // trail). Writing either never touches the other, and an earlier note is never rewritten or
  // dropped — the two readings are both wanted, so neither may be collapsed into the other.
  if (description !== undefined) epic.description = description;
  if (note !== undefined) {
    if (!Array.isArray(epic.notes)) epic.notes = [];
    epic.notes.push(noteEntry(note));
  }
  if (addedStories.length) {
    if (!Array.isArray(epic.stories)) epic.stories = [];
    epic.stories.push(...addedStories);
  }
  if (storyIndex !== undefined) {
    // The ROW SURVIVES in both branches. Deletion is never the answer to "this will not be
    // done": removing it destroys the record that the work was ever projected, which is exactly
    // the history an archived epic's reader needs.
    if (storyMutation === "done") epic.stories[storyIndex].done = true;
    else epic.stories[storyIndex].disposition = storyDisposition({ state: "wont-do", reason: wontDo });
  }

  // Stamp completedAt the moment an epic transitions TO archived (not merely re-saved
  // while already archived) — supports velocity tracking off startedAt/completedAt.
  if (status === "archived" && !epic.completedAt) epic.completedAt = new Date().toISOString();

  // Keep .active consistent with status — the two must never disagree.
  if (epic.status === "active") activate(state, id);
  else if (state.active === id) state.active = null;

  saveState(state);
  render();

  // The success message is printed only after the record on disk is READ BACK and confirmed to
  // hold what this invocation claims to have written. Everything above verifies its own write;
  // this verifies the COMMAND, after render() has had its turn at the file too.
  if (attributed.length) {
    const wrote = attributed.map(v => v.trim());
    const missing = missingAttributions(loadState(), id, wrote);
    if (missing.length) {
      process.stderr.write(
        `conductor: --attribute-commit wrote ${wrote.join(", ")} to '${id}' and ` +
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} NOT in .conductor/state.json ` +
        "afterwards. NOTHING has been recorded for those commits — do not treat this epic's " +
        "attribution as current. Re-run the attribution, then verify with `git show` against the " +
        "COMMIT rather than against the working tree.\n");
      process.exit(1);
    }
  }
  process.stderr.write(`conductor: updated '${id}'\n`);
}
