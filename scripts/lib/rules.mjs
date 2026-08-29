// scripts/lib/rules.mjs
// The CLAUDE.md managed rules block: tracker/review-mode-aware instruction text, and
// the idempotent writer that keeps it in sync. Depends on lib/state.mjs and
// lib/constants.mjs only — see the design doc for why this is NOT circular with
// lib/tracker.mjs / lib/review-mode.mjs despite first appearances.

import fs from "node:fs";
import path from "node:path";
import { loadState } from "./state.mjs";
import {
  KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, RULES_BEGIN, RULES_BEGIN_PREFIX, RULES_END, ROOT,
  PLATFORM_COMMAND_PREFIX, anyInwardProcedureEmittable, inwardProcedureEmittable, outwardApplies,
  mirroredEpicIdPrefix, secondaryInwardProcedureEmittable, trackerScope, usesGhIssueList,
} from "./constants.mjs";
import { rulesTarget } from "./platform.mjs";

/** The tracker block from state, or null — used to make emitted instructions tracker-aware. */
export function currentTracker() {
  try { const t = loadState().tracker; return t && t.system ? t : null; } catch { return null; }
}

/** state.secondaryTrackers, or [] — absent/undefined on any pre-existing state.json is a valid
 *  "zero secondary trackers configured" state, not an error. */
export function currentSecondaryTrackers() {
  try {
    const st = loadState().secondaryTrackers;
    return Array.isArray(st) ? st : [];
  } catch { return []; }
}

/** Namespace-prefixed upsert key for a secondary tracker entry — `system:repo:<repo>` or
 *  `system:project:<projectKey>`. A bare `system+repo`/`system+projectKey` concatenation would
 *  let a repo-keyed entry collide with a projectKey-keyed entry sharing the same string value
 *  (e.g. {system:"jira",projectKey:"ABC"} vs {system:"jira",repo:"ABC"}) — the namespace prefix
 *  keeps those two shapes distinct. */
export function secondaryTrackerKey(entry) {
  if (entry.repo) return `${entry.system}:repo:${entry.repo}`;
  return `${entry.system}:project:${entry.projectKey}`;
}

/** Upsert `entry` into `state.secondaryTrackers` by secondaryTrackerKey(), merging onto an
 *  existing match (only the passed-in fields change) rather than appending a duplicate. Mutates
 *  and returns `state`. */
export function upsertSecondaryTracker(state, entry) {
  if (!Array.isArray(state.secondaryTrackers)) state.secondaryTrackers = [];
  const key = secondaryTrackerKey(entry);
  const existing = state.secondaryTrackers.find(e => secondaryTrackerKey(e) === key);
  if (existing) {
    Object.assign(existing, entry);
  } else {
    state.secondaryTrackers.push(entry);
  }
  return state;
}

/** Remove the secondary tracker matching `entry`'s key. Returns true if something was removed. */
export function removeSecondaryTracker(state, entry) {
  if (!Array.isArray(state.secondaryTrackers)) return false;
  const key = secondaryTrackerKey(entry);
  const before = state.secondaryTrackers.length;
  state.secondaryTrackers = state.secondaryTrackers.filter(e => secondaryTrackerKey(e) !== key);
  return state.secondaryTrackers.length < before;
}

/** The repo-global review-mode dial, defaulting to "standard" when unset or invalid. */
export function globalReviewMode(state) {
  const m = state && state.reviewMode;
  return KNOWN_REVIEW_MODES.includes(m) ? m : "standard";
}

/** The active review-mode dial. With no `epicId`, this is just the repo-global dial. With an
 *  `epicId`, returns the EFFECTIVE mode for that epic: the higher-ranked of the repo-global
 *  dial and the epic's own `reviewMode` override (if any) — an epic override can only escalate
 *  above the global dial, never silently de-escalate below it (enforced at write time in
 *  updateEpic(), not here; this is just "take the max" for read time). */
export function currentReviewMode(epicId) {
  try {
    const state = loadState();
    const global = globalReviewMode(state);
    if (!epicId) return global;
    const epic = state.epics.find(e => e.id === epicId);
    const override = epic && KNOWN_REVIEW_MODES.includes(epic.reviewMode) ? epic.reviewMode : null;
    if (!override) return global;
    return REVIEW_MODE_RANK[override] > REVIEW_MODE_RANK[global] ? override : global;
  } catch { return "standard"; }
}

/** The platform's invocation form for a pm command. `pmCmd("codex", "status")` -> "/pm-status".
 *  An unrecognised platform falls back to the claude-code form rather than emitting a broken
 *  string -- the rules block must always name SOMETHING invocable. */
export function pmCmd(platform, name) {
  const prefix = PLATFORM_COMMAND_PREFIX[platform] || PLATFORM_COMMAND_PREFIX["claude-code"];
  return `${prefix}${name}`;
}

/** THE RECIPROCAL of the registration step, emitted into EVERY inward procedure (gh-137).
 *
 *  An inward sync creates an epic from an item and, until this step existed, never ended one.
 *  0.27.0 shipped, all twenty of its member issues were closed on the tracker, and all twenty
 *  conductor epics stayed `queued` with no disposition — after which `next` recommended two P0s
 *  that had shipped hours earlier. The signal was in the sync response the agent was already
 *  reading: the list is of OPEN items, so an epic linked to an item that is not in it has an item
 *  that is no longer open.
 *
 *  PROPOSE, NEVER WRITE, and that is the whole reason this is instruction rather than engine.
 *  The outcome and its required reason are a judgment about what happened to the work — shipped,
 *  killed, replaced, abandoned — and pm may not infer one. An engine-written `delivered` would
 *  also be exactly the unreplaceable, provenance-free disposition gh-130 is about.
 *
 *  ABSENCE FROM THE LIST IS NOT PROOF. An item can be missing because it was deleted,
 *  transferred, moved out of the queried scope, or simply not returned; so the item is READ
 *  before anything is proposed. That read is the same one step 5 asks for, which is why the two
 *  sit together.
 *
 *  ALREADY-ARCHIVED EPICS ARE EXCLUDED BY NAME (gh-138). Half of that issue's 59-epic warning is
 *  work that can never happen — archived, or linked to a closed item — and a step that asked the
 *  agent to revisit an ended epic would be adding to precisely the count that makes a true
 *  warning read as a chore nobody starts.
 *
 *  Emitted from ONE declaration into BOTH inward emitters — the primary's inward section and the
 *  secondary loop. Written inline in one of them, the other is the identical sibling site a
 *  diff-scoped review structurally cannot see. */
function closedItemStep(platform, sys, n = 6) {
  return [
    `${n}. For every epic linked to an item HERE that did NOT appear in the open list you just`,
    "   read, that item is no longer open — the reciprocal of step 2, and the half that ends an",
    "   epic rather than creating one. Absence from an open-item list is not proof on its own (an",
    "   item can be deleted, transferred or moved out of this scope), so READ THE ITEM first.",
    "   Then, where the epic's status is not already `archived`, PROPOSE its disposition to the",
    "   user and let them confirm it — never write one unasked:",
    "   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned|declined --reason \"<why>\" --no-deferrals`.",
    `   WHICH outcome it is, and the reason that goes with it, is a judgment about what happened`,
    `   to the work; ${sys} closing an item does not say which one and pm will not guess. An epic`,
    "   that is already `archived` owes nothing here — it ended, and a record that ended does not",
    `   need a second ending. Then re-render with \`${pmCmd(platform, "status")}\`.`,
  ];
}

/** The gate procedure pm EMITS — as NUMBERED REQUIRED TASK ITEMS, never as review guidance.
 *
 *  The form is load-bearing and it was measured, not guessed: across one audited repository a
 *  rule carried by a mandatory task section reached 14/14 subsequent changes, while the same
 *  rule written as a prose bullet reached 3/15. So this is a LIST that renders numbered, and the
 *  suite fails a bullet.
 *
 *  Declared once here and rendered into the rules block; the `conductor` skill and the command
 *  docs carry the same items as shipped markdown (pm cannot generate its own skill file), and
 *  the suite asserts every surface carries each item so the copies cannot drift.
 *
 *  These bind the text pm OWNS. A change's own `tasks.md` is authored by the `openspec` plugin,
 *  which pm neither owns nor writes — what pm controls is the procedure it hands the agent to
 *  carry into that task list. */
/** The gate-procedure items, and the load-bearing claims each mirrored surface MUST carry.
 *
 *  `mustSay` exists because the drift guard compared TITLES only. Proven live: a mirror's body was
 *  edited to say the OPPOSITE of the generator and the whole suite stayed green — four surfaces
 *  carrying one rule, one fifth of it guarded. The mirrors are deliberately reworded for markdown
 *  (only 1 of 5 bodies matches verbatim), so the guard cannot compare prose; it compares the claims
 *  that must survive rewording. An item added without `mustSay` fails the test rather than
 *  silently widening the gap. */
export const GATE_PROCEDURE_ITEMS = [
  {
    title: "Call-site completeness sweep.",
    mustSay: ["enumerate ALL call sites of the thing being guarded", "DATA reference is a call site"],
    lines: [
      "For every rule, guard or invariant this change introduces",
      "   or modifies, enumerate ALL call sites of the thing being guarded — derived mechanically",
      "   (`rg` for the callers), never a list typed from memory, which goes stale the moment a",
      "   caller is added. Then state where the rule holds and where it does not, and",
      "   justify each omission. A guard added at one call site while an identical sibling site is",
      "   left untouched is a FINDING, not a detail: raise it even though the unedited site never",
      "   appears in the diff. Both gates are diff-scoped and structurally cannot see an edit that",
      "   is absent from a file the diff never touched — the dominant defect class in this",
      "   repository's own audit, ~38 instances in one shard.",
      "   A DATA reference is a call site too: for every field the change adds that holds another",
      "   record's id, enumerate the places that write it, read it and REMOVE it. A deletion path",
      "   that strips one holder and not its siblings leaves a dangling reference — the record",
      "   rendering a pointer to something that no longer exists — and it is invisible to both",
      "   gates for the same diff-scoped reason.",
    ],
  },
  {
    title: "Verify against the commit, not the working tree.",
    mustSay: ["The commit is the unit of verification", "Reading a file in the working tree"],
    lines: [
      "The commit is the unit of verification.",
      "   Reading a file in the working tree is NOT verification. For every task, run",
      "   `git show --stat <that task's sha>` and assert that",
      "   every file the task claims to change appears in THAT commit. A task whose claimed file is",
      "   absent from its commit FAILS, even though the working tree holds the intended edit, the",
      "   suite passes and both gates are green. Audited here: two commits each claimed to remove a",
      "   file's code and neither staged it, because a `git add` with an explicit path list aborted",
      "   on an already-removed path — all four verification layers were reading the working tree,",
      "   so nothing caught it, and it recurred after being written down in a commit message in the",
      "   same epic.",
    ],
  },
  {
    title: "Declare lifecycle bookkeeping.",
    mustSay: ["bookkeeping about the change's own lifecycle", "OR AMENDED"],
    lines: [
      "A task that is bookkeeping about the change's own",
      "   lifecycle rather than its work — above all the task that ARCHIVES THE CHANGE ITSELF, which",
      "   always qualifies — carries the literal marker `<!-- pm:lifecycle -->` ON THE TASK LINE.",
      "   The engine infers this from nothing else: not the wording, not the commands the text",
      "   names, not the position in the file. Mark it at the moment the task source is AUTHORED",
      "   OR AMENDED — a source written before this capability existed gets the marker the first",
      "   time you touch it, or its archive task counts as outstanding work forever.",
    ],
  },
  {
    title: "Attribute every commit to its epic.",
    mustSay: ["only before the first attribution", "MUST NOT be attributed"],
    lines: [
      "At the moment each commit is made, record it:",
      "   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from NOTHING —",
      "   not the files a commit touches, not an epic id in a message — so an unrecorded commit is",
      "   a commit the epic's Gate 2 cannot be checked against. The per-task conventional commit of",
      "   an OpenSpec apply loop always qualifies. Work already in flight is covered too, but ONLY",
      "   BEFORE the first attribution: catch up in the order the commits landed, then keep",
      "   attributing forward. The array is append-only — the engine neither reorders nor",
      "   de-duplicates it — so catching up AFTER attributing forward leaves an ancestor as the",
      "   last entry, and the LAST entry is the endpoint a recorded Gate 2 `headSha` is compared",
      "   against. If forward attribution has already begun, attribute forward only and say so;",
      "   a wrong endpoint reads as a stale verdict and refuses the archive.",
      "   ONE EXCLUSION, and it is not a judgment call: the commit that moves",
      "   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a",
      "   change's artifacts rather than implementing its work, is lifecycle bookkeeping and",
      "   MUST NOT be attributed. That move lands after the reviewed range by construction, so",
      "   attributing it",
      "   makes the epic's own Gate 2 stale at the instant the archive gate reads it.",
    ],
  },
  {
    title: "Review a release's specs against each other.",
    // The third claim is the load-bearing one: the trigger and the verb name would both survive
    // a mirror whose adjudication rule had been deleted or reversed, which is the exact hole
    // `mustSay` was added to close.
    mustSay: ["two or more spec files", "record-cross-spec-review", "A contradiction is never POLISH"],
    lines: [
      "Gate 1 and Gate 2 each take ONE CHANGE",
      "   as their unit, so nothing above them asks whether a release's specs AGREE. Before",
      "   `/opsx:apply` on any release holding two or more spec files — counted FLAT across its",
      "   member changes, so one change carrying six specs qualifies — and again after any round",
      "   of concurrent amendment, dispatch FRESH-CONTEXT reviewers at the release's whole spec",
      "   set (one under `standard`, two with different lenses under `thorough`) and ask the six",
      "   questions: contradiction, double ownership, unmeetable requirements, gaps against the",
      "   proposal's Resolves list, vocabulary forks, and shared chokepoints. Split every finding",
      "   into BLOCKS and POLISH, fix the BLOCKS, decline most POLISH and say why — a review of a",
      "   large document always returns something, so \"no findings\" is not a stopping condition.",
      "   A contradiction is never POLISH. Then record the verdict:",
      "   `record-cross-spec-review <releaseId> --verdict pass|fail --reviewer \"<identity>\"`.",
      "   The engine enumerates the spec set from disk and hashes it, so a spec ADDED to the",
      "   release afterwards — or a reviewed spec amended — marks the verdict stale on every",
      "   surface; a set you assert instead would go stale in exactly the way this gate exists to",
      "   catch. Measured here: this pass returned 5 Critical and 10 Important against six specs",
      "   that had each passed `openspec validate --strict` and would each have passed Gate 1",
      "   alone, including a flagship scenario that was unreachable.",
    ],
  },
  {
    title: "End work by recording a disposition.",
    mustSay: ["ENDS by recording a terminal disposition", "never by removing the record",
      "the gate refuses either half alone"],
    lines: [
      "An epic, a story, a deferral or a release",
      "   exclusion ENDS by recording a terminal disposition carrying its required reason, and",
      "   never by removing the record. The archive verb takes TWO halves in ONE invocation — the",
      "   disposition AND a deferral assertion — because the gate refuses either half alone:",
      "   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned|declined --reason \"<why>\" --no-deferrals`",
      "   (every outcome except `delivered` requires the reason). `--no-deferrals` is the explicit",
      "   \"there are none\" and is a claim, not a default — swap it for `--deferral",
      "   \"<epicId>:<artifact section>\"` where work is now held by a registered epic, or",
      "   `--declined-deferral \"<what>:<why not>\"` where you are deliberately not doing it; both",
      "   repeat, and the engine will not read your artifacts to guess.",
      "   Deletion removes the record of projected work, which is",
      "   precisely what a disposition exists to preserve. `remove-epic` stays available and",
      "   ungated for what it is for: an epic registered in error, a duplicate, a mistake made a",
      "   minute ago — where there is no disposition to record because there was no work.",
    ],
  },
  {
    // gh-127 + gh-132. Both issues are the same move in two directions, and both were filed
    // about a practice that stayed in one repository. The fork is the whole content: the moment
    // of recognition is shared, the destinations are not, and mis-routing buries the finding
    // either way. A required task rather than a prose bullet for the reason this section states
    // out loud — 14/14 against 3/15, and #127 asks for the task form by name.
    title: "Route what the work taught you.",
    mustSay: ["a workaround produces working output", "the evidence goes with it",
      "docs/lessons/", "wrong 7 times in 8"],
    lines: [
      "A change teaches three kinds of thing and each has a",
      "   different destination. Route them BEFORE the change closes, while the evidence is still",
      "   recoverable. Nothing above this asks, so silence here reads as \"nothing was learned\"",
      "   rather than \"nobody looked\", and the two are indistinguishable afterwards.",
      "   A PRACTICE, GATE OR DISCIPLINE you adopted to get this change done: register it as an",
      "   epic, and file it with the tracker as well when it belongs to a product other people",
      "   use. The evidence goes with it — what went wrong that made the practice necessary,",
      "   with numbers. That evidence is the strongest part of the eventual spec and it is",
      "   unrecoverable later; a practice registered without it reads as a preference.",
      "   FRICTION IN THE TOOLING that you routed around: file it — `{{pm:feedback}} [bug|feature]",
      "   \"<summary>\"` for pm itself, and wherever it is tracked for anything else. THIS IS THE",
      "   DIRECTION THAT GETS MISSED, and the reason is mechanical: a workaround produces working",
      "   output, so nothing looks broken and nothing prompts. Hand-editing a file a tool owns",
      "   because no verb exists for it, a command the tool EMITTED that did not run as written,",
      "   a convention you invented that the tool should have supplied, anything you did twice by",
      "   hand that it could have done once — each of those is a filing, not a footnote. Measured:",
      "   two sessions hit one broken recipe in an afternoon, each invented a workaround, neither",
      "   reported it until asked.",
      "   A PROCESS FAILURE — how we work, rather than what the tool should do: a lesson file in",
      "   `docs/lessons/`, carrying its `trigger` written as the situation BEFORE the mistake, a",
      "   concrete `cost`, and `enforced_in` naming where its rule actually binds. Give it a",
      "   `detect:` matcher only where the situation is recognisable with near-certainty — the",
      "   `lesson-advice` hook fires on that matcher before the next mistake, and a hook that is",
      "   wrong 7 times in 8 trains everyone to ignore the one time it is right, so a lesson that",
      "   cannot be matched precisely stays retrieval-only.",
      "   Name which of the three it is out loud. A process lesson filed as a feature request",
      "   never gets built, and a product gap written down as a lesson never gets fixed.",
    ],
  },
];

/** The items, rendered as a numbered markdown list, in the PLATFORM's command form.
 *
 *  An item's `lines` are stored with `{{pm:<name>}}` wherever a pm slash command is named, and
 *  the placeholder is resolved here through pmCmd(). Hardcoding `/pm:feedback` would leak the
 *  Claude Code namespaced form into the codex block, which reaches its commands as prompt-file
 *  stems (`/pm-feedback`) and would be handed a command it cannot run. Kept as a placeholder in
 *  a STRING rather than making `lines` a function of platform, so the mustSay self-check can go
 *  on reading `item.lines` directly. */
export const gateProcedureLines = (platform = "claude-code") => {
  const resolve = (s) => s.replace(/\{\{pm:([a-z-]+)\}\}/g, (_, name) => pmCmd(platform, name));
  return GATE_PROCEDURE_ITEMS.flatMap((item, i) =>
    [`${i + 1}. **${item.title}** ${resolve(item.lines[0])}`, ...item.lines.slice(1).map(resolve)]);
};

/** The INTAKE section (gh-112) — the numbered procedure that runs when an ask arrives, before
 *  it becomes a row. ALWAYS ON: it is governed by no tracker configuration, because it applies
 *  to every path that registers an epic — the tracker-sync procedures further down, the manual
 *  `epic add`, and a roadmap doc read in-session alike. Written once here and pointed at from
 *  nowhere else, so the three paths cannot come to say different things.
 *
 *  The split it encodes is the one this capability exists to draw: `triage` is MECHANICAL and
 *  produces a candidate set; every decision in steps 2-4 is JUDGMENT and is the agent's. The
 *  engine never claims two asks are the same ask, and the section says so out loud so a reader
 *  does not mistake a lexical surface for an answer. */
export const intakeLines = (platform = "claude-code") => [
  "## Intake — triage an ask against the whole backlog BEFORE registering it",
  "",
  "The ask is the ONLY moment the whole backlog is cheap to consider: after registration nothing",
  "ever re-reads it as a set, so an ask that duplicates existing work in another shape becomes a",
  "permanent second epic. The dedup that already exists is IDENTITY-based — same id, or the same",
  "`externalUrl` — which catches a re-run of sync and nothing else. Measured in this plugin's own",
  "repository: four live pairs are one change registered twice under different lanes and",
  "different names, and identity dedup found none of them.",
  "",
  "1. **Get the candidate set mechanically.** Before any `add-epic`, run",
  `   \`${pmCmd(platform, "triage")} "<the ask, in its own words>"\`. It returns the existing epics that share`,
  "   distinctive vocabulary with the ask (each with the shared tokens that put it there), the",
  "   lane this repo's routing picks, and the backlog's current shape. It returns",
  "   `verdict: null` and that is not a placeholder: the engine computes what is WORTH READING",
  "   and never decides. Nothing about a lexical overlap is a claim that two asks are the same.",
  "2. **READ the candidates — do not skim the scores.** Open each one that could plausibly be",
  "   the same work. A high score with unrelated intent is a miss; a low score on an epic whose",
  "   description turns out to cover the ask is a hit. This is the judgment the surface exists",
  "   to make cheap, and it is yours.",
  "3. **Record the relationship you found**, rather than leaving it in the conversation:",
  "   `add-epic … --link \"relates-to:<id>:<why>\"` where the two asks inform each other;",
  "   `--link \"supersedes:<id>:<why>\"` where this ask REPLACES an existing epic — then end the",
  "   superseded one with its own disposition (`--outcome superseded --reason \"<what replaced",
  "   it>\"`), because a consolidation that leaves both epics open has consolidated nothing.",
  "   A candidate `triage` marks `superseded: true` is already dead — do not consolidate into it.",
  "4. **Say no out loud when the answer is no.** Not every ask should be taken on, and declining",
  "   by never registering it destroys the record that anybody considered it. Register it, then",
  "   `update-epic <id> --status archived --outcome declined --reason \"<why not>\" --no-deferrals`.",
  "   Two commands, deliberately: creating an epic directly at `archived` stamps an engine record",
  "   carrying no reason, which is the silence this step removes.",
  "",
  "**This is not a substitute for the identity dedup in the sync procedures below, and they are",
  "not a substitute for it.** A URL match answers \"have I already mirrored THIS item\"; triage",
  "answers \"is this ask already in the backlog under another name\". Run both.",
];

// #105: `gh` and an authenticated GitHub account are an UNDECLARED dependency of the emitted
// `gh issue list` step. THE one declaration of the preflight, so the PRIMARY and SECONDARY
// inward sections cannot come to state it differently — or state it at one site and not the
// other, which is how the direction rule went wrong here before. Unlike `/pm:feedback`, which
// files OUTWARD and has credential-free fallbacks (a prefilled issue form, email), an inward
// sync is a READ of the tracker and has none: anonymous listing is not available, so the honest
// instruction is to say the step cannot run rather than to report a clean sync nobody performed.
const GH_PREFLIGHT =
  "   Preflight, BEFORE running that line: this step needs the `gh` CLI **and** an authenticated " +
  "GitHub account — `command -v gh` and `gh auth status`. If either is missing, say so, name " +
  "what to install or authenticate, and STOP this section; an inward sync is a READ and has no " +
  "credential-free substitute, so reporting a clean sync you could not perform is worse than " +
  "reporting that you could not perform it.";

export function rulesBlock(tracker, reviewMode, secondaryTrackers = [], platform = "claude-code") {
  const mode = KNOWN_REVIEW_MODES.includes(reviewMode) ? reviewMode : "standard";
  const lines = [
    RULES_BEGIN,
    "## PM Conductor — operating rules",
    "",
    "This repo is managed by the `pm` plugin. The conductor sits ABOVE OpenSpec and Superpowers.",
    "Epics are **lane-agnostic** (openspec | superpowers | claude-code | decision | external);",
    "OpenSpec is one lane. Stories come from each epic's source (OpenSpec `tasks.md`, a Superpowers",
    "plan, or a manual list). Follow these rules:",
    "",
    "1. **Detours** — when something blocks the active epic, CLASSIFY before fixing:",
    "   - *Minimal* (small, self-contained, no design ambiguity): fix → test → commit → push,",
    `     then run \`${pmCmd(platform, "detour")} --minimal "<what>"\` so it is recorded in \`.conductor/detours.log\`.`,
    "     Then resume.",
    `   - *Substantial* (own design / changes shared behavior / multi-step): run \`${pmCmd(platform, "detour")}\`.`,
    "     It becomes its own epic in the appropriate lane (OpenSpec proposal, Superpowers plan,",
    "     etc.). Register that epic FIRST, then PUSH the current one onto the detour stack with",
    "     `push-detour <parent> --detour <new-id> --reason \"<why>\" (--reconcile | --no-reconcile)`.",
    "     NEVER hand-edit `.conductor/state.json` to push or pop a frame. The verb IS the",
    "     transition, and it is what supplies the validation, the write-conflict guard, the",
    "     read-back verification and the Honcho line a hand-edit has none of. Exactly one of the",
    "     two reconcile flags is REQUIRED and there is no default: whether the detour can",
    "     invalidate the paused epic's plan is a judgment, and a default makes an absent decision",
    "     look like a considered one. Say `--reconcile` unless you are certain the detour touches",
    "     nothing the paused epic depends on.",
    "2. **State of record is `.conductor/state.json`.** After any change to epics, status,",
    `   priority, or the detour stack, re-render with \`${pmCmd(platform, "status")}\`. Never hand-edit \`PROJECT.md\`.`,
    `3. **Resuming after a detour** — use \`${pmCmd(platform, "resume")}\`, which pops the frame with`,
    "   `pop-detour [<paused-id>]` — again a verb, never a hand-edit. It removes the frame,",
    "   resumes the epic and writes `reconcileNeeded` in the SAME write, which is what makes the",
    "   obligation survive the frame's removal. If the popped frame had",
    "   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code,",
    "   then write its verdict back durably with `record-reconcile <id> --detour <id>",
    "   --verdict valid|invalidated [--amendments \"<a>;<b>\"]` — this attaches",
    "   `{verdict, amendments, reconciledAt}` to the paused epic's link to the detour and",
    "   clears `reconcileNeeded`, instead of the judgment only ever living in conversation.",
    "4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho",
    "   (\"paused X for Y\" / \"resumed X, reconciled vs Y\") so the relationship survives outside",
    "   this repo. `push-detour` prints the PUSH line for you and logs it to",
    "   `.conductor/honcho-memories.log`; paste it into your Honcho tool call. `pop-detour` prints",
    "   the POP line only when nothing needs reconciling — with a gate armed, \"reconciled vs Y\" is",
    "   not yet true, so emit it with `honcho-memory pop <id> \"<detour>; reconcile = …\"` after the",
    "   verdict. The engine formats and logs; it never calls Honcho itself.",
    "5. **Keep `tasks.md` checkboxes truthful** — they are the source of truth for story progress.",
    "6. **Roadmap as backlog** — work you intend to do but haven't proposed yet can be",
    `   registered now with \`${pmCmd(platform, "epic")} add … --status planned\` (any lane). Planned epics show`,
    "   as ordered backlog in `PROJECT.md` and a `planned: N` count in the briefing, without a",
    `   "no change on disk" warning; \`${pmCmd(platform, "sync")}\` flips an openspec planned epic to untriaged once`,
    "   its change is proposed. Have a roadmap doc? Read it in-session and load each item this way.",
    "",
    "## The gate procedure — required task items",
    "",
    "Every item below is a NUMBERED REQUIRED TASK ITEM in the change's own task list, carried",
    "into both gates. They are not review guidance and must not be restated as prose bullets:",
    "measured across one audited repository, a rule carried by a mandatory task section reached",
    "14/14 subsequent changes, while the same rule written as a prose bullet reached 3/15.",
    "",
    ...gateProcedureLines(platform),
    "",
    ...intakeLines(platform),
    "",
    "## Epic-level autonomy",
    "",
    "An epic's `autonomy` block (`.conductor/state.json`) can grant it broad execution trust —",
    "`level: \"off\"` by default (today's behavior, unchanged). Setting `level: \"autonomous\"`",
    "removes the need to ask before each phase transition, but NEVER removes a genuine safety stop.",
    "This is development-time only — it never covers actions with irreversible EXTERNAL side",
    "effects (sending email/Slack, deploying to production, third-party API calls, pushing to a",
    "shared branch); those are out of scope regardless of autonomy level.",
    "",
    "1. **Preflight before flipping the switch** — see the `conductor` skill's",
    "   \"Epic-level autonomy — the preflight scan\" section for the full process. In short: read",
    "   the epic's full source, produce a short batch of destructive-risk-points +",
    "   genuine-unknowns questions, get the user's answers, THEN record them:",
    "   `set-autonomy <id> --preauthorize \"<action>:<reason>\"` / `--context \"<note>\"`, and only",
    "   then `set-autonomy <id> --level autonomous`. For routine, repeated categories of action",
    "   instead of enumerating each one, use the shorthand",
    "   `--preauthorize \"category:<filesystem|network|schema|external-api>:<reason>\"` — see the",
    "   `conductor` skill's \"Epic-level autonomy\" section for the exact keyword heuristic each",
    "   category matches at decision-rule time.",
    "2. **Execution-time decision rule** — check every destructive action against these, in",
    "   order, before treating it as a stop:",
    "   a. Already pre-authorized in the preflight — either an exact `action` match or the",
    "      action falls under a granted `category` (per the category heuristic)? → proceed,",
    "      record via `--notify`.",
    "   b. No backup/restore path exists? → STOP regardless of autonomy level.",
    "   c. Destructive but restorable (backed up first)? → WARN — `--notify` it immediately, proceed.",
    "   d. No context to act on? → STOP — a real gap, not a false stall.",
    "   e. Consequential and not yet notified? → `--notify` it immediately, then proceed.",
    "3. **Notify incrementally, not at the end** — `--notify` writes durably to `state.json`'s",
    "   `notifications[]` the moment a WARN-class (c) or consequential (e) decision is made. Do this",
    "   AS EACH DECISION HAPPENS, not batched — a session can be compacted or interrupted mid-epic,",
    "   and anything not yet `--notify`'d is lost when that happens.",
    "4. **End-of-epic report** — on completion, read back the accumulated `notifications[]` and",
    "   report what was asked, what was done, and the decisions made in the user's absence (drawn",
    "   from that log, not from memory), with an explicit \"are you OK with these?\" checkpoint, THEN",
    "   run tests. Leave room to iterate — including rewriting code — if the user is not satisfied.",
    "",
    "## Review mode",
    "",
    "Review intensity is a bounded dial, not a free-form call each time — set via",
    "`set-review-mode --mode <off|standard|thorough>` (default: `standard` if never set).",
    "",
    "| Mode | Reviewer budget | Trigger |",
    "|------|-----------------|---------|",
    "| `off` | none — self-review only | tiny, low-risk, single-file claude-code tweaks |",
    "| `standard` | one fresh-context reviewer per gate | the default: OpenSpec Gate 1/Gate 2, a Superpowers task review |",
    "| `thorough` | two independent fresh-context reviewers per gate; adjudicate any disagreement yourself | schema/migration changes, security-sensitive work, or anything explicitly flagged high-stakes |",
    "",
    `Current mode: **${mode}**.`,
    "",
    "## Feedback — don't let friction stay silent",
    "",
    "If you hit a bug, a missing CLI verb, an unexpected limitation, or repeated friction",
    "working with this plugin — in this repo or any repo using it — don't just work around it",
    `and move on. File it: \`${pmCmd(platform, "feedback")} [bug|feature] "<summary>"\` against \`cfdude/pm\`, or ask`,
    "the user \"want me to file this as feedback?\" if you're not sure it's worth it. The failure",
    "mode this guards against is silent: hand-editing `.conductor/state.json` to flip a story's",
    "`done` flag (no CLI verb exists for it) recurred across several separate sessions before",
    `anyone reported it, even though \`${pmCmd(platform, "feedback")}\` existed the whole time. A filed issue is`,
    "cheap; an unreported recurring papercut is not — silent pain is where a product fails its",
    "users.",
  ];
  if (tracker && tracker.system) {
    const sys = tracker.system;
    // What the tracker names as its scope, read from the ONE definition (constants.mjs's
    // trackerScope) rather than picked out of the tracker object here. The inward section
    // cannot be emitted without it — a "list open items in <scope>" step with nothing to
    // substitute is a command that cannot run as written, which is the rule this block is
    // held to. The outward heading keeps its own projectKey-only suffix: it names the
    // tracker for a human and has never depended on a scope being present.
    const scope = trackerScope(tracker);
    const outwardScopeSuffix = tracker.projectKey ? ` · ${tracker.projectKey}` : "";
    // DIRECTION decides this, never the vendor's name. The test that used to live here
    // (`sys !== "github-issues"`) encoded one repo's convention as a property of a vendor, and
    // it was applied at this emitter and not at the brief's — so a github-issues repo received a
    // rules block with no outward instructions and a brief demanding outward action for 29
    // epics (#109). `outwardApplies` is resolved once in constants.mjs and read by both.
    if (outwardApplies(tracker)) {
      lines.push(
        "",
        `## External tracker sync (${sys}${outwardScopeSuffix})`,
        "",
        `This repo mirrors conductor epics to **${sys}**. YOU (the interactive agent) own this sync —`,
        `the pm plugin NEVER calls ${sys} itself. On these events, perform the matching action with`,
        "your own tooling (MCP, connector, CLI — whatever this project uses):",
        `- A real epic has no \`externalId\` → create the ${sys} issue, then record its key with`,
        `  \`${pmCmd(platform, "epic")}\` → \`update-epic <id> --external-id <KEY> --external-url <url>\`.`,
        "- An epic moves to a status with a `statusIntent` (e.g. active/archived) → transition the",
        "  linked issue toward that SEMANTIC target, resolving the real workflow transition yourself.",
        `- A parent epic → create it as a ${sys} epic and link its children.`,
        "The SessionStart brief lists epics not yet mirrored under `TRACKER SYNC`. Status-transition",
        "sync is your responsibility on every status change (the brief does not fabricate it).",
        "",
        "**Epic-level autonomy on tracker-linked epics:** before running the preflight scan on a",
        `tracker-linked epic, pull the ${sys} issue + its child stories/subtasks with your own`,
        "tracker tools (the same ones you use for status sync) — that IS its source, not a local",
        "file alone. Mirror the preflight Q&A as a comment on the issue for visibility — this is a",
        "non-authoritative echo, `.conductor/state.json` stays the sole source of truth. If the",
        "tracker issue changes materially after the preflight snapshot, treat that as decision-rule",
        "item (d) — mid-run drift is a new genuine unknown, not something autonomy silently absorbs.",
      );
    }
    // The inward section needs its OWN predicate, separate from direction: a tracker whose
    // direction includes `inward` but which names no scope has nothing to put in the "list open
    // items in …" step, and pm may not emit a command line with an unfilled placeholder.
    if (inwardProcedureEmittable(tracker)) {
      // Vendor-neutral by construction. `github-issues` keeps its literal `gh issue list` step —
      // the one system whose CLI pm can name concretely — and every other system receives the
      // same "list open items … with your own tooling" phrasing the SECONDARY path has emitted
      // all along. The primary slot alone lacked it, which is why an inward jira tracker could
      // not be expressed at all.
      const gh = usesGhIssueList(tracker);
      const idPrefix = mirroredEpicIdPrefix(tracker);
      lines.push(
        "",
        gh ? `## GitHub issue sync (${scope})` : `## Inward tracker sync (${sys} · ${scope})`,
        "",
        `This tracker is inward: open items in ${sys} become conductor epics, same pattern as the`,
        "OpenSpec/Superpowers auto-registration `sync` already does for on-disk changes/plans. The",
        `pm plugin NEVER calls ${sys} itself — as part of running \`${pmCmd(platform, "sync")}\`, YOU (the interactive`,
        "agent) do:",
        ...(gh
          ? [`1. \`gh issue list --repo ${scope} --state open --json number,title,url,updatedAt,labels\`.`, GH_PREFLIGHT]
          : [`1. List open items in ${sys} (${scope}) with your own tooling, reading each item's id, title, url and updated timestamp.`]),
        "2. For each item, check whether an epic's `externalUrl` already matches that item's URL",
        `   (\`${pmCmd(platform, "epic")} list\` or read \`.conductor/state.json\`) — if so, skip it (already`,
        "   mirrored; re-running sync must never create a duplicate epic for the same item). Match",
        "   on `externalUrl` when both sides carry one, never on a bare `externalId`: item numbers",
        "   are unique only within one tracker/repo, so two trackers can each hold an item numbered",
        "   the same without those being the same item. Where one side has no URL, they are not a",
        "   duplicate either — a URL-less legacy epic must not block a genuinely distinct item.",
        "3. Otherwise register a new untriaged epic, running this line as written with only its",
        "   placeholders filled in:",
        `   \`add-epic --id ${idPrefix}-<issue-number> --title "<issue-title>" --status untriaged --external-id <issue-number> --external-url <issue-url> --external-updated-at <issue-updated-at> --lane <lane> --priority P2\``,
        "   Take `<lane>` from LANE ROUTING, never a fixed value: run `suggest-lane \"<issue-title>\"`",
        "   and use the lane it returns; when it returns none, apply this repo's generic lane",
        "   heuristic. The lane decides whether the work leaves any spec, plan or gate record, so",
        "   a hardcoded one decides that silently for every mirrored item. If the routed lane is",
        "   wrong for a particular item, register it in the lane you judge correct and record the",
        "   reason on the epic: `update-epic <id> --notes \"lane: <chosen> not <routed> — <why>\"`.",
        `   The id is DERIVED, never invented: \`${idPrefix}-<issue-number>\` — this tracker's`,
        "   system and scope, then the item's own number. The same item therefore yields the same",
        "   epic id in every repo and every session, so a second registration of it is refused as a",
        "   duplicate instead of landing as a second epic under a different invented slug. Use a",
        "   `P0`/`P1`/`P2`/`P3` label's priority when the item carries one, `P2` otherwise.",
        "4. Set `--title` from the item title so the epic is legible before you triage it further.",
        "5. For every epic ALREADY linked to an item here, compare that item's tracker-side",
        "   updated timestamp against the epic's `externalUpdatedAt` watermark, and READ the ones",
        "   whose timestamp is newer. Record what you read with `update-epic <id>",
        "   --external-updated-at <iso>` (or `record-tracker-refresh` when you owe a verdict) —",
        "   seeing an item in the list response is not reading it, so listing alone must never",
        "   advance the watermark or sync erases the drift it exists to find.",
        ...closedItemStep(platform, sys),
      );
    }
  }
  // SECONDARY sections are NOT governed by the scope-lessness rule that guards the primary's
  // inward section above, and that is deliberate: `tracker-sync` says the requirement "MUST NOT
  // be generalized to them", because a secondary is pinned inward by definition and
  // registration already refuses one carrying neither `--repo` nor `--project`. The gate here
  // is therefore "is this a registered secondary" and nothing more — and it is the SAME
  // predicate `anyInwardProcedureEmittable` consumes, so this emitter and the completion-sync
  // reminder below cannot answer the same question differently. They did: this loop's guard was
  // written out locally while the reminder ran every secondary through the PRIMARY's predicate.
  //
  // The scope is read through `trackerScope` rather than re-derived as `st.repo ||
  // st.projectKey` here. A second local reading is how the heading came to name a scope the
  // emitted `add-epic --id` line rendered as `null`. `role` is normalized because registration
  // stamps it and this reading depends on it — a legacy entry written without it must not fall
  // through to the primary's vendor rule.
  for (const raw of Array.isArray(secondaryTrackers) ? secondaryTrackers : []) {
    if (!secondaryInwardProcedureEmittable(raw)) continue;
    const st = { ...raw, role: "secondary" };
    const scope = trackerScope(st) || "";
    lines.push(
      "",
      `## Secondary tracker sync (${st.system}${scope ? ` · ${scope}` : ""})`,
      "",
      `This is a SECONDARY tracker — inward pull + completion writeback only. YOU (the interactive`,
      `agent) own this sync — the pm plugin NEVER calls ${st.system} itself. A secondary tracker`,
      "NEVER gets outward-created issues: a new local epic, or an epic's status change, never",
      "causes you to create or transition an issue here — that stays exclusive to the primary",
      "tracker above (if configured).",
      "",
      `**Inward pull** — as part of running \`${pmCmd(platform, "sync")}\`:`,
      ...(usesGhIssueList(st)
        ? [`1. \`gh issue list --repo ${st.repo} --state open --json number,title,url,labels\`.`, GH_PREFLIGHT]
        : [`1. List open issues in ${st.system}${scope ? ` (${scope})` : ""} with your own tooling.`]),
      "2. For each issue, check whether an epic's `externalUrl` already matches that issue's URL",
      `   (\`${pmCmd(platform, "epic")} list\` or read \`.conductor/state.json\`) — if so, skip it (already mirrored;`,
      "   re-running sync must never create a duplicate epic for the same issue). Match on",
      "   `externalUrl` when both sides carry one, never on a bare `externalId` — issue numbers",
      "   are unique only within one tracker/repo, so two secondary trackers can each hold an",
      "   issue numbered the same without those being the same issue. Where one side has no URL",
      "   at all, they are not a duplicate either: a URL-less legacy epic must not block a",
      "   genuinely distinct issue that happens to share its bare number.",
      "3. Otherwise register a new untriaged epic, running this line as written with only its",
      "   placeholders filled in:",
      `   \`add-epic --id ${mirroredEpicIdPrefix(st)}-<issue-number> --title "<issue-title>" --status untriaged --external-id <issue-number> --external-url <issue-url> --external-updated-at <issue-updated-at> --lane <lane> --priority P2\``,
      "   Take `<lane>` from LANE ROUTING, never a fixed value: run `suggest-lane \"<issue-title>\"`",
      "   and use the lane it returns; when it returns none, apply this repo's generic lane",
      "   heuristic. If the routed lane is wrong for a particular item, register it in the lane you",
      "   judge correct and record the reason on the epic with `update-epic <id> --notes \"…\"`.",
      `   The id is DERIVED from this tracker's system and scope: \`${mirroredEpicIdPrefix(st)}-<issue-number>\`,`,
      "   so the same item yields the same epic id everywhere, and issue `#42` in two different",
      "   secondary repos derives two DISTINCT ids rather than colliding. Use a `P0`/`P1`/`P2`/`P3`",
      "   label's priority when the issue carries one, `P2` otherwise.",
      ...closedItemStep(platform, st.system, 4),
      "",
      "**Completion status writeback** — when an epic whose `externalUrl` matches this secondary",
      `tracker's ${st.repo ? `repo (\`${st.repo}\`)` : `project (\`${st.projectKey}\`)`} transitions to`,
      "`status: \"archived\"`, close/transition the linked issue here too, using your own",
      "tooling — check its current state first so a re-run does not error on an already-closed",
      "issue.",
    );
  }
  // The reminder points the agent at "the writeback steps above", so it may only be emitted
  // where those steps ARE above it. The test it replaced fired for ANY github-issues primary,
  // including one with no `repo` — a block whose only inward instruction was the reminder's own
  // reference to instructions it did not contain. This is one of exactly two deliberate
  // emitted-output changes on the un-upgraded path, and it is a repair of a dangling pointer.
  if (anyInwardProcedureEmittable(tracker, secondaryTrackers)) {
    lines.push(
      "",
      "## Sync after completing tracker-linked work",
      "",
      "After you close/transition a tracker-linked issue as part of completing an epic (the",
      `writeback steps above), immediately re-sync with your tracker(s) — run \`${pmCmd(platform, "sync")}\` — to pull`,
      "in anything new that appeared while you were heads-down. You're already doing tracker I/O",
      "for this epic, so this is the cheapest moment to catch it; this applies whether you have one",
      "tracker or several (primary + secondary) configured.",
    );
  }
  // The refresh gate — instruction, always, whether or not any tracker is configured. It keys on
  // PROVENANCE, so it has something to say for every epic: the tracker-linked case records a
  // verdict, the local-origin case records nothing at all.
  lines.push(
    "",
    "## Re-read the source before an epic becomes the work",
    "",
    "An epic becoming active is the moment specs or a plan get drawn for it. Before that, re-read",
    "what it is FOR. Which source depends on provenance, never on any tracker's direction:",
    "- The epic has an `externalId` → re-read the LINKED ITEM (body, comments, labels, state), then",
    "  record what you found: `record-tracker-refresh <id> --verdict unchanged|material-change",
    "  --external-updated-at <iso> [--summary \"<what changed>\"]`. The timestamp is the tracker's",
    "  own, never a local clock reading, and recording it clears the obligation.",
    "- The epic has NO `externalId` → re-read its local source: its plan document, or its OpenSpec",
    "  proposal plus its tasks. This one is instruction only — nothing is recorded in state for it,",
    "  and `record-tracker-refresh` refuses such an epic by name rather than accepting a verdict",
    "  about a linked item that does not exist.",
    "An outward-mirrored epic owes the same look as an inward-born one: a linked item accumulates",
    "third-party context regardless of which way it was born. Origin decides only whose ask wins",
    "when the item and a local spec disagree.",
  );
  lines.push(RULES_END, "");
  return lines.join("\n");
}

/** Write (or refresh) the managed rules block into whichever file `platform`'s precedence
 *  chain resolves to (see rulesTarget()) -- NOT always CLAUDE.md. A repo that already has an
 *  AGENTS.md and is driven by Hermes must get the block IN AGENTS.md: Hermes resolves project
 *  context first-match-wins over HERMES.md > AGENTS.md > CLAUDE.md, so writing CLAUDE.md there
 *  would be silently invisible to it. Returns the absolute path written, so callers can report
 *  it; existing callers that ignore the return value are unaffected. */
export function writeRules(platform = "claude-code") {
  const target = rulesTarget(platform, ROOT);
  const name = path.basename(target);

  let existing = "";
  try { existing = fs.readFileSync(target, "utf8"); } catch { /* target does not exist yet */ }

  const block = rulesBlock(currentTracker(), currentReviewMode(), currentSecondaryTrackers(), platform);
  let next;
  if (existing.includes(RULES_BEGIN_PREFIX) && existing.includes(RULES_END)) {
    // Refresh in place. Match from the stable PREFIX, not the full decorated RULES_BEGIN, so
    // a block written by an older version (different parenthetical) is still found and
    // upgraded rather than duplicated -- see the comment on RULES_BEGIN_PREFIX.
    const re = new RegExp(`${RULES_BEGIN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
    next = existing.replace(re, block);
    process.stderr.write(`conductor: refreshed rules block in ${name} (platform: ${platform})\n`);
  } else if (existing.trim()) {
    next = existing.replace(/\n*$/, "\n\n") + block;
    process.stderr.write(`conductor: appended rules block to ${name} (platform: ${platform})\n`);
  } else {
    next = `# ${name}\n\n` + block;
    process.stderr.write(`conductor: created ${name} with rules block (platform: ${platform})\n`);
  }
  fs.writeFileSync(target, next);
  return target;
}
