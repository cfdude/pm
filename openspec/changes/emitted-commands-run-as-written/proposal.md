## Why

pm is an instruction layer: its whole output is text an agent follows literally. Three review
findings of 0.43.0 (D1, D2, E1, C1) and gh-189 show that text still hands the agent commands the
engine refuses, recipes that silently lose data, and instructions to hand-edit `.conductor/state.json`
that the rules block forbids. Each was fine against the argv check 0.44.0 added — the 0.44.0 sweep
ran 487 emitted lines through `checkCommandLine()` and found "no emitted line needed correcting"
(`openspec/changes/archive/2026-09-15-every-verb-refuses-what-it-does-not-read/call-site-sweep.md`
§5) — because every defect below is a well-formed command line refused by DOMAIN logic, or a recipe
that runs and quietly does the wrong thing. Nothing in the suite executes what pm emits.

Every defect was reproduced on the 0.44.0 engine in hermetic scratch repositories (created outside
the checkout) by `repro.sh` in this change directory; its transcript is `repro.txt`.

**Remedies the engine prints and then refuses** (`repro.txt` §D1–D3):
- `integrity`'s `delivered-release-epic-left-open` prints `update-epic os-two --status archived
  --outcome delivered --no-deferrals` for an openspec-lane member with no Gate 2; run literally it
  exits 1. The refusal's own remedy, `record-gate-review os-two --gate 2 --verdict pass`
  (`archive-gate.mjs:426`, `:431`), exits 1 again for want of `--base-sha`/`--head-sha` — while
  `briefing.mjs:222,235` and `integrity.mjs:249,263` print the same remedy WITH both flags.
- gh-189: `unconsidered-outcomes` offers `--outcome <delivered|…>` for an openspec-lane epic with
  no passing Gate 2; the `delivered` substitution exits 1. The reporter measured 12 of 20 entries
  blocked. The same renderer (`dispositionInvocation`) feeds `integrity`'s
  `epic-in-undefined-status` remedy and update-epic's regression refusal.

**Tracker recipes that cannot run as written** (`repro.txt` §B):
- The SECONDARY `gh issue list` line requests `number,title,url,labels` — no `updatedAt` — while the
  `add-epic` line two steps later requires `--external-updated-at <issue-updated-at>`. The primary
  line (`rules.mjs:762`) has it; the secondary (`:826`) does not. The secondary section also has no
  watermark step (primary step 5).
- `gh issue list` without `--limit` returns at most 30 items (`gh issue list --help`: "default 30").
  Items past 30 are never registered, and the closed-item step then proposes archiving every linked
  epic whose item was on page two.
- A jira primary emits `add-epic --id jira-abc-<issue-number>`; filled from the key `ABC-123` it is
  refused (`--id required, format ^[a-z0-9][a-z0-9._-]*$`, exit 1).
- `set-tracker --system github-issues --repo 'a/b; touch pwned'` is accepted and emitted into a shell
  line unquoted: `` `gh issue list --repo a/b; touch pwned --state open …` ``.
- Every registration line wraps third-party text in double quotes with no instruction:
  `--title "<issue-title>"` and `suggest-lane "<issue-title>"`. An issue titled with `"`, `$(…)` or a
  backtick changes the command the agent runs; plain single quotes break on an apostrophe. Quoting
  alone is not enough either: the engine classifies `--limit=5 ignored` as a flag even inside quotes,
  so `--title '--limit=5 ignored'` exits 1 and `suggest-lane '--foo'` exits 1 telling the agent to
  quote the value it already quoted; `--title='--limit=5 ignored'` is accepted.
- Switching a legacy primary with no recorded direction from github-issues to jira turns outward
  creation ON: the inward section disappears and an "External tracker sync (jira · ABC)" section
  appears, because an unrecorded direction resolves by system (`repro.txt` §B9).
- Switching a primary's vendor keeps the old scope: after `set-tracker --system jira --project ABC`
  the recorded `repo` survives, `trackerScope()` prefers it, and the jira section is headed
  `(jira · a/b; touch pwned)` with `add-epic --id jira-a-b-touch-pwned-<issue-number>`.
- An inward-only github-issues primary with no secondary emits "the writeback steps above" with no
  writeback step anywhere in the block — the exact case the existing requirement "The completion-sync
  reminder is emitted only where an inward procedure exists" forbids; its test checks a heading.
- Both inward sections point at `/pm:epic list`, which does not exist.
- The brief prints `✓ all active epics are mirrored to jira` while the active epic is linked to the
  github-issues SECONDARY, and `⚠ 1 tracker-linked epic(s) never re-read — run /pm:sync` for an
  epic whose link `/pm:sync` never reads (an outward-created jira link carries no watermark and no
  step records one). With an outward-only jira primary and a github-issues secondary the block has
  no jira inward step at all; `record-tracker-refresh` clears the line (1 → absent), `/pm:sync`
  cannot (`repro.txt` §B8).

**Shipped docs that teach refused or wrong forms** (`repro.txt` §C):
- `agents/hierarchy-child-executor.md:33` teaches `record-gate-review <id> --gate 1|2 --verdict
  pass|fail [--reviewer]`: exit 1 on both gates. `skills/conductor/SKILL.md:117-119,322,1216` and
  `commands/review-mode.md:72` say a pass needs the sha range on EITHER gate; on Gate 1 that records
  an implementation range with a "wrong kind of evidence" notice (exit 0), never `--artifact`.
- `commands/review-mode.md:99` says an epic override has no unset; `update-epic <id> --clear
  review-mode` clears it (repro: `reviewMode after --clear: undefined`).
- `commands/upgrade.md:226` names `/pm:integrity` (no such command); `commands/cross-spec-review.md:85`
  runs `node scripts/conductor.mjs` (a pm checkout only); the child doc (`:62-72`) ships pm-repo-only
  README/test instructions to every user.

**Hand-edit instructions** (review C1, D2, E1): `init` prints `Triage epics in .conductor/state.json
(set priority/status/active)`; `commands/init.md:60-63` says to "set `active`… assign each epic a
`priority`"; `SKILL.md:734` says "update `state.json` status" and `:738` "On PUSH/POP/priority
change: edit `state.json`"; the commit nudge (`subcommands.mjs:496`) says "Otherwise update
`.conductor/state.json`". An agent following these skips the verbs' validation, lock and the POP
same-write `reconcileNeeded` stamp.

**Already fixed — verified on the current tree and dropped:** a scope-less secondary emitting
`add-epic --id null-…` (`trackerScope` reads a secondary's `projectKey`; repro renders `gh-abc-…`);
`set-tracker` accepting unknown flags (0.44.0 pre-dispatch: `set-tracker --zzz` exits 1); `--help`
omitting required positionals (`record-gate-review --help` prints `<id>`); SKILL's tracker section
omitting direction (it now leads with it); SKILL's `set-gate-guard` read-back (a bare
`set-gate-guard` does print the setting). The completion-sync reminder's GATING was repaired
earlier (`anyInwardProcedureEmittable`); its dangling text for an inward-only primary was not, and is carried here.

## What Changes

- **One renderer per remedy, epic-aware.** The gate-verdict remedy is rendered from one declaration
  that carries the evidence its gate requires (range for Gate 2, `--artifact` for Gate 1). The
  disposition invocation takes the EPIC, not its id, and offers only outcomes the archive gate
  accepts for it, naming what blocks `delivered` where something does — except update-epic's
  refusal of an edit that would break an archived `delivered` record, which keeps `delivered` and
  names the Gate 2 re-record first. `integrity`'s delivered-release remedy consults the same
  obligations.
- **A permanent emitted-invocation sweep test.** Every engine invocation pm emits (rules block over
  every platform × tracker role/system/direction, brief, `integrity`, archive-gate refusals,
  `unconsidered-outcomes`, `init`, commit nudge) and every one in shipped docs (`commands/*.md`,
  `skills/**/SKILL.md`, `agents/*.md`, `README.md`) passes the pre-dispatch check; every engine-printed
  remedy is additionally EXECUTED, placeholders filled BY MEANING, against a fixture that reproduces
  its finding — and the producer is re-run to assert the finding is GONE, not only that the remedy
  exited 0. Each alternative a remedy offers runs in its own fresh fixture. Deliberate refused examples carry an in-source marker naming the
  refusal class they demonstrate; the population is derived from the engine's exported registries,
  never listed in the test. `/pm:<name>` references must name a shipped
  command or skill.
- **Tracker recipes:** one declaration of the inward list step for primary and secondary (fields
  include `updatedAt`, an explicit `--limit`, and a truncation stop before the closed-item step); a
  watermark step in the secondary section; a derived id that is valid for non-numeric item keys;
  `set-tracker` refuses a github-issues `--repo` that is not `owner/name`, and no emitter
  interpolates one into a shell line; a primary vendor switch drops scope the call does not re-give and never silently turns on the
  outward direction; item-sourced placeholders (title, url) are shell-quoted by an instruction the
  recipe carries and passed in inline `--flag=value` form (`--title=`, `--external-url=`, and a new
  `suggest-lane --ask=<text>` flag, positional form kept) so a flag- or help-shaped title is data;
  the completion-sync reminder no longer points at absent steps; `/pm:epic list` is gone.
- **Brief tracker lines:** the mirror line states what it checked, not a mirror it cannot attribute;
  the never-re-read line names a remedy that clears every epic it counts.
- **Docs:** every gate-recording form matches the gate (including the hierarchy child's); review-mode
  unset, `/pm:integrity`, checkout-path and pm-repo-only instructions
  corrected; `commands/tracker.md` responsibilities scoped by direction.
- **No hand-edit instructions anywhere pm ships**: `init` stderr, commit nudge, `SKILL.md`,
  `commands/init.md` name the verbs (`set-active`, `update-epic --priority/--status`).
- **Out of scope, carried to `code-review-0-43-0-minors`:** primary `set-tracker --remove` removes
  nothing — the flag is ignored, so bare it exits 0 changing nothing, and with a valid `--repo` it
  exits 0 having REPLACED the recorded repo (a missing inverse; a malformed `--repo` is refused since
  Gate 2 E-C1) — and `--intent badpair` is silently dropped — reproduced
  (`repro.txt` §B4-B6) but neither corrupts an emitted command; `verify-worktrees`/`verify-state`
  have no command doc.
- **Moved out to its own epic, `hierarchy-run-has-one-state-writer`:** a single writer of
  `state.json` in hierarchy runs (`SKILL.md:1080` says children never write it; the child doc has
  the child record gate verdicts and archive). It is a new design, not an emitted-command fix, with
  open questions of its own: the rules block orders children to attribute commits, the `tasks.md` a
  child is handed carries gate and archive tasks, a merge commit makes a child-recorded Gate 2
  stale, and evidence would travel back in prose. This change only corrects the child doc's
  gate-recording FORM.

## Capabilities

### New Capabilities
- `emitted-instructions`: what pm guarantees about the invocations and remedies it emits and ships —
  accepted by the installed engine, remedies that clear the finding that printed them, and gate
  evidence forms that match the gate.

### Modified Capabilities
- `tracker-sync`: "Every command pm emits must run as written" extended to every tracker
  role/system/direction (fields, truncation, non-numeric keys, repo shape); "Primary tracker
  configuration" drops a stale scope on vendor switch and keeps the direction the user had; "The
  brief reports only locally computable freshness" requires a remedy that clears the count and an
  outward key-recording line that stamps a watermark; ADDED a secondary watermark step, a repo-shape
  rule, and a brief mirror line that claims only what it checked.
- `epic-disposition`: "The archive can be asked which of its records carry no considered outcome" —
  the invocation offers only outcomes the gate accepts and names what blocks `delivered`; the
  archived-delivered regression refusal is explicitly excepted.
- `conductor-record`: ADDED — no instruction pm ships directs a write to the state of record except
  through an engine verb.

## Impact

- Engine: `scripts/lib/rules.mjs` (tracker sections), `archive-gate.mjs` (`dispositionInvocation`,
  gate remedy, exported obligation kinds), `integrity.mjs` (remedy strings), `unconsidered.mjs`,
  `update-epic.mjs` (regression refusal remedy), `argv-surface.mjs` (a refusal class on each refusal), `briefing.mjs` (an exported list of its remedy-bearing warnings; two tracker lines at 271-310), `tracker.mjs` (repo shape, vendor switch),
  `constants.mjs` (`mirroredEpicIdPrefix` placeholder, `trackerScope` unchanged),
  `subcommands.mjs` (`init` stderr, one sentence of `runNudge`).
- Output shape: `unconsidered-outcomes` JSON gains a per-entry field (additive); emitted rules text
  changes for every tracker-configured repo (re-rendered by `/pm:upgrade`). No `state.json` schema
  change, no migration — but a repo whose recorded github-issues `repo` is not `owner/name` stops
  receiving a literal `gh` line (it gets the vendor-neutral step) until it re-runs `set-tracker` —
  and `integrity` names it with that re-record. GitHub Enterprise `HOST/owner/name` is accepted.
- Tests: a new `scripts/test/emitted-invocations.test.mjs`; `conductor-14` tracker recipe tests
  extended to every system/role.
- Docs: `commands/{init,tracker,review-mode,upgrade,cross-spec-review,unconsidered-outcomes}.md`,
  `skills/conductor/SKILL.md`, `agents/hierarchy-child-executor.md`, `README.md`, `CHANGELOG.md`.
- Coordination: `runNudge` belongs to `commit-nudge-reads-the-whole-move`; `briefing.mjs`,
  `integrity.mjs` and `archive-gate.mjs` are also edited by `user-text-never-forges-output` (see
  design.md "Coordination").
