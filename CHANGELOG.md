# Changelog

All notable changes to the `pm` plugin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [0.23.1] — 2026-07-23

### Fixed

- **`/pm:upgrade`'s own instructions now defend against a real misread: an agent treating the
  command invocation itself as passive local-command output and skipping it entirely.** When
  `/reload-plugins` and `/pm:upgrade` land in the same turn — the exact sequence this command's
  own preamble recommends — the harness wraps that turn's local command output in a caveat meant
  for `/reload-plugins`'s passive stdout, and an agent can over-apply that caveat to `/pm:upgrade`
  itself. Self-inflicted by this command's own documented workflow, not fixable by controlling
  the harness, so the command's own text now states plainly: if you're seeing these instructions,
  the command was invoked — execute it.

## [0.23.0] — 2026-07-21

### Added

- **`update-epic <id> --add-story "<title>"` and `update-epic <id> --story <n> --done`.**
  Closes a recurring hand-edit-of-`state.json` risk for inline `stories[]` — the toggle gap
  alone recurred across several sessions per user feedback, and the add gap was hit live
  again this session. `--add-story` appends `{ title, done: false }` (creating the array on
  its first inline story); `--story <n>` is **1-indexed** and currently requires `--done` (the
  only supported mutation today) — both reject out-of-range/empty input and write nothing on
  failure. Documented in README.md and `skills/conductor/SKILL.md`.
- **`render --diff-summary`** — prints `epic-relevant: yes` or `epic-relevant: no` after
  rendering. The "Last rendered" timestamp and the "Recent detours" table (which rotates as
  new entries land) both change PROJECT.md on nearly every render even when nothing about the
  epics themselves changed, forcing manual `git diff` eyeballing before every "is this safe to
  discard" call — and this repo hit a near-miss where a legitimately-updated PROJECT.md was
  discarded as assumed noise. `--diff-summary` normalizes both known-trivial sources away and
  reports whether anything else differs, making the check mechanical. A PROJECT.md that's
  never been rendered before always reports `yes` (no baseline to compare against).

### Fixed

- **The `conductor: engine <version> @ <path>` banner no longer prints on every single
  invocation in a self-hosting/dev context.** It's now suppressed by default whenever
  `CLAUDE_PROJECT_DIR` is set (the stale-cache scenario the banner exists to guard against is
  unlikely there) — set `PM_VERBOSE_ENGINE_BANNER=1` to force it back on. The existing
  `PM_QUIET_ENGINE_BANNER=1` explicit-suppress opt-out still works unchanged outside that
  context (e.g. as an installed plugin). Deliberately not a cached "last-seen-version" marker
  file — this repo had a real prior incident (`df-stale-cache-silent-fallback`) from a similar
  cache-file pattern going silently stale.
- **`.githooks/pre-commit` is now quiet on success.** It used to dump the full
  `node --test` output (every test name, the engine banner, tens of thousands of characters)
  on every single commit, even when everything passed — noisy enough that a genuine
  tool-output-truncation warning was once misread as a real git failure with the actual
  issue buried in it. Now it captures output to a temp file, checks the real exit code, and
  prints a one-line `pre-commit: N/N passing` summary on success; the full output (and a
  non-zero exit) only surfaces when a test actually fails.
- **`verify-worktrees` now also flags a hierarchy-child worktree whose branch is already
  merged, not just ones whose epic status is `archived`.** Added a second, independent
  trigger — `git merge-base --is-ancestor <branch-tip> HEAD` — that fires regardless of the
  epic's status field. Fixes the real scenario hit this session: `git branch -d` failed with
  "used by worktree" after a merge because the worktree was never removed, and the epic's
  status hadn't been (or wasn't going to be) flipped to `archived` either. Each flagged
  worktree's `reasons` array now lists which trigger(s) fired (`epic-archived`,
  `branch-merged`, or both) — still a pure read/report function, it never deletes anything
  itself.

### Changed

- **`scripts/conductor.mjs` split into `scripts/lib/*.mjs` modules — no behavior change.**
  The engine (2,537 lines, 85 functions) is now a 121-line entry point (CLI dispatch table +
  imports) plus 20 focused `scripts/lib/*.mjs` modules, one per pre-existing section (the
  "helpers" grab-bag split further into 6 cohesive modules: state I/O, git plumbing, plugin
  metadata, epic progress/resolution, link validation, autonomy). Motivated by AI-agent
  token-efficiency — editing a monolith costs a full-file read/orient regardless of change
  size — not human-readability tech debt. Purely internal: the CLI's subcommands, flags, and
  output are unchanged, verified by all 250 pre-existing black-box tests passing unchanged
  throughout every step of the split.

## [0.22.0] — 2026-07-20

### Added

- **On-demand AI-agent doc reference: `llms.txt`/`llms-full.txt`.** Mintlify auto-publishes both
  at `pm-plugin.dev` — `llms.txt` is a lightweight (~7KB) index of every doc page, `llms-full.txt`
  is the entire site as one markdown document (~200KB, tens of thousands of tokens). Referenced
  from the one-time orientation points that already exist (`/pm:init`'s step 0, the `conductor`
  skill's new "Further reference" section) rather than the persistent CLAUDE.md rules block —
  same "deep orientation is on-demand, not recurring" design as pointing at README since 0.6.0.
  `llms-full.txt` carries an explicit size/token warning at every reference point so it's never
  reached for as a default. Also added a docs-site pointer to README.md's intro, which had no
  link to `pm-plugin.dev` at all until now.

## [0.21.1] — 2026-07-20

### Added

- **Security scanning via `.github/workflows/security.yml`.** Calls the two reusable
  `workflow_call` workflows published in `cfdude/.github` — Semgrep SAST
  (`p/javascript`/`p/typescript`/`p/secrets`/`p/security-audit`) and a Trivy filesystem scan
  (CRITICAL/HIGH) — on push/PR to `main` and a weekly schedule, publishing SARIF results to the
  repo's Security tab. Both are non-blocking (never fail CI) by design in the reusable
  workflows themselves. `security-events: write` is granted explicitly in the caller since the
  repo's default `GITHUB_TOKEN` permission is read-only.
- **`SECURITY.md`** — vulnerability reporting instructions and a short architecture note (the
  engine's zero-dependency, instruction-layer-only design narrows its own attack surface).

### Repo settings (live GitHub changes, not code)

- Attempted to enable `secret_scanning_validity_checks` and
  `secret_scanning_non_provider_patterns` via the repo API — both accepted the request (200 OK)
  but did not change state, most likely gated behind a GitHub Advanced Security /
  Enterprise-tier entitlement not available on this account even though the repo is public.
  Basic secret scanning and push protection were already enabled and are unaffected.
- Confirmed `main`'s branch protection already covers required-status-check, required
  signatures, admin enforcement, and no force-push/delete — no changes needed there.
- Confirmed `delete_branch_on_merge` stays **off** — `dev` is a persistent branch reused every
  release, not a throwaway feature branch; auto-delete would break the `pr-workflow` skill's
  sync step.
- Renovate (org config in `cfdude/.github`) considered and explicitly skipped for now — `pm` is
  zero-dependency, so it would only manage the two GitHub Actions version pins in `ci.yml`.

## [0.21.0] — 2026-07-20

### Added

- **CLAUDE.md rules block gains an unconditional "Feedback" section** encouraging the agent to
  proactively use `/pm:feedback [bug|feature] "<summary>"` (or ask the user "want me to file
  this as feedback?") whenever it hits a bug, a missing CLI verb, or repeated friction — instead
  of silently working around it. Motivated by a real gap: `/pm:feedback` shipped in 0.14.0 and
  was never used once, while the friction of hand-editing `.conductor/state.json` to flip a
  story's `done` flag (no CLI verb exists for it) recurred silently across several sessions
  before being reported. Registered `df-update-epic-no-story-toggle-verb` as the concrete
  backlog fix this section should have prompted sooner.

## [0.20.1] — 2026-07-20

### Added

- **`/pm:upgrade` now recommends adopting relevant new capabilities.** After printing the
  changelog delta, the command's instructions tell the agent to review each `Added` headline,
  judge whether it's an opt-in capability (a new flag/subcommand/behavior, not a bug fix or
  automatic change) relevant to the repo's current `.conductor/state.json`, and recommend it —
  one line, one reason, the command to run — without enabling anything itself. Instruction-only
  change (`commands/upgrade.md`, `README.md`); no engine code or schema touched.

## [0.20.0] — 2026-07-20

### Added

- **Completion-time tracker resync instruction.** When an inward-pull-capable tracker is
  configured (a `github-issues` primary, or any secondary tracker), the CLAUDE.md rules block
  now adds a "Sync after completing tracker-linked work" section: after closing/transitioning a
  tracker-linked issue as part of completing an epic, re-sync with your tracker(s) (`/pm:sync`)
  right away, since you're already doing tracker I/O for that epic. Phrased tracker-count-
  agnostic ("your tracker(s)") so it reads correctly whether a repo has one tracker or several
  (primary + secondary).
- **Session-start sync nudge.** The SessionStart brief now includes a one-line, non-blocking
  nudge — "N tracker(s) configured (...) — consider `/pm:sync` this session to pull in any new
  issues" — whenever any tracker (primary or secondary) is configured. This is a reminder only;
  the engine never calls a tracker itself, and the agent decides whether syncing is worth it.
  Deliberately does not track a last-synced-at timestamp — the nudge is enough without it.

## [0.19.0] — 2026-07-19

### Added

- **Support a primary tracker plus zero or more secondary trackers.** `state.tracker` is
  unchanged and is now, implicitly, the **primary** tracker — full existing bidirectional
  behavior (outward issue creation on new epics, `statusIntent`-driven status transitions),
  including the `github-issues`-as-primary inward-only special case, byte-for-byte unchanged.
  New optional `state.secondaryTrackers[]` lets a repo also watch additional trackers — e.g.
  Jira as the real dev tracker plus a GitHub repo for inbound issues from outside contributors or
  another internal repo publishing cross-project notifications — via `set-tracker --role
  secondary --system <sys> --repo <repo>` (or `--project <key>`), removable with `--remove`.
  Secondary trackers get inward pull (open issues become untriaged epics) plus a new capability
  that didn't exist even for the old inward-only `github-issues` case: **completion status
  writeback** — when an epic sourced from a secondary tracker reaches `archived`, the agent
  closes the linked issue there too. Secondary trackers never receive outward-created issues;
  that stays exclusive to the primary tracker. Dedup for both inward pull and writeback now
  matches on `externalUrl` (globally unique) rather than bare `externalId` (only unique within
  one tracker/repo) — fixing a latent cross-tracker collision risk (e.g. issue `#42` existing in
  two different secondary-tracker repos) surfaced during this change's own Gate 1 review, before
  any code shipped.

## [0.18.0] — 2026-07-17

### Added

- **Mechanical pre-commit hook: the full test suite must pass immediately before every
  commit, enforced, not just documented.** A genuinely failing test was committed once already
  (0.16.0) because a prose reminder alone wasn't enough — "run the tests one more time before
  committing" is exactly the kind of rule that gets skipped under momentum. `.githooks/pre-commit`
  runs `node --test scripts/conductor.test.mjs` and blocks the commit on any failure. One-time
  setup per clone: `git config core.hooksPath .githooks` (documented in `CONTRIBUTING.md`). Found
  and fixed a real bug on first live use: git sets `GIT_DIR`/`GIT_INDEX_FILE`/etc. for hook
  processes, which leaked into the test suite's own child `git` processes (tmp-repo fixtures),
  causing them to operate against the outer repo's locked index instead of their own tmp dirs —
  the hook now unsets those variables before running tests.

## [0.17.0] — 2026-07-17

### Added

- **Added a mechanical test that catches README.md "Commands" drift from the real dispatch
  table**, mirroring the existing SKILL.md drift test. Running it against the current docs
  caught 8 real gaps (`commit-nudge`, `log-detour`, `honcho-memory`, `set-review-mode`,
  `verify-state`, `write-rules`, `snapshot`, `changesets`) — several of them genuinely
  undocumented user-facing subcommands (`honcho-memory`, `verify-state`, `changesets`), fixed
  in the same pass. `agents/hierarchy-child-executor.md`'s standing instructions and the
  conductor skill's epic-hierarchy preflight section now explicitly require a README.md update
  (not just SKILL.md) whenever a child epic adds/changes a user-facing command, flag, or
  behavior — the same class of gap that let `record-gate-review` ship in 0.16.0 with zero
  README mention.

## [0.16.0] — 2026-07-16

### Added

- **OpenSpec's two mandatory gates are now mechanically enforced at archive time, not just
  narrated.** Nothing previously checked that an `openspec`-lane epic actually passed Gate 1
  (spec review, before code) and Gate 2 (implementation review, before docs) before it was
  archived — an epic could go straight from `apply` to `archive` on narration alone. A new
  `record-gate-review <epicId> --gate 1|2 --verdict pass|fail [--reviewer "<note>"]` subcommand
  writes a fresh-context reviewer's verdict durably onto the epic (`gateReview.gate1`/`gate2`,
  mirroring `record-reconcile`'s shape), and `update-epic --status archived` now REJECTS the
  transition for any `openspec`-lane epic that doesn't already have a recorded
  `gateReview.gate2.verdict === "pass"`. Scoped strictly to the `openspec` lane —
  `superpowers`/`claude-code`/`decision`/`external` epics are completely unaffected, since they
  have no two-gate process.
- **Added a mechanical test that catches SKILL.md "Commands" drift from the real dispatch
  table.** `conductor.test.mjs` now extracts every subcommand key from `conductor.mjs`'s
  dispatch table and asserts each one is mentioned somewhere in `skills/conductor/SKILL.md`,
  failing CI the next time a new subcommand ships without a doc mention (the same bug class
  fixed once by hand in 0.12.0, now enforced instead of relying on someone remembering). Running
  it against the current docs caught two real gaps — `snapshot` (the PreCompact-hook-only
  re-render) and `write-rules` (the `/pm:init`/`/pm:upgrade`-only CLAUDE.md rules-block
  refresher) were both real, invoked subcommands with no mention anywhere in SKILL.md — fixed by
  adding a line for each to the Commands section.

### Changed

- **The `github-issues` tracker no longer tells the agent to auto-create a GitHub issue for
  every unmirrored local epic.** `rulesBlock()` now suppresses the outward "External tracker
  sync" section entirely when `tracker.system === "github-issues"`, leaving only the existing
  inward "GitHub issue sync" section (open issues → untriaged epics) in effect. Filing a public
  GitHub issue for any local claude-code epic just because a `github-issues` tracker is
  configured is a materially bigger, more consequential default than mirroring toward an
  internal Jira/Linear instance, so `github-issues` is now documented and implemented as
  INWARD-ONLY by design. Jira, Linear, and any other tracker `--system` keep the full
  bidirectional outward-mirror behavior unchanged.

### Fixed

- **`commit-nudge`'s auto-detour heuristic no longer false-positives on routine conductor
  bookkeeping.** A commit touching only pm's own state-output files (`.conductor/state.json`,
  `PROJECT.md`, `.conductor/render-stamp.json`) is never auto-logged as a stray minimal detour,
  even if it matches the `fix:`/`chore:` + `<=3 files` shape — this fired 3 separate times in
  one session (registering epics, archiving epics, granting autonomy), always on commits that
  were routine administration, never a real detour. `CLAUDE.md` is deliberately excluded from
  this allowlist: it's user-authored content, not purely engine-generated output, so a commit
  touching it could still be a genuine detour.
- **`render-stamp.json` no longer produces a spurious diff on every `render()` call when
  nothing meaningful changed.** Root cause: `writeRenderStamp()` unconditionally rewrote
  `.conductor/render-stamp.json` on every `render()` invocation, bumping its `renderedAt`
  timestamp even when `state.json` (and therefore the rendered `PROJECT.md` content) hadn't
  changed at all — producing a byte-only diff that had to be manually discarded roughly a
  dozen times across a single dogfooding session. `verify-state` (the mechanism this stamp
  exists for) only ever compares the recorded `stateMtimeMs` against `state.json`'s current
  mtime; it never reads `renderedAt` back for correctness. `writeRenderStamp()` now skips the
  rewrite entirely when the existing stamp's `stateMtimeMs` already matches `state.json`'s
  current mtime, so the sidecar file is only ever touched when something that actually matters
  changed. `.conductor/brief.txt` was confirmed already gitignored in this repo (a prior fix);
  no further action was needed there.

## [0.15.0] — 2026-07-15

### Added

- **Changesets-style fragment files replace direct `CHANGELOG.md` edits for hierarchy children.**
  Every parallel hierarchy-child batch was hitting a 100% collision rate on `CHANGELOG.md`'s
  shared `## [Unreleased]` header — every dispatched child edited the same section, guaranteeing
  a merge conflict on every multi-child batch. Children now write their changelog entry to
  `.changesets/<epic-id>.md` instead (same bullet format `CHANGELOG.md` already uses: a bold
  one-line summary, then wrapped prose). The orchestrator remains the sole writer of
  `CHANGELOG.md` — consistent with it already being the sole writer of `.conductor/state.json` —
  and consolidates all pending fragments into the real `[Unreleased]`/new-version section once,
  at release time, then deletes the consumed fragment files. A new zero-dependency `changesets`
  engine subcommand (`node conductor.mjs changesets`) lists `.changesets/*.md` fragments as
  `{ changesets: [{ id, path, body }] }`, sorted by epic id, to make that consolidation step
  mechanical rather than a manual `cat` + guesswork. (First real-world test, this very release:
  zero CHANGELOG.md conflicts across 3 parallel children, versus a 100% collision rate before.)
- **Mandatory post-resolution verification for the epic-hierarchy merge-conflict ladder.**
  After ANY conflict resolution (self-resolved by the orchestrator, via
  `agents/merge-conflict-resolver`, or via an escalated model/`advisor()` opinion), before the
  merge is committed: grep every touched file for leftover `<<<<<<<`/`=======`/`>>>>>>>` markers,
  and run `node -c` on every touched `.mjs`/`.js` file. Either failure means the file is still
  unresolved. Closes a gap found during this repo's own 0.14.0 dogfood run, where a resolution
  removed only the closing conflict markers and left the opening `<<<<<<< HEAD` marker in place
  — caught only by a manual re-grep, not by any required step.
- **Session-continuity check for live external-infra epics.** The `hierarchy-child-executor`
  agent now has a required checklist item: before finalizing its report, if the epic's work made
  a live change to external infrastructure the orchestrator itself depends on for the rest of the
  session (branch protection rules, credential/token rotation, webhook/API changes, etc.), it
  must explicitly answer "does this change affect how the orchestrator itself needs to operate
  for the rest of this session?" in CONCERNS — even an explicit "no" is required output, not
  silence. Fixes a real incident: `branch-protection-and-pr-workflow` applied live branch-
  protection settings to `main`, and the orchestrator's very next `git push origin main` was
  rejected — discovered only empirically, not flagged by that epic's own report.
- **README.md fully revamped.** Replaces the agent-facing, all-over-the-place structure with a
  Comet-inspired layout: a real banner image, honest badges (CI/version/license only — no
  DeepWiki/CodeCov/trending until the tooling behind them actually exists), a "Why Use PM?"
  section built from real, verifiable repo history (not a fabricated benchmark), a genuine
  "From Industry-Frontier Practice" write-up of the design patterns PM's architecture actually
  mirrors, a Supported Platforms table with an honest Status column (Claude Code: Supported;
  Codex/Gemini CLI/Grok Build/`AGENTS.md` format: Planned, tracked under
  `multi-platform-agent-support`), collapsible `<details>` command reference instead of one
  long flat table, and a Star History chart. Resolves `df-readme-stale-since-gate-guard`
  (README hadn't been touched since `f77d774`, missing everything shipped since).
- **Branch protection + PR workflow on `cfdude/pm`.** `main` now requires pull requests (no
  direct pushes), the `test` job from `.github/workflows/ci.yml` as a required status check,
  0 required approving reviews (solo maintainer), and squash-merge-only at the repo level.
  Day-to-day work moves to a new `dev` branch (created from `main`'s tip); PRs merge
  `dev` → `main`. See `CONTRIBUTING.md` for the full workflow. This is a live GitHub repo
  settings change, not a code change — no `state.json` schema impact.

---

## [0.14.0] — 2026-07-15

### Added

- **`github-issues` tracker: inward pull (open issues → new untriaged epics).** `set-tracker
  --system github-issues --repo <owner/name>` records a repo alongside the tracker's `system`.
  The rules block now gains a "GitHub issue sync" section (in addition to the existing outward
  "External tracker sync" mirror) telling the interactive agent — as part of `/pm:sync` — to
  `gh issue list --repo <repo> --state open`, skip issues already mapped to an epic via
  `externalId`, and register the rest with `add-epic --status untriaged --external-id <n>
  --external-url <url> --lane claude-code --priority P2` (a `P0`/`P1`/`P2`/`P3` label on the
  issue overrides the P2 default). The engine itself never calls `gh` — same instruction-layer
  law as every other tracker. `add-epic` now also rejects a duplicate `--external-id` outright
  (exits non-zero, writes nothing), so re-running sync can never create a duplicate epic for the
  same issue even off a stale local view. See `commands/tracker.md`, `commands/sync.md`, and the
  conductor skill's "Hierarchy & external trackers" section.
- **`.github/workflows/ci.yml`.** A GitHub Actions CI workflow on push to `main` and on every
  pull request targeting `main`, running Node 18.x: a `node -c` syntax check on
  `scripts/conductor.mjs` and `scripts/conductor.test.mjs`, then the full test suite via
  `node --test scripts/conductor.test.mjs`. This repo is zero-dependency, so "lint" here means
  the syntax check rather than a third-party linter. The job is named `test` (`jobs.test`) —
  a follow-up epic wires this job into required branch-protection status checks.
- **`/pm:feedback [bug|feature] "<summary>"`.** File a bug report or feature request against
  `pm` itself directly as a GitHub issue on `cfdude/pm`, from any session using the plugin —
  replacing the previous workflow of manually copy-pasting details between sessions. Pure
  command-doc addition: the interactive agent gathers the report, searches open issues on
  `cfdude/pm` for a near-duplicate title (commenting on a match instead of filing a new issue),
  and otherwise runs `gh issue create --repo cfdude/pm` with a `bug`/`enhancement` label,
  reporting back the issue URL. No engine code involved — `scripts/conductor.mjs` never calls
  GitHub itself; all `gh` calls are agent-invoked Bash, per the instruction-layer law. See
  `commands/feedback.md`.

## [0.13.0] — 2026-07-15

### Added

- **`record-reconcile <epicId> --detour <detourId> --verdict valid|invalidated
  [--amendments "<a>;<b>"]`.** The reconciler agent's verdict at the POP-protocol reconcile
  gate previously only ever lived in the conversation transcript. This subcommand writes a
  structured `{verdict, amendments, reconciledAt}` object onto the paused epic's link to the
  detour that triggered reconciliation (creating a `may-invalidate` link if none exists yet),
  and clears `reconcileNeeded` — so the judgment is durable in `.conductor/state.json` and
  visible in `PROJECT.md`, not just something Claude said once. `agents/reconciler.md`'s
  report format, `commands/resume.md`, and the conductor skill's POP protocol / rules block
  now describe this writeback step.
- **Per-repo lane-routing overrides.** New optional `laneRouting.overrides` config block in
  `.conductor/state.json` — keyword/glob rules (`{match, lane}`) checked BEFORE the generic
  lane heuristic when an agent decides which lane should build an epic. Set via the new
  `set-lane-routing --add "<match>:<lane>" [--add ...] | --remove "<match>" | --clear`
  subcommand; looked up via the new `suggest-lane "<free text>"` subcommand, which prints
  `{lane, matched}` JSON (`lane: null` means no override matched — fall back to the generic
  heuristic). Replaces the need for a CLAUDE.md prose carve-out when the generic heuristic is
  wrong for a repo (e.g. "anything touching billing always goes through openspec"). See
  `commands/lane-routing.md` and the `conductor` skill's "Lane routing overrides" section.
  Pure local state write — the engine still never assigns a lane itself; `add-epic` always
  takes an explicit `--lane`.
- **Per-epic review-mode override (escalation-only).** `update-epic <id> --review-mode
  off|standard|thorough` sets an epic-level override that can only ESCALATE above the
  repo-global `set-review-mode` dial — never de-escalate below it (an attempt to set a lower
  mode than the current global dial is rejected outright, state unchanged). `currentReviewMode`
  now accepts an optional `epicId` and returns the effective mode for that epic: the
  higher-ranked of the global dial and the epic's override. `rules --epic <id>` surfaces the
  effective per-epic mode in the emitted "Current mode" line. Lets one security-sensitive epic
  force `thorough` review without flipping an otherwise-`standard` repo's global dial.
- **Auto-detected minimal detours from commit diff shape.** `commit-nudge` (the
  `PostToolUse(Bash)` hook that already fires after every `git commit`) now recognizes an
  UNLOGGED minimal detour by its shape — a small commit (<=3 files changed) with a
  `fix:`/`chore:` conventional-commit subject, made while no detour is active, and not
  scoped to the currently active epic (a `fix(<active-epic-id>): ...` subject is read as
  that epic's own work, not a stray detour) — and appends an `AUTO-DETOUR` entry to
  `.conductor/detours.log` automatically, without waiting for `/pm:detour --minimal` to be
  run by hand. Three separate dogfooding sessions converged on "the agent forgets to log
  the minimal detour" as the #1 pain point; this closes that gap at the mechanism level
  (hook-driven, not agent-remembered) rather than relying on the agent to recall the rule.
  See `looksLikeUnloggedMinimalDetour()` / `headChangedFileCount()` in `conductor.mjs`.
- **`honcho-memory <push|pop> <epicId> "<reason>"` subcommand.** Formats the exact
  ready-to-copy one-line Honcho memory string for a detour-stack PUSH/POP (per CLAUDE.md rule
  4), prints it to stdout, and appends a timestamped copy to the new
  `.conductor/honcho-memories.log`. Previously the interactive agent had to compose that
  string itself from context on every PUSH/POP, with no engine support and no durable record
  of what was actually sent — easy to forget or word inconsistently. The engine still never
  calls Honcho itself (pure string formatting + local logging, staying inside the
  instruction-layer law); `commands/detour.md`, `commands/resume.md`, and the `conductor`
  skill's PUSH/POP protocols now call it and paste its output into the actual Honcho MCP call.
- **Dependency-aware ordering for the top-level queue, not just hierarchy siblings.** The
  brief's NEXT UP list (and thus `/pm:next`'s recommendation) now applies the same
  `depends-on` topological ordering `plan-hierarchy` already used for one parent's children to
  ALL top-level queued/untriaged epics: a higher-priority epic with an unresolved `depends-on`
  link to another still-queued epic is no longer listed (or picked) ahead of the dependency
  it's waiting on, even across otherwise-unrelated epics with no shared parent. When ordering
  overrides plain priority this way, the brief prints a one-line note naming the blocker, e.g.
  `⚠ epic \`high-blocked\` ready but waiting on \`low-dep\``. Unlike `plan-hierarchy`, a
  dependency cycle among queued epics does not error here — it's a display/selection helper,
  not an execution plan, so it falls back to the original priority order for the stuck
  remainder.
- **SessionStart upgrade nudge now inlines top Added-bullet headlines.** The
  `pm X.Y.Z → A.B.C available` nudge previously named only the old/new versions, forcing a
  separate `/pm:changelog` round trip to judge whether upgrading was worth mid-epic churn. It
  now inlines up to 3 "Added" bullet headlines (first line only, not the full multi-line body)
  drawn from every CHANGELOG.md section strictly between the stamped and newest version, so a
  session can judge upgrade value inline.
- **Category-based `--preauthorize` shorthand for epic-level autonomy.** `set-autonomy <id>
  --preauthorize "category:<filesystem|network|schema|external-api>:<reason>"` grants routine
  actions by category instead of requiring every one enumerated individually. Stored as a
  distinct `{ category, reason?, grantedAt }` grant shape alongside existing exact-action
  `{ action, reason?, grantedAt }` grants in the same `preAuthorized[]` array — exact-action
  matching is unchanged. Unknown categories are rejected with a non-zero exit and no state
  write. The matching heuristic each category expands to at decision-rule time (approximate
  by design) is documented in the `conductor` skill's "Epic-level autonomy — the preflight
  scan" section.

### Changed

- **Epic-level-autonomy decision rule now says "`--notify` incrementally as it happens," not
  "record for the end-of-epic report."** The `--notify` mechanism already writes durably to
  `state.json`'s `notifications[]` array; the prior wording implied WARN-class (c) and
  consequential (e) decisions were only gathered in-memory for a report assembled at the end
  of the epic, which loses them if the session is compacted or interrupted mid-epic. Fixed in
  both `CLAUDE.md`'s rules block and the identical generated block in
  `scripts/conductor.mjs`'s `renderRulesBlock`-equivalent. The end-of-epic report step now
  reads back `notifications[]` rather than being the primary record. No code change —
  `--notify`/`notifications[]` already worked this way; this is a wording fix so the documented
  process matches the existing mechanism.
- **Gate guard is now on by default whenever an epic owes a reconcile.** `gateGuardCheck()`
  now blocks `Edit`/`Write`/`NotebookEdit` unconditionally when the active epic's
  `reconcileNeeded` is `true`, regardless of the repo's `gateGuard` setting in
  `state.json` — `set-gate-guard off` no longer bypasses this specific case. Applies
  retroactively to any epic that already has `reconcileNeeded: true`, not just future detour
  POPs. Reverses the original opt-in design after real-usage feedback
  (`docs/feedback/2026-07-14-pm-plugin-improvement-feedback.md`) showed the guard had never
  actually been turned on across several sessions where it would have caught a real skip. The
  repo-level `gateGuard` flag and `set-gate-guard on|off` command still exist, reserved for any
  future generalization of the hook to other checks. See `commands/gate-guard.md` and the
  `conductor` skill's POP protocol.

### Fixed

- **`missing()` now excludes `status === "archived"` epics.** An already-archived openspec
  epic (proposed, built, and archived — its `openspec/changes/<id>` directory legitimately
  moved to `openspec/specs/` by the archive process) could still render the unresolvable
  "⚠ no change on disk" warning forever if its on-disk archive-dir name didn't match
  `isArchived()`'s dated-prefix convention. Same class of bug already fixed for
  `planHierarchy()` (`df-plan-hierarchy-includes-archived-children`, 0.12.1), applied here to
  the missing-change-warning code path.

## [0.12.2] — 2026-07-15

### Added

- **`startedAt`/`completedAt` timestamps on epics, and a staleness indicator.**
  `set-active` now stamps `startedAt` (ISO string) the first time an epic goes active
  (re-activation after a demotion does not reset it); `update-epic --status archived` stamps
  `completedAt`. Both fields are purely additive — existing epics simply lack them until
  touched, so no migration is needed. `PROJECT.md`'s epic table, its "Now" section, and the
  brief's `NOW`/`NEXT UP` lines all surface `⚠ stale, Nd active` for any epic with `startedAt`
  set, no `completedAt`, and more than 14 days elapsed — supporting velocity tracking and the
  weekly Ship-Real-Software check.
- **`verify-state` subcommand.** `render()` now writes `.conductor/render-stamp.json`
  (`renderedAt` + the state.json mtime it rendered from) every time it runs. `verify-state`
  compares state.json's current filesystem mtime against that stamp and fails loudly
  (non-zero exit, clear stderr) if state.json was modified after the last recorded render —
  mechanical evidence of an undetected hand-edit, which CLAUDE.md explicitly forbids
  (state.json/PROJECT.md must only change through the engine's subcommands). Also fails
  loudly if no stamp exists yet (state.json has never been rendered).
- **Engine version+source banner on every invocation.** `conductor.mjs` now prints
  `conductor: engine <version> @ <path>` to stderr on every run (silenceable via
  `PM_QUIET_ENGINE_BANNER=1`). Discovered live while dogfooding: `$ENGINE` resolution had
  silently picked up the installed plugin cache's `0.12.0` copy while this repo — the plugin's
  own source — was already at `0.12.1`, with no signal anything was stale.

### Fixed

- **ENGINE-resolution snippets (skill doc + every command doc) now prefer a repo-local
  `$CLAUDE_PROJECT_DIR/scripts/conductor.mjs` before `$CLAUDE_PLUGIN_ROOT` and the installed-cache
  fallback.** When the repo being worked on IS the pm plugin source (self-hosting), that copy is
  always the one under active development and should win over a stale cached install.

## [0.12.1] — 2026-07-15

### Fixed

- **`plan-hierarchy` no longer includes already-archived children in a hierarchy plan.**
  Children were filtered by `parent` only, with no status check — a done child (e.g. one
  already merged and archived from a prior dispatch batch) still showed up in the plan,
  indistinguishable from real pending work. Discovered via the first live dogfood resumption
  against `pm-plugin-improvements-2026-07-14`. Excluding `status === "archived"` from the
  children filter also correctly makes a `depends-on` reference to an archived sibling fall
  outside the hierarchy's dependency graph — the same existing behavior as a link to any epic
  outside the hierarchy, since a done dependency imposes no wait.

## [0.12.0] — 2026-07-15

### Added

- **`verify-worktrees` — orphaned hierarchy-dispatch worktree detection.** Cross-references
  `git worktree list` against epic status: any worktree on a `hierarchy-child/<epic-id>` branch
  whose epic is already archived (successfully merged and closed out) is flagged. Bakes worktree
  hygiene into the plugin itself — checkable on any fresh install — rather than depending on a
  user's personal CLAUDE.md discipline. Pure read, flags without deleting.
- **Worktree-isolated epic-hierarchy dispatch, replacing the original "just dispatch in
  parallel" instructions.** Discovered via the first live dogfood attempt against a real
  hierarchy (every child touched `scripts/conductor.mjs`): concurrent children mutating shared
  files was a real, unaddressed race. Each child now works in its own git worktree; children
  never write `.conductor/state.json` themselves (the orchestrator is the sole writer, applied
  once per batch); worktree branches merge back sequentially. An ordinary merge conflict is
  never a hard stop — it's resolved via a tiered ladder (normal merge → dispatch the new
  `agents/merge-conflict-resolver` → escalate to a stronger model/`advisor()` → commit
  best-effort + log a follow-up epic under the same parent) — a direct, consistent application
  of epic-level autonomy's existing decision rule, since a git-tracked conflict is always
  recoverable via history (criterion (c), never the unconditional-stop criterion (b)).
- **`agents/merge-conflict-resolver.md`** — a new packaged agent (mirrors `reconciler.md`'s
  shape) dispatched to resolve a worktree-merge conflict, reporting `resolved`/`uncertain`/
  `failed` so the orchestrator knows whether to escalate further.

### Fixed

- Doc drift in the conductor skill's Commands line: `remove-epic`, `plan-hierarchy`, and
  `verify-worktrees` were all missing despite `remove-epic`/`plan-hierarchy` already having
  shipped in prior releases.

---

## [0.11.0] — 2026-07-15

### Added

- **`remove-epic <id> [--cascade]` — hard-delete an epic**, replacing the raw `git checkout`
  workaround that was the only prior recovery from a mis-registered epic. Blocked by default if
  the epic has children: prints a concise `(id, title, lane/priority/status)` table of the parent
  plus every child and exits non-zero, so removing a parent with descendants is always a
  deliberate, informed choice; `--cascade` removes the epic and all descendants together in one
  atomic write. Any other epic's `links[]` entries referencing a removed id are stripped
  automatically, with a warning naming the affected epics. Recoverable only via git history —
  deliberately no in-app undo, since this verb exists specifically to replace that workaround, not
  add a softer one next to it.

---

## [0.10.0] — 2026-07-14

### Added

- **`plan-hierarchy --parent <id>` — batched execution plan for a parent epic's children.**
  Computes batches from data pm already tracks (no new persistent state): `priority` and
  `depends-on` links between siblings drive a topological sort — children with no dependency on
  each other land in the same batch (dispatchable in parallel), children in a dependency chain
  land in separate, ordered batches. Each child is annotated with whether it already has
  `autonomy.level: "autonomous"` (from epic-level autonomy), so a hierarchy dispatch never fires
  a child that hasn't been preflighted. Each child also carries `dependsOn`, its sibling
  dependency ids within the hierarchy, so a blocked-child handler can check whether a later
  batch depends on it (directly or transitively) rather than guessing from batch order alone.
  A dependency cycle among children is rejected outright, naming the cycle path, rather than
  producing a bogus order.
- **`agents/hierarchy-child-executor.md` — a packaged subagent** dispatched once per child epic
  in a batch: front-loaded with the epic's full context and its autonomy grant, works the epic
  to completion using its lane's normal workflow, follows epic-level autonomy's decision rule
  for genuine stops, and returns a fixed report (`STATUS`/`DONE`/`DECISIONS`/`CONCERNS`).
- The `conductor` skill documents the full end-to-end process: preflight every child up front
  (reusing epic-level autonomy's scan, consolidated into one batch of questions) → `plan-hierarchy`
  → dispatch batch by batch (parallel within a batch, sequential across batches) → one
  consolidated end-of-hierarchy report flagging anything controversial.
- Deferred to a later release: the fuller execution-strategy-selection framework (plain
  subagents vs. the Workflow tool vs. other execution modes) — this release covers only
  subagent-per-child dispatch.

---

## [0.9.3] — 2026-07-14

### Fixed

- **`add-epic --link` accepted a malformed value silently instead of erroring.** It split the
  string on `:` and stored whatever came out with no validation — a typo like
  `type:related:epic:...` parsed successfully as `{type:"type", epic:"related"}` since nothing
  checked that `"related"` was a real epic id. `parseLinkFlags()` now requires at least two
  segments and that `<epic>` references a known, existing epic id, rejecting otherwise with a
  clear error (shared by `add-epic` and `update-epic`).
- **`update-epic` had no `--link` flag**, so a malformed link (from before this validation
  existed, or from a hand-edit) had no CLI path to fix — forcing a direct `state.json` edit,
  which is what caused a reported em-dash JSON-escaping corruption across unrelated epics.
  `update-epic <id> --link "<type>:<epic>[:<reason>]"` now REPLACES the epic's links wholesale
  (unlike the other flags, which patch a single field) — the intended fix path.

---

## [0.9.2] — 2026-07-14

### Added

- **`set-gate-guard <on|off>` — optional, opt-in `PreToolUse` guard hook.** Blocks
  `Edit`/`Write`/`NotebookEdit` while the active epic still owes a reconcile after a detour
  POP (`reconcileNeeded`). Off by default and dormant until `/pm:init`. This is the one place
  pm's law tolerates mechanical blocking over pure instruction — it protects the single
  highest-stakes skip (writing source before the reconcile gate runs) as a deliberate,
  reversible opt-in, never a silent default.

### Fixed

- **POP protocol never actually told you to SET `reconcileNeeded`.** The conductor skill
  documented clearing it after reconciliation, but never setting it true on the paused epic
  before its detour-stack frame is popped — without that, the flag (and the new gate guard)
  would never actually trigger. Documented as a hand-edited step, mirroring how the frame
  itself is already hand-edited.
- **Doc drift in the conductor skill:** the Commands line and `state.json` reference were
  missing `set-autonomy`, `set-review-mode`, `autonomy`, `reviewMode`, and `gateGuard` — none
  had been added when those features shipped in 0.8.0/0.9.0.

---

## [0.9.1] — 2026-07-14

### Fixed

- **Regression from 0.8.4: `reconcileNeeded` was cleared on an active epic with no live
  detour frame, defeating the post-pop reconcile gate.** POP protocol removes the detour-
  stack frame BEFORE reconciliation runs, so deriving the flag purely from live-frame
  presence wiped it out at exactly the moment it needed to stay true (just-resumed,
  reconcile not yet done). `reconcileArchived()` now only recomputes what's safely
  derivable from current state: an archived epic always clears it (reconcile is moot); a
  still-paused epic with a live `reconcileOnResume` frame gets it forced true; anything
  else stale heals to false only if it's NOT the current active epic, since that's exactly
  the legitimate post-pop-pre-reconcile window.

---

## [0.9.0] — 2026-07-14

### Added

- **`set-review-mode <off|standard|thorough>` — a bounded, repo-level review-count dial.**
  Incorporates Comet's `review_mode` concept: a single setting (not per-epic) replacing an
  ad-hoc "how many reviews, when" judgment call with an explicit, dedup'd table. `off` = self-
  review only; `standard` (default when unset) = one fresh-context reviewer per gate; `thorough`
  = two independent reviewers per gate with disagreement adjudicated by you. Writes
  `state.reviewMode` and refreshes the CLAUDE.md rules block's new unconditional "## Review
  mode" section, which always shows the currently active mode. Pure instruction-layer — no
  external calls.

---

## [0.8.4] — 2026-07-14

### Fixed

- **Recompute-don't-remember: `.active` validity and `reconcileNeeded` are re-derived from
  disk, not trusted as stored flags.** `reconcileArchived()` previously only cleared `.active`
  when it pointed at an *archived* epic — a pointer referencing an epic id missing entirely
  from `state.epics` was never healed. `reconcileNeeded` was pure remembered state (set/cleared
  only by hand-editing per the PUSH/POP protocol), with no recovery if a session lost context
  mid-detour. Both are now recomputed from ground truth (the epics array, the detour stack's
  `reconcileOnResume` frames) every time `render()` runs — including at the end of `/pm:resume`
  — healing stale flags in either direction. `brief()` stays deliberately read-only, displaying
  the same recomputed truth in-memory without persisting.

---

## [0.8.3] — 2026-07-14

### Fixed

- **`state.json` writes are now atomic (tmp+rename).** `saveState()` previously wrote directly
  via `writeFileSync`; a crash or kill mid-write could leave a truncated, unparseable
  `state.json` with no recovery path. Now writes to a `.tmp-<pid>-<ts>` file in the same
  directory and `rename(2)`s over the real path — atomic on the same filesystem, so a crash
  leaves a truncated tmp file instead of corrupting the system of record.

---

## [0.8.2] — 2026-07-14

### Fixed

- **`KNOWN_STATUSES` omitted `later`/`blocked` despite both being documented** in the README's
  Epic statuses table and `commands/init.md` — `add-epic`/`update-epic --status later` (or
  `blocked`) was rejected outright. Both statuses now validate and persist correctly; NEXT UP
  already excluded them (only `queued`/`untriaged` are included) with no other code change
  needed, and they correctly still count in the lanes rollup (only `planned` is excluded from
  both NEXT UP and the rollup, per the documented distinction).

---

## [0.8.1] — 2026-07-14

### Fixed

- **`update-epic` silently no-op'd on an unrecognized flag.** A typo'd or unwired flag would
  parse, run `saveState`/`render`, and print `conductor: updated '<id>'` even though nothing
  changed — the only way to catch it was cross-checking `git diff`. `update-epic` now validates
  its flags against a known set and exits non-zero with an "unknown flag" error instead of a
  false success.
- **`update-epic` had no `--title` flag.** `add-epic` supports `--title` at creation, but
  correcting a title after an investigation changes what an epic is actually about (a common,
  legitimate mid-epic event) had no CLI path and required hand-editing `state.json`, which the
  tool explicitly discourages. `update-epic <id> --title "..."` now works.

---

## [0.8.0] — 2026-07-13

### Added

- **`set-autonomy <id>` — per-epic autonomy contract.** An epic can be granted broad execution
  trust (`autonomy.level: "autonomous"`, default `"off"` — unchanged behavior) so it runs through
  phase transitions without stopping for permission each time. Autonomy is granted only after a
  preflight risk-scan (documented in the `conductor` skill) records the user's pre-authorized
  actions and supplied context via `--preauthorize`/`--context` (repeatable, additive). A
  five-criteria execution-time decision rule (injected into the CLAUDE.md rules block) still
  hard-stops for anything with no backup/restore path or no context to act on — autonomy never
  overrides a genuine safety gate, only removes false ones. `PROJECT.md` and the session brief
  mark an autonomous epic with 🤖. Tracker-linked epics (Jira etc.) get an addendum covering
  lane-aware source reading, non-authoritative comment-mirroring of approvals, and mid-run drift
  as its own stop condition.
- Development-time scope only — this does not cover actions with irreversible EXTERNAL side
  effects (sending email/Slack, deploying to production, third-party API calls, pushing to a
  shared branch); those remain out of scope regardless of autonomy level.

---

## [0.7.0] — 2026-07-08

### Added

- **`set-active <id>` / `clear-active` — a CLI verb for the top-level active epic** (closes
  [#1](https://github.com/cfdude/cfdude-plugins/issues/1)). Previously `.active` — the pointer the
  briefing's "NOW" line reads — had *no* CLI setter, so `/pm:next`'s "make it active" forced
  hand-editing `state.json`, against the "CLI is the safe interface" model. `set-active <id>`
  (positional id) sets the pointer; `clear-active` drops it.

### Fixed

- **`.active` and `status: "active"` can no longer silently disagree.** They were independent
  fields — `update-epic --status active` flipped the status but left `.active` null, so the brief
  reported "no active epic" despite an active epic. Now a single-active invariant is enforced
  through every CLI path: `set-active`, `update-epic --status active`, and `add-epic --status
  active` all set `.active` **and** the epic's status together and demote any previously-active
  epic to `queued`; moving the active epic off `active` (or `clear-active`) clears the pointer.
  `set-active` rejects an unknown or archived id.

### Changed

- **Skills/commands resolve the engine version-independently.** The `conductor` skill and `/pm:next`
  now prefer `$CLAUDE_PLUGIN_ROOT` and fall back to the newest installed `conductor.mjs`
  (`ls -t …/pm/*/… | head -1`) instead of embedding a versioned cache path like `…/pm/0.6.1/…`,
  which broke on upgrade. `set-active`/`clear-active` are documented in `/pm:next`, `/pm:epic`, the
  skill, and the README.

### Upgrade

Minor release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`.

---

## [0.6.1] — 2026-06-26

### Fixed

- **Archived OpenSpec epics stayed stuck as the active epic.** `isArchived()` only matched an
  archive dir named exactly `<id>`, but OpenSpec archives a change as
  `openspec/changes/archive/<YYYY-MM-DD>-<id>`. So the engine never detected the archive: the epic
  kept its `active` status, `state.active` kept pointing at it, `/pm:status` showed a finished epic
  as **NOW**, `/pm:next` wouldn't advance, and the epic could even be mis-flagged "⚠ no change on
  disk." Fixed three ways:
  - `isArchived()` now matches both the exact id and OpenSpec's date-prefixed dir.
  - **Display honesty:** `render`/`brief` no longer present an archived epic as the active one —
    they show "(no active epic — `X` was archived)", so `/pm:status` and `/pm:next` are correct
    immediately, with no state mutation.
  - **Self-heal:** a new `reconcileArchived()` clears an `active` pointer aimed at an archived epic
    and stamps `status: archived`. It runs in `sync`, `commit-nudge` (so the state heals on the
    same commit that archives the change), `init`, and `upgrade` — no more hand-editing
    `state.json` after an archive.

### Upgrade

Patch release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`.

---

## [0.6.0] — 2026-06-25

### Added

- **Knowledge surfacing — the plugin now teaches the agent at the two moments that matter.**
  Previously an upgrade exposed new commands but never explained *what* it brought, and a
  first-time install gave the agent no orientation beyond command descriptions. Closed both:
  - **`/pm:upgrade` prints a changelog delta.** After applying migrations, the engine reads its
    own `CHANGELOG.md` and prints every entry in `(stamped, running]` — so the agent and user see
    exactly what the version added, not just that it happened.
  - **New `changelog` subcommand + `/pm:changelog [--since <x.y.z>]`.** On-demand changelog delta;
    defaults its floor to the version stamped in this repo's `state.json`. Zero-dependency
    markdown parsing (sections split on `## [x.y.z]` headers); graceful when no CHANGELOG ships.
  - **`/pm:init` orients the agent first.** Init now instructs the agent to load the `conductor`
    skill (the agent-facing how-to) — and points at the shipped `README.md` for deeper reference —
    so even a cold install of a much-later version knows how to drive the plugin. Deep orientation
    stays a one-time/on-demand load; the persistent CLAUDE.md rules block remains the recurring
    anchor (no full-orientation injection every session).

### Upgrade

Minor release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`; the upgrade will now print what this version (and any you skipped) brought.

---

## [0.5.1] — 2026-06-25

### Fixed

- **Multi-version upgrade ordering (hardening).** `upgrade()` already replayed every migration
  newer than the stamped version, so a repo several versions behind (e.g. `0.2.0 → 0.5.x`) was
  upgraded correctly. This release makes that guarantee robust: migrations are now applied **sorted
  by release** (independent of array authoring order), the `MIGRATIONS` array is documented as
  **append-only / never-reorder**, and a regression test asserts a two-versions-behind repo replays
  *both* the 0.3.0 (lane) and 0.5.0 (link-normalize) migrations in order.

- **Tracker detection no longer over-triggers on Git hosting.** The `/pm:tracker`, `/pm:init`, and
  `/pm:upgrade` detection guidance previously let the agent infer a tracker from the fact that a
  repo is hosted on GitHub. Hosting on any Git service (GitHub, GitLab, Bitbucket, …) is **not** a
  signal — they all have issues/PRs, but a remote is not evidence that work is managed there.
  Detection now requires a *real* signal (an in-use tracker MCP, issue-key conventions, or an
  explicit statement), frames tracker mirroring as an **optional choice**, and reassures that
  declining loses nothing — the conductor always tracks everything locally in
  `.conductor/state.json` + `PROJECT.md`; a tracker only *adds* an external mirror. Choosing a Git
  host as the tracker (issues + PRs) remains fully valid.

### Upgrade

Patch release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade` to stamp `0.5.1` and refresh the rules/command docs.

---

## [0.5.0] — 2026-06-25

### Added

- **First-class epic hierarchy.** Epics gain an optional `parent` field (single-parent tree,
  arbitrary depth). `add-epic --parent <id>` validates the reference (must exist, no self-parent,
  no cycle) via a shared `parentError()` ancestor-walk helper. `PROJECT.md` renders children
  indented beneath their parent (`└─`, deepened per level), groups families ordered by parent
  priority, and shows an `X/Y children archived` rollup in the parent's Progress cell. The
  briefing's NEXT UP annotates a child with its parent id. **Grouping is render-only** — the
  `resolveEpics` priority sort is untouched, so a P0 child of a P2 parent keeps its NEXT UP slot.

- **External-tracker awareness (instruction layer only).** An optional `tracker` block in
  `state.json` (`system`, `instance`, `projectKey`, `mechanism`, and a semantic `statusIntent`
  map) makes the conductor *aware* a project mirrors epics to Jira/GitHub/Linear. **The engine
  never calls the tracker** — it only shapes the instructions it already emits:
  - the CLAUDE.md rules block gains an "External tracker sync" section assigning the interactive
    agent ownership (create issue + record key; transition on status change toward the semantic
    `statusIntent`; parent epic → tracker epic);
  - the briefing gains a `TRACKER SYNC` block listing only honestly-computable drift — active-work
    epics (`queued`/`active`/`paused`, excluding `missing()` ghosts) with no `externalId`. No
    transition-drift is fabricated (the engine cannot see tracker state).
  - New `set-tracker` subcommand (repeatable `--intent <status>:<target>`; `parseFlags` now
    accumulates `intent` like `link`) writes the block and refreshes the rules.
  - New per-epic `externalId`/`externalUrl` fields (on `add-epic` and `update-epic`).
  - New **`update-epic <id>`** write-back subcommand (positional id) mutates
    `externalId`/`externalUrl`/`parent`/`status`/`priority` on an existing epic under the same
    validation as creation — closing the sync loop after the agent creates an issue.
  - New `/pm:tracker` command doc; `/pm:init` and `/pm:upgrade` gain an agent-driven detection
    step (detect signals → confirm with the user → `set-tracker`; upgrade only when unset).

- **Atomic bulk creation.** New `add-many --from <path|->` reads a JSON `{ parent?, epics[] }`
  batch. If `parent` is present it is created first and children default their `parent` to it.
  Every entry is validated up front (id format, uniqueness vs existing AND within the batch, lane,
  status, parent refs + intra-batch cycles); on any failure nothing is written and it exits
  non-zero. A valid batch persists in a single write — removing the race that forced chaining
  individual `add-epic` calls. JSON only (the engine stays zero-dependency).

### Fixed

- **Stale-link rendering.** `render()` and the briefing now emit a link only when both its `type`
  and `epic` are strings (shared `validLink()` helper), so malformed or older-schema link entries
  no longer render as `undefined undefined`.

### Migration

- **0.5.0 migration (repair-first).** `MIGRATIONS` gains a `0.5.0` entry that normalizes stored
  `links`: valid `{type, epic}` objects pass through, the documented colon-string encoding
  `type:epic[:reason]` is repaired into an object, and unrecoverable entries are dropped. Additive
  and idempotent. Defensive rendering (above) is the shape-agnostic durable fix.

### Compatibility

All additions are optional and backward-compatible: a `state.json` written by v0.4.1 loads
unchanged, and a 0.5.0-written state remains loadable by the older engine (it ignores the new
optional fields).

### Upgrade

**Existing repos:** update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` per repo.
The upgrade runs the additive, idempotent 0.5.0 migration, refreshes the rules, and stamps
`pmVersion: 0.5.0`. To make a repo tracker-aware, run `/pm:tracker` (or answer the detection
prompt during `/pm:upgrade`).

---

## [0.4.1] — 2026-06-22

### Added

- **`/pm:upgrade` staleness guard.** `/pm:upgrade` now checks whether the running engine
  version matches the newest installed version before proceeding. If they differ (i.e. the
  plugin was updated but Claude Code has not been reloaded), it refuses with a clear message
  — "this is pm <old> but <new> is installed; run `/reload-plugins` or restart Claude Code
  first" — instead of silently re-stamping an old version. From 0.4.1 forward every upgrade
  is self-guarding.

- **SessionStart nudge fires from newest installed version.** The upgrade nudge in the
  SessionStart briefing now keys on the newest installed version (from the plugin's
  `plugin.json`) rather than the running engine version. This means the nudge fires even
  before you reload Claude Code, and it names the full sequence: (1) reload/restart; (2)
  `/pm:upgrade` per repo.

- **Documented update sequence.** `upgrade.md` and README both document the required
  three-step sequence: update the plugin → `/reload-plugins` or restart → `/pm:upgrade`
  per project. The upgrade command note now explains why the reload step is mandatory
  (Claude Code loads the engine at session start).

### Limitation

The staleness guard ships inside 0.4.1, so the first upgrade *into* 0.4.1 still runs the
old 0.4.0 engine until you `/reload-plugins`. From 0.4.1 forward every upgrade is
self-guarding.

### Upgrade

**Existing repos:** run `/pm:upgrade` after updating — refreshes rules, stamps 0.4.1 into
`state.json`. Idempotent; safe to run multiple times. No data migration required. Remember
to `/reload-plugins` first (see above).

---

## [0.4.0] — 2026-06-18

### Added

- **`status: planned` — roadmap as ordered backlog.** A new epic status for items that are
  known, sequenced, but not yet ready to start. `planned: N` appears as a brief summary line
  in the briefing; planned epics are excluded from NEXT UP and the lanes rollup, but are
  shown in the PROJECT.md epics table so the full backlog is visible.

- **`sync` auto-transitions proposed planned epics → untriaged (openspec lane).** When
  `sync`/`init` discovers a new OpenSpec change on disk and an epic with the same id already
  exists with `status: planned`, it transitions that epic to `untriaged` automatically so it
  enters the normal triage flow without manual state editing.

- **PROJECT.md stamp-on-content-change only.** `render` now compares the new output to the
  current file before writing; if the content is identical, the file is not touched. Prevents
  mtime churn and spurious git diffs when nothing meaningful changed.

- **`add-epic` validates `--status` against known statuses.** Passing an unknown status to
  `/pm:epic add` is now an error rather than silently stored. A valueless-flag guard also
  catches `--status` with no argument (e.g. `--status --lane`) and reports a clear error
  instead of treating the next flag as the status value.

- **Portable `ls -t` glob in command docs.** The `find`-based file listing in `sync` command
  documentation is replaced with a portable `ls -t` glob, removing a macOS/GNU `find`
  incompatibility.

- **`--status` documented in `/pm:epic`.** The `add` sub-command now shows all valid status
  values (including `planned`) in its help text and the commands table.

- **Roadmap on-ramp guidance.** README and SKILL document how to import an existing roadmap
  into the conductor without parsing: in an interactive session, read the roadmap doc and
  register each item via `/pm:epic add … --status planned`, choosing the appropriate
  execution lane. The conductor does not parse roadmap files automatically.

### Changed

- Rules block wording updated: documents `planned` status (roadmap on-ramp), auto-transition
  of planned epics on `sync`, and stamp-on-content-change behaviour.

### Upgrade

**Existing repos:** run `/pm:upgrade` after updating — refreshes rules, stamps 0.4.0 into
`state.json`. Idempotent; safe to run multiple times. No data migration required.

---

## [0.3.0] — 2026-06-18

### Added

- **Lane-agnostic epics.** Epics are no longer restricted to OpenSpec proposals. Every epic
  now carries a `lane` tag — `openspec | superpowers | claude-code | decision | external` —
  so the conductor tracks the full backlog regardless of how work is executed.

- **Epic schema fields.**
  - `lane` (string, optional, backward-compatible): execution lane. Defaults to `"openspec"`
    on read so existing `state.json` files are unaffected.
  - `planPath` (string, optional): repo-relative path to a Superpowers/markdown plan file.
    Used as a progress source when `stories[]` is absent.
  - `stories` (array, optional): inline `{ title, done }` story list. Highest-priority
    progress source.

- **Progress precedence resolver.** `epicProgress(epic)` replaces `storyProgress(id)` and
  resolves progress in order: `stories[]` → `planPath` checkboxes → `openspec/changes/<id>/tasks.md`
  → `—`. A dangling `planPath` renders `⚠ planPath missing` rather than silent `0/0`.

- **Non-OpenSpec epics in the briefing.** Non-OpenSpec epics now appear in NEXT UP and the
  Epics table. Only OpenSpec epics missing their on-disk change are flagged `⚠ no change on
  disk`; other lanes are shown as-is.

- **Bounded briefing.** NEXT UP is capped at **top-5** by priority-then-lane, with a
  per-lane count summary (`lanes: openspec 4 · superpowers 12 · claude-code 9`) and a
  `(+N more — see PROJECT.md)` overflow line, so the briefing stays compact regardless of
  backlog size.

- **`/pm:epic add`.** Registers a new epic directly (no `state.json` edit required):
  ```
  /pm:epic add --id X --title "…" --lane superpowers --priority P1
  ```
  Validates id format (`^[a-z0-9][a-z0-9._-]*$`), lane, and uniqueness. Optional flags:
  `--plan PATH`, `--status STATUS`, `--link "type:id:reason"`.

- **`sync` imports Superpowers plans.** `docs/superpowers/plans/*.md` are scanned on
  `sync`/`init` and registered as lane-`superpowers` epics (id = filename without `.md`,
  `planPath` set, title from first `#` heading). Additive and id-collision-safe (colliding
  ids are skipped with a warning). The plans directory may be absent — the scan returns `[]`
  gracefully.

- **Version-aware upgrade subsystem.**
  - `init` and `upgrade` stamp `pmVersion` (the running release) into `state.json`.
  - `brief()` compares the stamped version to the running release; if older, prepends a
    one-line upgrade nudge (re-shown every SessionStart and PreCompact until resolved).
  - **`/pm:upgrade`** runs registered migrations (those whose `release` is newer than the
    stamped version), then unconditionally refreshes the CLAUDE.md rules block, re-renders
    `PROJECT.md`, and re-stamps `pmVersion`. Idempotent — a second run is a no-op.
  - **0.3.0 migration:** stamps an explicit `lane: "openspec"` on any epic lacking one,
    making `state.json` self-describing.

- **Lane-agnostic detour rules.** A substantial detour becomes its own **epic in the
  appropriate lane** (not necessarily an OpenSpec proposal). The `rulesBlock()` wording and
  PUSH/POP templates are updated accordingly.

### Changed

- Epics table header changed from `Epic (OpenSpec change)` to `Epic`; a **Lane** column is
  added. Epics are sorted by priority rank then lane rank in both `PROJECT.md` and the brief.
- NOW line includes the lane tag.
- `rulesBlock()`: "epics = proposals" replaced with "epics are lane-agnostic; OpenSpec is
  one lane (openspec | superpowers | claude-code | decision | external)."

### Upgrade

**Existing repos:** after updating the plugin, run `/pm:upgrade` once. It will:

1. Refresh the CLAUDE.md rules block with lane-agnostic wording.
2. Stamp explicit `lane: "openspec"` on all pre-0.3.0 epics.
3. Record `pmVersion: "0.3.0"` in `state.json` so the upgrade nudge stops appearing.

The command is **idempotent** — running it more than once is safe and produces no changes on
the second run. No data is lost; the migration is purely additive.

---

## [0.2.0] — 2026-06-01

Initial public release. Tracks OpenSpec proposals as epics, maintains an explicit detour
stack, and enforces a reconcile gate so nothing is lost when development pivots or context
is compacted.
