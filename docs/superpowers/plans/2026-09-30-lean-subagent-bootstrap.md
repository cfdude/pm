# lean-subagent-bootstrap — one short file a dispatched agent obeys, instead of three long ones it reads

Epic: `lean-subagent-bootstrap` (0.51.0 batch 2, superpowers lane). Repo-maintenance only: nothing ships to
plugin users (`.claude/agent-startup.md` is outside the parity-ledger directories), so no changeset.

## Design

- `.claude/agent-startup.md` (97 lines): only what a dispatched agent must obey here — test rungs and which
  files to run, the commit command and trailer, twin / drift / certify order, the zero-dependency engine, the
  parity ledger, never touching `state.json`, the flake rule (a test in `known-flakes.json` is not to be
  diagnosed), and the report format. Pointers to exact files and sections, not copies.
- `CLAUDE.md` (hand-written part only, above the managed block): a short section telling the orchestrator
  that dispatch briefs point at the file and name exact files instead of "read CLAUDE.md / CONTRIBUTING in
  full". Nothing deleted; nothing touched between the managed-block markers.

## Measurement (an ESTIMATE: bytes / 4, not a tokenizer)

| what an agent is told to load | bytes | est. tokens |
| --- | --- | --- |
| BEFORE: auto-loaded `CLAUDE.md` (47,334) + brief says read `CLAUDE.md` in full again (47,334) + `CONTRIBUTING.md` (36,032) + one design doc (12,298, median of the 10 `docs/superpowers/specs/*design*.md`) | 142,998 | ~35,750 |
| BEFORE, lower bound if the brief's `CLAUDE.md` read is not a repeat: 47,334 + 36,032 + 12,298 | 95,664 | ~23,916 |
| AFTER: `CLAUDE.md` (47,334 + the new section) + `agent-startup.md` (7,045) | 54,931 | ~13,700 |

Saving per dispatched agent: ~22,000 tokens against the literal brief, ~10,000 against the lower bound.
Not measured: how many of those files an agent actually read, and what a cached prefix costs.

## Orchestrator-only trims proposed (NOT done — the orchestrator's call)

Measured: of CLAUDE.md's 47,886 bytes, the pm-managed block (BEGIN to END markers) is 36,768 (77%); the rest is
~11,100 of hand-written text. So the cost an agent pays at load is dominated by text this repo does not write
by hand — it comes from `scripts/lib/rules.mjs`. Two options, both a product decision:

- Keep the managed block as is and accept it as the auto-load floor (the lean file saves the re-reads, not this).
- Shorten what `rules.mjs` emits for the orchestrator-only procedures (tracker sync, intake, cross-spec review,
  autonomy preflight), which a dispatched build agent never executes. That changes every pm-managed repo's
  CLAUDE.md on upgrade, so it needs its own epic and a changelog entry.
- Hand-written, safe to move: the "Tests:" bullet under "The pm engine" (it repeats CONTRIBUTING.md and
  `agent-startup.md`), ~1,900 bytes.

## Tasks

- [x] 1. Write `.claude/agent-startup.md` (<= 120 lines)
- [x] 2. Add the "Dispatching agents — lean briefs" section to `CLAUDE.md`, outside the managed block
- [x] 3. Measure and record the estimate above
- [ ] 4. Orchestrator: attribute commits, decide the trims, archive <!-- pm:lifecycle -->
