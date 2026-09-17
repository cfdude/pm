// scripts/lib/archive-gate.mjs
// What the archive transition requires, per path. May import constants.mjs,
// epic-progress.mjs, disposition.mjs and git.mjs — and nothing else, and nothing under those
// imports back up. `update-epic.mjs` imports THIS module; the reverse never happens.
//
// Why a module rather than the inline refusal this replaces: the Gate 2 check lived at
// update-epic.mjs:106-115, and that placement is exactly how it came to bind ONE of the five
// paths that can leave an epic at `status: "archived"` — the interactive verb — while the
// archive-drift heal, the archive backfill registration and the two archived-at-creation paths
// went ungated. A rule written here is a rule every one of those paths can import; a rule
// written inside one command's body is a rule about that command.
//
// SEAM OWNERSHIP (design § 1): this module owns what is REQUIRED AT A TRANSITION. What is
// TRUE OF AN EPIC — outstanding work above all — belongs to epic-progress.mjs, and the gate
// READS that quantity rather than computing one of its own. Two counters is how a guard comes
// to refuse an epic that renders as complete.

import { CONTROL_CHARACTER, asCode, escapeControls, gateHasEvidence, gateSummary, isOpenspecLane, noRemedyMessage, orNoRemedy, printedId, withdrawnGate } from "./constants.mjs";
import { commitsNotReachedBy, isCommitNameShaped, resolveCommits } from "./git.mjs";
import { LIFECYCLE_MARKER, epicProgress, outstandingWork } from "./epic-progress.mjs";
import { KNOWN_OUTCOMES, agentDisposition, correctionError, dispositionError, isEngineStamped, isStoryDisposed, outcomeOf } from "./disposition.mjs";

/**
 * The outstanding-work quantity a refusal cites, rendered ONCE so a guard can never name a
 * number the record does not show. `claimed` is the very substring PROJECT.md and the brief
 * render for the same epic, and `outstanding` is epic-progress.mjs's single definition —
 * this module reads that quantity and deliberately computes none of its own (design § 1).
 *
 * Nothing refuses on work remaining yet; the handoff demand is the first caller. It lands
 * here rather than beside it so the refusal and the record share one renderer by construction.
 */
export function outstandingSummary(epic) {
  const p = epicProgress(epic);
  return {
    outstanding: outstandingWork(epic), claimed: `${p.done}/${p.total}`, excluded: p.excluded,
    source: p.source,
    // The outstanding items BY NAME, and only where the record actually holds them: inline
    // stories live on the epic, so an archived epic can still be told what it left behind. The
    // checkbox sources cannot answer — by archive time `openspec/changes/<id>/` has moved and a
    // plan file may have moved too — so `items` is empty there rather than guessed at.
    items: p.source === "stories" ? outstandingStories(epic) : [],
  };
}

/** The undone, undisposed stories of `epic`, carrying the 1-INDEXED position `--story <n>`
 *  takes — so a refusal can name the story AND the exact command that answers it. Numbering is
 *  over the FULL array, disposed rows included, because that is what `--story <n>` indexes;
 *  renumbering around the ones already answered would print numbers that address the wrong row. */
export function outstandingStories(epic) {
  if (!Array.isArray(epic && epic.stories)) return [];
  return epic.stories
    .map((s, i) => ({ n: i + 1, title: s && s.title, story: s }))
    .filter(x => x.story && !x.story.done && !isStoryDisposed(x.story))
    .map(({ n, title }) => ({ n, title }));
}

/**
 * How well a recorded verdict covers the work actually attributed to the epic.
 *
 * Four distinct answers, and collapsing any two of them is the defect:
 *
 *   "unverifiable"    the epic has NO attribution array (it predates the capability), or the
 *                     verdict records no range, or git cannot answer. Nothing is known; the
 *                     archive is not refused on staleness grounds, and the verdict is not
 *                     silently shown as a covering pass either.
 *   "none-attributed" the array is PRESENT and EMPTY — the epic was created under this
 *                     capability and asserts that nothing has been attributed to it. No verdict
 *                     can be shown stale by an empty array, so the archive is not refused; it
 *                     renders differently from unverifiable because it is a different claim.
 *   "stale"           the recorded `headSha` does not reach EVERY attributed commit (equal to or an
 *                     ancestor of it) — work landed outside the range the reviewer read, including
 *                     a head on an unrelated branch, which reaches none of them — OR the head or an
 *                     attributed entry is not SHAPED as a commit name at all (a legacy `HEAD`,
 *                     `not-a-commit`), which is never resolved as a ref at read time.
 *   "fresh"           every attributed commit is reached, including the ordinary case where
 *                     repository HEAD has moved far past the verdict through commits belonging to
 *                     other epics. Repository HEAD is deliberately NOT the baseline — an epic
 *                     archived a week after its merge would otherwise read stale through nobody's
 *                     fault — and neither is reachability from any branch or ref.
 *
 * A HEXADECIMAL value this clone cannot resolve to exactly one commit is UNANSWERABLE rather than a
 * finding: write-time resolution guaranteed it was a commit, so a clone lacking it cannot answer for
 * the record. Unanswerable reads "unverifiable" — but only where nothing is already known stale: a
 * resolvable attributed commit the head does not reach makes the verdict stale whatever else is
 * missing.
 *
 * EVERY ENTRY, NOT THE LAST (gates-bind-to-verified-evidence Decision 9). Comparing only the last
 * entry let an ancestor attributed after an uncovered descendant read fresh, and let a head on an
 * unrelated branch read fresh because it was an ancestor of nothing.
 *
 * `uncovered` names the attributed commits the range does not reach, so a refusal can say what
 * is missing rather than only that something is.
 *
 * THE ARCHIVE MOVE IS THE CASE THIS SHAPE EXISTS TO SURVIVE. `/opsx:archive` commits a move of
 * `openspec/changes/<id>/` under `archive/`, and that commit lands AFTER the reviewed range by
 * construction. Attribute it and the last entry becomes a descendant of the recorded `headSha`,
 * the verdict reads stale, and the gate refuses the very `delivered` record the interactive
 * verb is required to accept — the documented workflow blocked by its own last step.
 *
 * The exclusion is AGENT-DECLARED, exactly like the `<!-- pm:lifecycle -->` marker: the emitted
 * instructions say not to attribute the move, and this function classifies nothing. It appends
 * no hash, inspects no commit's contents, and reads no commit message; it compares only the
 * array it was given. Withholding that one append never empties a populated array, so an epic
 * that attributed its delivery commits keeps them and stays fresh.
 */
export function gateStaleness(epic, entry) {
  if (!entry || typeof entry.verdict !== "string") return { state: "none", uncovered: [] };
  const attributed = epic && epic.attributedCommits;
  if (!Array.isArray(attributed)) return { state: "unverifiable", uncovered: [] };
  // WITHDRAWN IS NOT THE SAME AS NEVER-ATTRIBUTED. Gate 2 found the bypass: an epic whose
  // verdict read `stale` could be archived by simply withdrawing every attribution, because an
  // empty array reads `none-attributed` and the archive gate lets that through. A withdrawal is a
  // CORRECTION — it says the sha was wrong — and it must never be a route past a gate. An epic
  // that attributed, then withdrew, and now attributes nothing owes the real range.
  if (!attributed.length) {
    const withdrawn = epic && Array.isArray(epic.withdrawnCommits) ? epic.withdrawnCommits : [];
    return withdrawn.length
      ? { state: "attribution-withdrawn", uncovered: [], withdrawn }
      : { state: "none-attributed", uncovered: [] };
  }
  if (!gateHasEvidence(entry)) return { state: "unverifiable", uncovered: [] };
  const head = entry.headSha;
  // Shape first, and never passed to git: a malformed value is ALWAYS stale.
  const malformed = [...new Set([head, ...attributed].filter(v => !isCommitNameShaped(v)))];
  const hexAttributed = attributed.filter(isCommitNameShaped);
  const { resolved } = resolveCommits([...(isCommitNameShaped(head) ? [head] : []), ...hexAttributed]);
  let unanswerable = [...new Set([head, ...hexAttributed].filter(v => isCommitNameShaped(v) && !resolved.has(v)))];
  let uncovered = [];
  if (resolved.has(head)) {
    const reachable = hexAttributed.filter(v => resolved.has(v));
    const unreached = commitsNotReachedBy(reachable.map(v => resolved.get(v)), resolved.get(head));
    if (unreached === null) unanswerable = unanswerable.concat(reachable);
    else uncovered = [...new Set(reachable.filter(v => unreached.has(resolved.get(v))))];
  }
  if (malformed.length || uncovered.length) return { state: "stale", uncovered, malformed, headSha: head };
  if (unanswerable.length) return { state: "unverifiable", uncovered: [] };
  return { state: "fresh", uncovered: [] };
}

/** The marking a rendered verdict carries, so PROJECT.md, the brief and any refusal describe
 *  the same verdict the same way. Exported for render.mjs and briefing.mjs, which import it
 *  from here rather than re-deriving staleness of their own. */
export function stalenessMarking(epic, entry) {
  switch (gateStaleness(epic, entry).state) {
    case "stale": return " ⚠ stale";
    case "unverifiable": return " ⚠ unverifiable";
    case "none-attributed": return " · no attributed commits";
    case "attribution-withdrawn": return " ⚠ attribution withdrawn";
    default: return "";
  }
}

/** THE gate table PROJECT.md and the brief both render: which epics it lists, and each gate's cell
 *  text, decided ONCE. It lives here rather than beside gateSummary() in constants.mjs because it
 *  needs stalenessMarking(), which constants.mjs may not import.
 *
 *  An epic is listed where either gate holds a stored verdict OR is in the WITHDRAWN state. The
 *  table used to filter on `gate1 || gate2`, so an epic whose every verdict was withdrawn dropped
 *  out of it — a withdrawal reading as a review that never existed, on the two surfaces a reader
 *  looks at. A withdrawn cell is the literal `withdrawn — <reason>`, control characters escaped so a
 *  reason can never break the row. Each surface keeps its own row cap. */
export function gateTableRows(epics) {
  const cell = (e, n) => {
    const entry = e.gateReview && e.gateReview[`gate${n}`];
    const withdrawal = withdrawnGate(e, n);
    return withdrawal
      ? `withdrawn — ${escapeControls(String(withdrawal.reason ?? ""))}`
      : gateSummary(entry, stalenessMarking(e, entry));
  };
  return (epics || [])
    .filter(e => e && ((e.gateReview && (e.gateReview.gate1 || e.gateReview.gate2)) ||
      withdrawnGate(e, 1) || withdrawnGate(e, 2)))
    .map(e => ({ id: e.id, gate1: cell(e, 1), gate2: cell(e, 2) }));
}

/**
 * The archive transition's gate.
 *
 * Returns a REFUSAL OBJECT and never exits: the caller owns its own exit code, its own stderr,
 * and any cleanup it has to do. A gate that called process.exit() itself would be unusable
 * from the non-interactive paths, which must reflect what disk already says rather than die.
 *
 * ALREADY-ARCHIVED IS NOT A NO-OP. The gate runs on an invocation whose epic is already at
 * `archived`, and every demand below is evaluated against it. That call is the ONLY moment the
 * documented workflow can record `delivered`: `/opsx:archive` moves the change directory, the
 * archive-drift heal observes the move and flips the status stamping `unknown` because nobody
 * supplied a disposition at that instant, and a gate that treated "the status did not change"
 * as grounds to skip would leave EVERY openspec epic following the documented workflow at
 * `unknown` — the 42-of-49 headline defect, reproduced in the field built to close it.
 *
 * Every input below is read from the RECORD and none from `openspec/changes/<id>/`: by that
 * point the directory has moved under `archive/`. The Gate 2 verdict and its evidence, the
 * outstanding-work quantity (which reads zero for an archived epic whose source is gone), the
 * deferral assertion and the attribution array are all durable on the epic.
 *
 * @param {object} epic     the epic as it stands BEFORE the transition.
 * @param {object} [request] what the caller is asking for at this transition — the interactive
 *                           verb supplies the agent's disposition here. Empty for now; the
 *                           outcome requirement, the replacement rule, the deferral assertion
 *                           and the handoff demand all land in this parameter.
 * @returns {{ok: true} | {ok: false, message: string}}
 */
/** The outcomes an AGENT may choose. `unknown` is excluded deliberately: it records that
 *  nobody was asked, and an agent running the verb was asked — choosing "I don't know" over a
 *  real disposition is exactly the silence this release removes. */
export const AGENT_OUTCOMES = KNOWN_OUTCOMES.filter(o => o !== "unknown");

/** The deferral placeholder the invocation carries where an epic holds no deferral assertion.
 *  A placeholder and never a bare `--no-deferrals`: that flag is a CLAIM about the change, and
 *  printing it as a default would put a claim in the caller's mouth. */
export const DEFERRAL_PLACEHOLDER = `<--no-deferrals | --deferral "<epicId>:<section>">`;

/** The one renderer of a passing gate-verdict remedy, carrying the evidence THAT gate requires:
 *  a commit range for Gate 2, artifact paths for Gate 1 (emitted-instructions: "A given remedy SHALL
 *  read the same at every site that prints it"). Every site that prints a gate re-record calls this;
 *  a site that cannot know which gate it names prints both. `base`/`head` name what the range
 *  placeholders MEAN where the caller knows (the attribution-withdrawn pair names the replacing
 *  commit). */
export function gateRemedy(id, gate, { base = "<sha>", head = "<sha>" } = {}) {
  // An id holding a control character yields the no-remedy message instead of a command (D4a).
  return orNoRemedy(() => (String(gate) === "1"
    ? `record-gate-review ${printedId(id)} --gate 1 --verdict pass --artifact <path>`
    : `record-gate-review ${printedId(id)} --gate 2 --verdict pass --base-sha ${base} --head-sha ${head}`));
}

/** The invocation that would record a disposition for ONE epic — rendered once, so no caller
 *  types the vocabulary into a string of its own. Both halves in one invocation, because the
 *  gate above refuses either half alone.
 *
 *  IT READS THE EPIC (gh-189): the `--outcome` choices are only those the archive gate would accept
 *  for it. Where deliveredObligations() fails — for an openspec-lane epic a missing, withdrawn or
 *  stale Gate 2, or outstanding work — `delivered` is omitted, because a choice list naming it is a
 *  command that fails when copied; blockedDelivered() names what blocks it and the remedy.
 *
 *  OPTIONS DEFAULT TO TODAY'S TEXT for everything but that rule. update-epic's archived-epic
 *  regression refusal passes the options:
 *    keepDelivered  the epic's `delivered` was already considered, and the refusal exists so the edit
 *                   can be made without losing it — so `delivered` stays offered;
 *    echoed      tokens already shell-quoted by the caller, placed after the id — the change the
 *                refused call was making;
 *    correction  add `--correct-disposition` (true only for an AGENT-recorded disposition, since
 *                the correction flag is refused against an engine stamp);
 *    deferrals   "bare" (the default, `--no-deferrals`), "asserted" (the epic already carries an
 *                assertion: print nothing) or "placeholder" (print DEFERRAL_PLACEHOLDER);
 *    carry       obligationArchiveFlags() for a record whose `delivered` would be refused on a
 *                checkbox source's open tasks — the refusal's invocation keeps offering `delivered`,
 *                so it must carry the handoff that makes `delivered` recordable (Gate 2 R-I1). */
export function dispositionInvocation(epic, { echoed = [], correction = false, deferrals = "bare", keepDelivered = false, carry = [] } = {}) {
  // A record no verb can rename gets the no-remedy message in place of the invocation (D4a).
  if (CONTROL_CHARACTER.test(String(epic.id))) return noRemedyMessage("epic", epic.id);
  const outcomes = keepDelivered || !blockedDelivered(epic).length
    ? AGENT_OUTCOMES : AGENT_OUTCOMES.filter(o => o !== "delivered");
  const template = ` --status archived --outcome <${outcomes.join("|")}> --reason "<why>"`;
  const head = `update-epic ${printedId(epic.id)}${echoed.length ? ` ${echoed.join(" ")}` : ""}${template}`;
  // A carry flag the invocation already names (`--reason`) is not printed twice: a repeated flag
  // silently keeps its last value, so a second `--reason` would make one of the two placeholders a lie.
  // "Already names" is read from the ENGINE'S OWN TEMPLATE, never from the echoed tokens (Gate 2 F-I1): an
  // echoed value is user data — a title `moved --carried-to later` is one quoted word — and reading flags
  // out of it suppressed the handoff flag, so the filled invocation was refused "task(s) outstanding". A
  // REAL echoed carry flag cannot collide: `--carried-to` and `--reason` are both dropped from the echo.
  const named = new Set([...template.matchAll(/(?:^| )(--[a-z][a-z0-9-]*)/g)].map(m => m[1]));
  return head + carry.filter(f => !named.has(f.split(" ")[0])).map(f => ` ${f}`).join("") +
    (correction ? ` --correct-disposition "<why the recorded one was wrong>"` : "") +
    (deferrals === "bare" ? " --no-deferrals" : deferrals === "placeholder" ? ` ${DEFERRAL_PLACEHOLDER}` : "");
}

/** What blocks recording `delivered` for `epic` today, each `{kind, detail, remedy}` — `kind` is the
 *  DELIVERED_OBLIGATIONS variant, `remedy` the command lines that meet it, in order. THE ENTRIES ARE
 *  ORDERED TOO, and a reader runs them in that order (Gate 2 F-M2): DELIVERED_OBLIGATIONS' order, every
 *  Gate 2 variant before the handoff, since a checkbox handoff's remedy is the `delivered` archive, which
 *  is refused while Gate 2 is unmet. Empty when
 *  nothing blocks. Carried to the disposition's own `carriedTo`, the one input a stored record gives
 *  the handoff demand. */
export function blockedDelivered(epic) {
  const carriedTo = (epic && epic.disposition && epic.disposition.carriedTo) || undefined;
  return deliveredObligations(epic, { carriedTo }).map(o => {
    // A checkbox source's handoff has no standalone command (no verb ticks a checkbox): the way past it
    // is the `delivered` archive itself, carrying the obligation's flags — the same line integrity
    // prints (Gate 2 U-I1, the E-I5 class). Without it the entry named a block and an empty remedy.
    const carry = obligationArchiveFlags(epic, o);
    return {
      kind: o.variant,
      detail: o.variant === "gate2-missing"
        ? `${o.detail} — the record shows no Gate 2 review of this work, and recording \`delivered\` requires a real one`
        : o.detail,
      remedy: [...obligationRemedy(epic, o), ...(carry.length ? [deliveredArchiveInvocation(epic, carry)] : [])],
    };
  });
}

/** THE ONE RENDERING of a `delivered` archive for one epic carrying obligationArchiveFlags() — printed by
 *  integrity's `delivered-release-epic-left-open` and `heal-archived-epic-passed-gate-2`, and by
 *  blockedDelivered() as a checkbox handoff's remedy, so the three cannot drift apart. */
export function deliveredArchiveInvocation(epic, carry = []) {
  return orNoRemedy(() => `update-epic ${printedId(epic.id)} --status archived --outcome delivered${carry.map(f => ` ${f}`).join("")} --no-deferrals`);
}

/** THE WALKER: the archived epics whose outcome NOBODY CONSIDERED, each with the invocation that
 *  would record one. Lives here rather than in disposition.mjs because the remedy is this
 *  module's own verb and its vocabulary is `AGENT_OUTCOMES`, which disposition.mjs may not import
 *  (it imports constants.mjs and nothing else, and nothing under it imports back up).
 *
 *  THE PREDICATE IS TWO HALVES AND BOTH ARE LOAD-BEARING — an ENGINE-WRITTEN stamp whose value is
 *  `unknown`:
 *
 *  - An engine stamp ALONE is not enough. A stamp can be evidence-derived: the 0.27.0 migration
 *    wrote `delivered` wherever a passing Gate 2 verdict existed, and this repository still holds
 *    three of them. Handing those to an agent to re-dispose would ask it to re-derive what the
 *    record already derived correctly. The first draft's predicate was "stamped by a migration"
 *    and returned exactly those three too many.
 *  - An `unknown` VALUE alone is not enough either. `outcomeOf()` answers `"unknown"` for an epic
 *    carrying no disposition at all, and an absent disposition is deliberately outside the
 *    population: every archive path binds the outcome invariant and the migration stamped every
 *    pre-existing archived epic, so a predicate handling absence would handle a state no path
 *    produces. Live data agrees at zero.
 *
 *  Asked through `isEngineStamped()`, never by reading `.recordedBy` — that reader is THE
 *  discriminator, and a second one is what the suite's source scan exists to prevent.
 *
 *  Each row also carries `deliveredBlockedBy` — always present, `[]` when nothing blocks. */
export function unconsideredOutcomes(epics) {
  return (epics || [])
    .filter(e => e && e.status === "archived" && isEngineStamped(e.disposition) &&
      outcomeOf(e) === "unknown")
    .map(e => ({ epic: e, invocation: dispositionInvocation(e), deliveredBlockedBy: blockedDelivered(e) }));
}

/* CONTROL_CHARACTER and escapeControls live in constants.mjs (every-verb-refuses-what-it-does-not-read):
 * the pre-dispatch command-line check echoes caller tokens too, and argv-surface.mjs is a leaf that
 * may import constants.mjs only. Still one escaper for every refusal that prints a user value. */

/**
 * THE ONE DEFINITION of the obligations a `delivered` outcome carries — a REGISTRY, so a variant
 * cannot exist only as a branch inside a function (emitted-commands-run-as-written: the suite's
 * Layer B reads this export and fails for any variant with no fixture). Gate 2 variants first, and
 * mutually exclusive by construction:
 *
 *   gate2-missing                openspec lane: no passing Gate 2 (and none withdrawn).
 *   gate2-withdrawn              openspec lane: the Gate 2 verdict was withdrawn, none since.
 *   gate2-stale                  openspec lane: a passing Gate 2 that does not reach the attributed
 *                                commits, or holds a malformed value (gateStaleness `stale`).
 *   gate2-attribution-withdrawn  openspec lane: a passing Gate 2 and no attributed commits, having
 *                                withdrawn some (gateStaleness `attribution-withdrawn`).
 *   handoff                      no outstanding work (outstandingSummary), unless `carriedTo` names
 *                                a receiver.
 *
 * Each entry: `{variant, kind, detect(epic, {carriedTo}) → {detail, items} | null, remedy(epic) →
 * [command lines]}`. `kind` is `gate2` or `handoff` — deliveredRegression() compares obligations by
 * KIND, so a Gate 2 already failing in one variant is not broken again by moving to another. The
 * remedy is rendered HERE, once, and every site naming that obligation prints it: the archive gate's
 * refusal, update-epic's regression refusal, `integrity`, and `unconsidered-outcomes`.
 *
 * THE ATTRIBUTION-WITHDRAWN REMEDY IS TWO LINES AND ITS ORDER IS LOAD-BEARING: re-record Gate 2 over
 * the commit that replaces the withdrawn one, THEN attribute that commit. Attributing first on an
 * archived record is refused (the Gate 2 head does not reach it), and a re-record alone leaves the
 * record attributing no commits. Verified on 0.44.0 (design.md Decision 2).
 */
const staleGate2 = (epic) => {
  if (!isOpenspecLane(epic) || withdrawnGate(epic, 2)) return null;
  const gate2 = epic.gateReview && epic.gateReview.gate2;
  if (!gate2 || gate2.verdict !== "pass") return null;
  return gateStaleness(epic, gate2);
};
const REPLACING = "<the commit that replaces the withdrawn one>";
const REPLACING_PARENT = "<that commit's parent>";

export const DELIVERED_OBLIGATIONS = [
  {
    variant: "gate2-missing", kind: "gate2",
    detect(epic) {
      if (!isOpenspecLane(epic) || withdrawnGate(epic, 2)) return null;
      const gate2 = epic.gateReview && epic.gateReview.gate2;
      return !gate2 || gate2.verdict !== "pass"
        ? { detail: "missing a passing Gate 2 (implementation review) verdict", items: [] } : null;
    },
    remedy: (epic) => [gateRemedy(epic.id, 2)],
  },
  {
    variant: "gate2-withdrawn", kind: "gate2",
    detect(epic) {
      if (!isOpenspecLane(epic)) return null;
      const withdrawal = withdrawnGate(epic, 2);
      // WITHDRAWN IS NOT THE SAME AS NEVER RECORDED. The withdrawal moved the entry out, so the
      // obligation reappears exactly as for an absent gate — but the finding names what happened.
      // The reason is a user value, so it travels as DATA in `items` for each renderer to quote.
      return withdrawal ? { items: [{ reason: withdrawal.reason }], detail:
        "its Gate 2 (implementation review) verdict was withdrawn, and no verdict has been recorded since" } : null;
    },
    remedy: (epic) => [gateRemedy(epic.id, 2)],
  },
  {
    variant: "gate2-stale", kind: "gate2",
    detect(epic) {
      const staleness = staleGate2(epic);
      if (!staleness || staleness.state !== "stale") return null;
      // Recorded values are ESCAPED: a legacy value stored before write-time resolution can carry
      // any character, and a refusal must never let one start a line of its own.
      const esc = (v) => escapeControls(String(v));
      const parts = [];
      if (staleness.uncovered.length) {
        parts.push(`its passing Gate 2 reviewed up to ${esc(staleness.headSha)}, which does not reach ` +
          `the commit(s) attributed to this epic: ${staleness.uncovered.map(esc).join(", ")}`);
      }
      if (staleness.malformed && staleness.malformed.length) {
        parts.push(`its Gate 2 range or attribution holds a value that is not a commit object name ` +
          `(${staleness.malformed.map(v => escapeControls(JSON.stringify(v))).join(", ")}) — a ref or string ` +
          "recorded before write-time resolution, which names no checkable commit");
      }
      return { items: [], detail: parts.join("; and ") };
    },
    remedy: (epic) => [gateRemedy(epic.id, 2, { base: "<parent of the first attributed commit>", head: "<the last attributed commit>" })],
  },
  {
    variant: "gate2-attribution-withdrawn", kind: "gate2",
    detect(epic) {
      const staleness = staleGate2(epic);
      if (!staleness || staleness.state !== "attribution-withdrawn") return null;
      return { items: [], detail: `it carries a passing Gate 2 and attributes no commits, having withdrawn ` +
        `${staleness.withdrawn.length} (${staleness.withdrawn.map(w => escapeControls(String(w.sha))).join(", ")})` };
    },
    remedy: (epic) => [
      gateRemedy(epic.id, 2, { base: REPLACING_PARENT, head: REPLACING }),
      orNoRemedy(() => `update-epic ${printedId(epic.id)} --attribute-commit ${REPLACING}`),
    ],
  },
  {
    variant: "handoff", kind: "handoff",
    detect(epic, { carriedTo } = {}) {
      if (carriedTo) return null;
      const summary = outstandingSummary(epic);
      return summary.outstanding > 0
        ? { items: summary.items, detail: `${summary.outstanding} of ${summary.claimed} task(s) outstanding` } : null;
    },
    // Per source: only the STORIES source has a verb that records a story done. A checkbox source is
    // ticked in its own file, and moved work is recorded with `--carried-to` on the archive itself.
    remedy: (epic) => (outstandingSummary(epic).source === "stories"
      ? [orNoRemedy(() => `update-epic ${printedId(epic.id)} --story <n> --done`)] : []),
    // A checkbox source has no standalone remedy command — no verb ticks a checkbox — so the handoff
    // travels ON the archive invocation itself (design Decision 2: tick the tasks, or record
    // `--carried-to`). EVERY printer offering `--outcome delivered` for such an epic appends these flags
    // — integrity's `delivered-release-epic-left-open` (Gate 2 E-I5) and `heal-archived-epic-passed-gate-2`,
    // update-epic's regression refusal through dispositionInvocation()'s `carry` (Gate 2 R-I1), and
    // blockedDelivered()'s remedy, through deliveredArchiveInvocation() (Gate 2 U-I1);
    // without them the printed archive is refused "task(s) outstanding".
    archiveFlags: (epic) => (outstandingSummary(epic).source === "stories"
      ? [] : ["--carried-to <epicId>", "--reason \"<which tasks moved>\""]),
  },
];

/** The flags a failing obligation needs ON the delivered archive invocation itself (only the handoff
 *  of a checkbox source has any). */
export function obligationArchiveFlags(epic, obligation) {
  const entry = DELIVERED_OBLIGATIONS.find(o => o.variant === obligation.variant);
  return entry && entry.archiveFlags ? entry.archiveFlags(epic) : [];
}

/** The remedy lines for one failing obligation entry (as deliveredObligations() returns it). */
export function obligationRemedy(epic, obligation) {
  const entry = DELIVERED_OBLIGATIONS.find(o => o.variant === obligation.variant);
  // De-duplicated: for a record no verb can rename, every line of a pair is the SAME no-remedy message.
  return entry ? [...new Set(entry.remedy(epic))] : [];
}

/**
 * The obligations a `delivered` outcome carries that FAIL on `epic` (empty when every one is met),
 * selected from DELIVERED_OBLIGATIONS in its order, Gate 2 first.
 *
 * Two callers, and the point of extracting it is that they cannot disagree about what "met" means:
 * archiveGate() (for a REQUESTED `delivered`, passing the request's `--carried-to`, since the epic
 * has no new disposition yet) and update-epic's archived-epic regression check (for a STORED
 * `delivered`, passing the stored `disposition.carriedTo`). So this function does NOT test the
 * outcome, and takes `carriedTo` as an argument rather than reading a disposition.
 *
 * Each entry is `{kind, variant, detail, items}`. `detail` is the FINDING only — never a remedy — and
 * never a user-supplied value: story titles travel as DATA in `items`, and each renderer quotes them
 * its own way. `kind` stays `gate2`/`handoff`; the variant lives in its own field.
 */
export function deliveredObligations(epic, { carriedTo } = {}) {
  const failing = [];
  for (const o of DELIVERED_OBLIGATIONS) {
    const found = o.detect(epic, { carriedTo });
    if (found) failing.push({ kind: o.kind, variant: o.variant, detail: found.detail, items: found.items || [] });
  }
  return failing;
}

export function archiveGate(epic, request = {}) {
  // The interactive verb must name how the work ended. Every OTHER archive path — the
  // archive-drift heal, the archive backfill and the two archived-at-creation paths — supplies
  // no disposition and never reaches this function; each stamps `unknown` with its own
  // `recordedBy` instead, because there is nobody on those paths to ask.
  const { outcome, reason } = request;
  if (outcome === undefined) {
    return { ok: false, message:
      `cannot archive '${escapeControls(epic.id)}' — no outcome recorded. Pass --outcome ` +
      `<${AGENT_OUTCOMES.join("|")}> (and --reason "<why>" for anything but delivered), so ` +
      `the record says how this work ended rather than only that it stopped.` };
  }
  if (!AGENT_OUTCOMES.includes(outcome)) {
    return { ok: false, message:
      `cannot archive '${escapeControls(epic.id)}' — --outcome '${escapeControls(outcome)}' is not one of ` +
      `${AGENT_OUTCOMES.join("|")}. 'unknown' records that nobody was asked, and running this ` +
      `verb means somebody was.` };
  }
  const invalid = dispositionError({ outcome, reason });
  if (invalid) return { ok: false, message: `cannot archive '${escapeControls(epic.id)}' — ${invalid}` };

  // REPLACEMENT, and its refusal. An agent's disposition replaces an ENGINE-stamped one —
  // outcome, reason and timestamp together — because a disposition nobody chose is exactly what
  // an agent is entitled to answer. It is REFUSED against another agent's record, which would
  // destroy a durable judgment somebody made.
  //
  // This rule runs OPPOSITE to its two neighbours and must not be generalized from them: the
  // heal may not overwrite an existing `gate2`, and the migration may not overwrite an existing
  // `disposition`. Both are engine paths overwriting an agent's work. This is an agent
  // correcting a record the engine wrote because nobody was asked — and without it every
  // migration-stamped archived epic is frozen at `unknown` forever.
  //
  // A CORRECTION (#130) is the one way past that refusal, and it is deliberate, self-describing
  // and non-destructive rather than a second door with the same key: `--correct-disposition
  // "<why the recorded one was wrong>"` is never reachable by re-running the ordinary verb, its
  // value is the justification, and the prior record survives verbatim under `superseded` where
  // every surface renders it. Without it a mistyped outcome had NO correction verb at all and
  // the only remaining route was hand-editing state.json — the failure this project's own
  // feedback section already documents, one field over and on the TERMINAL record.
  const existing = epic.disposition;
  const correction = request.correction;
  if (correction !== undefined) {
    const cerr = correctionError({ prior: existing, reason: correction });
    if (cerr) return { ok: false, message: `cannot correct '${escapeControls(epic.id)}' — ${cerr}` };
  } else if (existing && !isEngineStamped(existing)) {
    return { ok: false, message:
      `cannot archive '${escapeControls(epic.id)}' — it already carries an agent-recorded outcome ` +
      `'${outcomeOf(epic)}'${existing.recordedAt ? `, recorded ${existing.recordedAt}` : ""}. ` +
      `Replacing it would destroy a judgment somebody made. If it is WRONG, correct it: add ` +
      `--correct-disposition "<why the recorded one was wrong>", which keeps the prior record ` +
      `readable under it rather than overwriting it.` };
  }

  // The DEFERRAL ASSERTION. The engine has not identified this change's deferrals and cannot,
  // so this refusal names the MISSING ASSERTION and never a list — a message naming specific
  // deferrals would require exactly the prose scanner this design rules out, and shipping it
  // would make the guard's message a guess.
  if (!epic.deferralAssertion && !request.deferralAssertion) {
    return { ok: false, message:
      `cannot archive '${escapeControls(epic.id)}' — no deferral assertion recorded. Say what this change ` +
      `deferred: --deferral "<epicId>:<artifact section>" for work now held by a registered ` +
      `epic, --declined-deferral "<what>::<why not>" for one you are deliberately not doing, ` +
      `or --no-deferrals if there are none. What was deferred is yours to identify; this ` +
      `command does not read your artifacts and will not guess.` };
  }

  // openspec-lane epics may not be archived without a passing Gate 2 (implementation review)
  // verdict — see CLAUDE.md "OpenSpec build — TWO mandatory gates" and recordGateReview().
  // Gate 1 (spec review) gates code, which already happened earlier in the workflow; only
  // Gate 2 blocks archiving. Non-openspec-lane epics are completely unaffected.
  // An ABSENT lane is openspec-lane (isOpenspecLane), so a lane-less epic is held to this
  // gate exactly as a declared one is — it renders as openspec-lane on every surface.
  //
  // The Gate 2 demand binds `delivered` ONLY. A change that ended any other way — killed,
  // superseded, abandoned, declined or unreconstructable —
  // has no passing Gate 2 and never will — the code was never written, or was written and
  // thrown away — so demanding one would make those dispositions recordable only by fabricating
  // a verdict or hand-editing state.json, which are the two failures this release exists to
  // end. For those outcomes the reason the disposition already requires substitutes for the
  // verdict, and the archive proceeds.
  //
  // WHAT the two delivered obligations are lives in deliveredObligations() above, the one
  // definition this gate and update-epic's archived-epic regression check share. This function
  // keeps the REMEDIES: it embeds each failing entry's finding (`detail`) in its own message and
  // re-derives which remedy applies from the epic, so the messages are exactly what they were.
  const failing = outcome === "delivered" ? deliveredObligations(epic, { carriedTo: request.carriedTo }) : [];
  const gate2Failure = failing.find(o => o.kind === "gate2");
  if (gate2Failure) {
    const refusal = `cannot archive openspec-lane epic '${escapeControls(epic.id)}' — ${gate2Failure.detail}.`;
    // Every remedy below is rendered by DELIVERED_OBLIGATIONS, the same lines the regression refusal,
    // `integrity` and `unconsidered-outcomes` print for this obligation, each in its own code span.
    const lines = obligationRemedy(epic, gate2Failure).map(asCode);
    switch (gate2Failure.variant) {
      case "gate2-withdrawn": {
        // A withdrawn Gate 2 quotes its reason, JSON-quoted with every control character escaped, so a
        // reason cannot start a line of the refusal. The obligation is not discharged by a withdrawal.
        const withdrawn = gate2Failure.items.find(i => i && typeof i.reason === "string");
        return { ok: false, message:
          `${refusal} Withdrawal reason: ${escapeControls(JSON.stringify(withdrawn ? withdrawn.reason : ""))}. A ` +
          `withdrawal takes the verdict back; it does not remove the obligation. After a real fresh-context ` +
          `implementation review, record it — ${lines[0]} — or record the outcome the work actually had.` };
      }
      case "gate2-missing":
        return { ok: false, message:
          `${refusal} After a real fresh-context implementation review, record it before archiving: ${lines[0]}.` };
      // A passing verdict that does not reach the commits the epic attributed to itself did not
      // review the code that shipped. Only "stale" refuses: an absent array, an empty one and a
      // git that cannot answer are all reported rather than blocked (gateStaleness).
      //
      // WITHDRAWING EVERY ATTRIBUTION IS NOT A ROUTE THROUGH THIS GATE. Gate 2 found it: an epic
      // whose verdict read `stale` archived cleanly after `--withdraw-commit` emptied the array,
      // because an empty array reads `none-attributed` and that is deliberately not a refusal.
      // A withdrawal says a sha was WRONG, never that the work was never done, so an epic that
      // attributed and then withdrew everything still owes the real range.
      case "gate2-attribution-withdrawn":
        return { ok: false, message:
          `${refusal} A withdrawal corrects the record; it does not remove the obligation. Run both, IN THIS ` +
          `ORDER, then retry: re-record Gate 2 over the commit that actually shipped — ${lines[0]} — then ` +
          `attribute it — ${lines[1]}. Attributing first is refused on an archived record, because the ` +
          "recorded Gate 2 head does not reach the new commit." };
      default:
        return { ok: false, message:
          `${refusal} Re-review the full range and record it — ${lines[0]} — or correct the attribution.` };
    }
  }

  // The HANDOFF. Binds `delivered` only, for the same reason the Gate 2 demand does: killed,
  // superseded, abandoned, declined and unreconstructable already carry a required reason that
  // answers where the work went,
  // and a change killed with every task outstanding by construction would otherwise be refused
  // the exact archive this release exists to make recordable.
  //
  // Keyed on outstandingWork(), never raw checkboxes: a change's own task list carries the task
  // instructing the agent to archive it, unticked at archive time by construction, so a guard
  // counting raw checkbox state would demand a handoff for every fully delivered change.
  const handoffFailure = failing.find(o => o.kind === "handoff");
  if (handoffFailure) {
    // THE BLOCK IS THE REMINDER, so the unfinished work leads and the ways past it come
    // second. A refusal that opened with "record a disposition to proceed" would present
    // disposal as the normal route and get work disposed of that should have been done —
    // a completion prompt turned into a paperwork step, which is worse than no gate.
    //
    // Only the STORIES source can name them: those rows are on the epic and survive archiving.
    // A checkbox source cannot be read here at all — by this point `openspec/changes/<id>/`
    // has moved — so it keeps the unnamed form rather than guessing at titles. The titles come
    // from the finding's `items`, each escaped so a title cannot begin a line of the refusal (and so
    // cannot forge the invocation below it — user-text-never-forges-output repro D).
    const { items } = handoffFailure;
    const named = items.length
      ? ` The outstanding stor${items.length === 1 ? "y is" : "ies are"}:\n` +
        items.map(i => `  [ ] ${i.n}. ${escapeControls(i.title)}`).join("\n") + "\n"
      : " ";
    // The REMEDY IS PER SOURCE, and offering the wrong one is a dead end the caller cannot
    // detect: an inline story has no task source, so `<!-- pm:lifecycle -->` has nowhere to
    // be written and the only key was `--carried-to`, naming a receiver for work that was
    // dropped rather than moved — the fabricated record this very message warns against.
    const remedy = outstandingSummary(epic).source === "stories"
      ? `Finish them, or record what happened to each: ${asCode(obligationRemedy(epic, handoffFailure)[0])} (it shipped) or ` +
        `--story <n> --wont-do "<reason>" (it will not be done, and why — the row and its ` +
        `reason stay on the record). If the whole remainder moved to another epic, ` +
        `--carried-to <epicId> --reason "<which stories moved>" instead.`
      : `Either record where the work went with --carried-to <epicId> --reason "<which tasks ` +
        `moved>", or — if the outstanding item is lifecycle bookkeeping rather than delivery ` +
        `— declare it in the task source by putting the literal ${LIFECYCLE_MARKER} on that ` +
        `task's own line.`;
    return { ok: false, message:
      `cannot archive '${escapeControls(epic.id)}' as delivered — ${handoffFailure.detail}.${named}${remedy} Naming a receiver ` +
      `for work nobody carried anywhere is a fabricated record.` };
  }

  return { ok: true,
    disposition: agentDisposition({ outcome, reason, carriedTo: request.carriedTo,
      corrects: correction !== undefined ? { prior: existing, reason: correction } : undefined }),
    deferralAssertion: request.deferralAssertion };
}
