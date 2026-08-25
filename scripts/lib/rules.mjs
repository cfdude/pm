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
export const GATE_PROCEDURE_ITEMS = [
  {
    title: "Call-site completeness sweep.",
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
    lines: [
      "At the moment each commit is made, record it:",
      "   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from NOTHING —",
      "   not the files a commit touches, not an epic id in a message — so an unrecorded commit is",
      "   a commit the epic's Gate 2 cannot be checked against. The per-task conventional commit of",
      "   an OpenSpec apply loop always qualifies. Work already in flight is covered too: attribute",
      "   the commits already made before catching up, in the order they landed, because the LAST",
      "   entry is the endpoint a recorded Gate 2 `headSha` is compared against.",
      "   ONE EXCLUSION, and it is not a judgment call: the commit that moves",
      "   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a",
      "   change's artifacts rather than implementing its work, is lifecycle bookkeeping and",
      "   MUST NOT be attributed. That move lands after the reviewed range by construction, so",
      "   attributing it",
      "   makes the epic's own Gate 2 stale at the instant the archive gate reads it.",
    ],
  },
  {
    title: "End work by recording a disposition.",
    lines: [
      "An epic, a story, a deferral or a release",
      "   exclusion ENDS by recording a terminal disposition carrying its required reason —",
      "   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned",
      "   --reason \"<why>\"` (every outcome except `delivered` requires the reason) — and",
      "   never by removing the record. Deletion removes the record of projected work, which is",
      "   precisely what a disposition exists to preserve. `remove-epic` stays available and",
      "   ungated for what it is for: an epic registered in error, a duplicate, a mistake made a",
      "   minute ago — where there is no disposition to record because there was no work.",
    ],
  },
];

/** The items, rendered as a numbered markdown list. */
export const gateProcedureLines = () =>
  GATE_PROCEDURE_ITEMS.flatMap((item, i) => [`${i + 1}. **${item.title}** ${item.lines[0]}`, ...item.lines.slice(1)]);

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
    "     etc.); PUSH the current epic onto the detour stack in `.conductor/state.json` with a",
    "     concrete reason and `reconcileOnResume`.",
    "2. **State of record is `.conductor/state.json`.** After any change to epics, status,",
    `   priority, or the detour stack, re-render with \`${pmCmd(platform, "status")}\`. Never hand-edit \`PROJECT.md\`.`,
    `3. **Resuming after a detour** — use \`${pmCmd(platform, "resume")}\`. If the popped frame had`,
    "   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code,",
    "   then write its verdict back durably with `record-reconcile <id> --detour <id>",
    "   --verdict valid|invalidated [--amendments \"<a>;<b>\"]` — this attaches",
    "   `{verdict, amendments, reconciledAt}` to the paused epic's link to the detour and",
    "   clears `reconcileNeeded`, instead of the judgment only ever living in conversation.",
    "4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho",
    "   (\"paused X for Y\" / \"resumed X, reconciled vs Y\") so the relationship survives outside",
    "   this repo.",
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
    ...gateProcedureLines(),
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
          ? [`1. \`gh issue list --repo ${scope} --state open --json number,title,url,updatedAt,labels\`.`]
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
        ? [`1. \`gh issue list --repo ${st.repo} --state open --json number,title,url,labels\`.`]
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
