// scripts/lib/rules.mjs
// The CLAUDE.md managed rules block: tracker/review-mode-aware instruction text, and
// the idempotent writer that keeps it in sync. Depends on lib/state.mjs and
// lib/constants.mjs only — see the design doc for why this is NOT circular with
// lib/tracker.mjs / lib/review-mode.mjs despite first appearances.

import fs from "node:fs";
import { loadState } from "./state.mjs";
import { KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, RULES_BEGIN, RULES_END, CLAUDE_MD } from "./constants.mjs";

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
 *  `system:project:<projectKey>`. */
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
 *  dial and the epic's own `reviewMode` override (if any). */
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

export function rulesBlock(tracker, reviewMode, secondaryTrackers = []) {
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
    "     then run `/pm:detour --minimal \"<what>\"` so it is recorded in `.conductor/detours.log`.",
    "     Then resume.",
    "   - *Substantial* (own design / changes shared behavior / multi-step): run `/pm:detour`.",
    "     It becomes its own epic in the appropriate lane (OpenSpec proposal, Superpowers plan,",
    "     etc.); PUSH the current epic onto the detour stack in `.conductor/state.json` with a",
    "     concrete reason and `reconcileOnResume`.",
    "2. **State of record is `.conductor/state.json`.** After any change to epics, status,",
    "   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.",
    "3. **Resuming after a detour** — use `/pm:resume`. If the popped frame had",
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
    "   registered now with `/pm:epic add … --status planned` (any lane). Planned epics show",
    "   as ordered backlog in `PROJECT.md` and a `planned: N` count in the briefing, without a",
    "   \"no change on disk\" warning; `/pm:sync` flips an openspec planned epic to untriaged once",
    "   its change is proposed. Have a roadmap doc? Read it in-session and load each item this way.",
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
    "and move on. File it: `/pm:feedback [bug|feature] \"<summary>\"` against `cfdude/pm`, or ask",
    "the user \"want me to file this as feedback?\" if you're not sure it's worth it. The failure",
    "mode this guards against is silent: hand-editing `.conductor/state.json` to flip a story's",
    "`done` flag (no CLI verb exists for it) recurred across several separate sessions before",
    "anyone reported it, even though `/pm:feedback` existed the whole time. A filed issue is",
    "cheap; an unreported recurring papercut is not — silent pain is where a product fails its",
    "users.",
  ];
  if (tracker && tracker.system) {
    const sys = tracker.system;
    const scope = tracker.projectKey ? ` · ${tracker.projectKey}` : "";
    // github-issues is deliberately INWARD-only (issues -> untriaged epics, below): auto-filing
    // a GitHub issue for every unmirrored local epic is a much bigger, more consequential
    // default (silently creating public GitHub issues) than mirroring toward an internal
    // Jira/Linear instance, so the outward "External tracker sync" section is suppressed
    // entirely for this system. jira/linear/any other tracker system keeps full bidirectional
    // outward-mirror instructions, unchanged.
    if (sys !== "github-issues") {
      lines.push(
        "",
        `## External tracker sync (${sys}${scope})`,
        "",
        `This repo mirrors conductor epics to **${sys}**. YOU (the interactive agent) own this sync —`,
        `the pm plugin NEVER calls ${sys} itself. On these events, perform the matching action with`,
        "your own tooling (MCP, connector, CLI — whatever this project uses):",
        `- A real epic has no \`externalId\` → create the ${sys} issue, then record its key with`,
        "  `/pm:epic` → `update-epic <id> --external-id <KEY> --external-url <url>`.",
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
    if (sys === "github-issues" && tracker.repo) {
      const repo = tracker.repo;
      lines.push(
        "",
        `## GitHub issue sync (${repo})`,
        "",
        "This tracker is inward: open GitHub issues become conductor epics, same pattern as the",
        "OpenSpec/Superpowers auto-registration `sync` already does for on-disk changes/plans. The",
        "pm plugin NEVER calls `gh` itself — as part of running `/pm:sync`, YOU (the interactive",
        "agent) do:",
        `1. \`gh issue list --repo ${repo} --state open --json number,title,url,labels\`.`,
        "2. For each issue, check whether an epic with that issue number as `externalId` already",
        "   exists (`/pm:epic list` or read `.conductor/state.json`) — if so, skip it (already",
        "   mirrored; re-running sync must never create a duplicate epic for the same issue).",
        "3. Otherwise register a new untriaged epic: `add-epic --status untriaged --external-id",
        "   <issue-number> --external-url <issue-url> --lane claude-code --priority P2`, unless a",
        "   `P0`/`P1`/`P2`/`P3` label is present on the issue, in which case use that label's",
        "   priority instead of the P2 default. `add-epic` itself rejects a duplicate `--external-id`",
        "   as a second line of defense, so a stale local view can't produce a duplicate either.",
        "4. Set `--title` from the issue title so the epic is legible before you triage it further.",
      );
    }
  }
  for (const st of Array.isArray(secondaryTrackers) ? secondaryTrackers : []) {
    if (!st || !st.system) continue;
    const scope = st.repo || st.projectKey || "";
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
      "**Inward pull** — as part of running `/pm:sync`:",
      ...(st.system === "github-issues" && st.repo
        ? [`1. \`gh issue list --repo ${st.repo} --state open --json number,title,url,labels\`.`]
        : [`1. List open issues in ${st.system}${scope ? ` (${scope})` : ""} with your own tooling.`]),
      "2. For each issue, check whether an epic's `externalUrl` already matches that issue's URL",
      "   (`/pm:epic list` or read `.conductor/state.json`) — if so, skip it (already mirrored;",
      "   re-running sync must never create a duplicate epic for the same issue). Match on",
      "   `externalUrl`, not bare `externalId` alone — issue numbers are only unique within one",
      "   tracker/repo, not globally, so two secondary trackers can both have an issue numbered",
      "   the same without being the same issue.",
      "3. Otherwise register a new untriaged epic: `add-epic --status untriaged --external-id",
      "   <issue-number> --external-url <issue-url> --lane claude-code --priority P2`, unless a",
      "   `P0`/`P1`/`P2`/`P3` label is present on the issue, in which case use that label's",
      "   priority instead of the P2 default. Set `--title` from the issue title.",
      "",
      "**Completion status writeback** — when an epic whose `externalUrl` matches this secondary",
      `tracker's ${st.repo ? `repo (\`${st.repo}\`)` : `project (\`${st.projectKey}\`)`} transitions to`,
      "`status: \"archived\"`, close/transition the linked issue here too, using your own",
      "tooling — check its current state first so a re-run does not error on an already-closed",
      "issue.",
    );
  }
  const hasInwardPullTracker = (tracker && tracker.system === "github-issues") ||
    (Array.isArray(secondaryTrackers) && secondaryTrackers.length > 0);
  if (hasInwardPullTracker) {
    lines.push(
      "",
      "## Sync after completing tracker-linked work",
      "",
      "After you close/transition a tracker-linked issue as part of completing an epic (the",
      "writeback steps above), immediately re-sync with your tracker(s) — run `/pm:sync` — to pull",
      "in anything new that appeared while you were heads-down. You're already doing tracker I/O",
      "for this epic, so this is the cheapest moment to catch it; this applies whether you have one",
      "tracker or several (primary + secondary) configured.",
    );
  }
  lines.push(RULES_END, "");
  return lines.join("\n");
}

export function writeRules() {
  let existing = "";
  try { existing = fs.readFileSync(CLAUDE_MD, "utf8"); } catch { /* no CLAUDE.md yet */ }

  const block = rulesBlock(currentTracker(), currentReviewMode(), currentSecondaryTrackers());
  let next;
  if (existing.includes(RULES_BEGIN) && existing.includes(RULES_END)) {
    // refresh in place
    const re = new RegExp(`${RULES_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
    next = existing.replace(re, block);
    process.stderr.write("conductor: refreshed rules block in CLAUDE.md\n");
  } else if (existing.trim()) {
    next = existing.replace(/\n*$/, "\n\n") + block;
    process.stderr.write("conductor: appended rules block to CLAUDE.md\n");
  } else {
    next = "# CLAUDE.md\n\n" + block;
    process.stderr.write("conductor: created CLAUDE.md with rules block\n");
  }
  fs.writeFileSync(CLAUDE_MD, next);
}
