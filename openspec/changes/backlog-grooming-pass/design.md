# Design: backlog-grooming-pass

## Context

`list` projects each epic through `listRow()` (`scripts/lib/list.mjs`) and filters with `filterEpics()`
on `status`, `lane` and `linkedTo`. `triage "<ask>"` returns the epics sharing vocabulary with an ask and
a null verdict: the engine computes what is worth reading and never decides. The grooming pass needs the
same stance: a procedure the agent runs, with the engine supplying fields, never a verdict.

## Goals / Non-Goals

**Goals:** a pass anyone can repeat from the skill alone; every consolidation leaves a disposition;
the pass can answer "how long has this sat", "what release is it in" and "what is it for" from `list`.

**Non-Goals:**
- A verb that finds duplicates or decides anything. `triage` already computes overlap.
- Running the pass automatically, on a schedule or at sync. It is invoked.
- Mutating the record without the user's confirmation.
- A `--release` or `--priority` filter.

## Decisions

- **D1 — Option B: widen the row, filter client-side.** `listRow()` adds `release`, `createdAt`,
  `description`. Alternative A (new `--release`/`--priority`/`--older-than` flags) rejected: no measured
  case needs a server-side filter, the 2026-09-10 pass read 38 epics in one `--json` listing, and a flag
  costs a registry row in `constants.mjs`, a command-doc row and a verb-surface test each. Additive:
  `{count, epics}` is unchanged and old readers ignore new keys.
- **D2 — Absent reads as null.** `createdAt` is absent on epics registered before
  `epic-registration-clock` and not always recoverable (`recover-created-at`). The row reports `null` for
  any absent, null or non-string `createdAt`, never a guessed date; likewise `release` and `description`.
  The pass treats a null `createdAt` as "age unknown", never as "old".
- **D3 — Delivered as a skill plus a command doc, no new verb.** The procedure is judgment over several
  reads; a verb would either decide or be a thin wrapper over `list` and `triage`. A skill carries a
  rule better than a prose bullet (repo CLAUDE.md: 14/14 adoption for a required task against 3/15 for
  a bullet). The command doc is the slash entry point and states the read-only stance.
- **D4 — Double-ownership check.** The brief named `epic-index` and `list` specs. Verified on disk:
  `openspec/specs/` holds no `epic-index` and no capability that defines `list` or `listRow`
  (`rg -n "listRow|--linked-to" openspec/specs` is empty; the verb is specified only by
  `commands/list.md` and the CHANGELOG). So `epic-list` is a NEW capability, not a delta, and no
  requirement moves. `epic-disposition` owns what a disposition IS (`--outcome`, `--reason`,
  `--no-deferrals`); `backlog-grooming` only requires the pass to USE it and restates none of its
  rules. `tracker-sync` and `conductor-record` mention `createdAt` and triage but own neither the row
  nor the pass. `epic-registration-clock` has no spec under `openspec/specs/` either; its behaviour is
  cited from the CHANGELOG and `scripts/lib/created-at.mjs`.
- **D5 — Dispositions, in order.** For a pair A (survivor) and B (superseded): (1) carry B's context
  (description, notes, links) onto A with `update-epic A --notes ...`; (2) record
  `supersedes:B:<why>` on A; (3) `update-epic B --status archived --outcome superseded --reason "<what
  replaced it>" --no-deferrals`. A decline is `--outcome declined --reason`. Context first, because
  once B is archived the merge is easy to forget.
- **D6 — Evidence that does not rot.** Findings cite epic ids, verb output and shas. The 2026-09-10 pass
  lost three line-number citations in two days; one was frozen into an archived epic's reason.

## Call-site sweep (item 1, derived mechanically)

`rg -n "listRow|filterEpics" scripts` finds both defined in `scripts/lib/list.mjs` and used only there
(`listRow` mapped over the filtered epics in `list()`; no import elsewhere). The row widening therefore
has one call site and one output shape: `list --json`. `listText()` prints id, status, lane, priority,
title and is unchanged on purpose: three long fields would break one line per epic. The consumers the
emitted procedures name (tracker-sync dedup, intake, deferral ids) read `id`, `status` and `links`, and
ignore extra keys. Inverse: widening the row has no inverse to ship (nothing is written); the skill's
operations (supersede, decline) have their reopen path in the existing `update-epic <id> --status
untriaged` on an archived holder, owned by `epic-disposition`, and no new inverse is needed.
