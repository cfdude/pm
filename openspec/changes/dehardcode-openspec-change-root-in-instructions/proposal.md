# Proposal: dehardcode-openspec-change-root-in-instructions

## Why

pm's instruction text tells agents to read and write OpenSpec changes at the literal path
`openspec/changes/<id>/`. OpenSpec resolves a change's location itself (`openspec status --change <id> --json`
reports it as `changeRoot`, OpenSpec 1.14.2), and a store or relocated planning home puts it elsewhere.
An instruction that hardcodes the default points an agent at a directory that may not hold the change.

The site count keeps growing faster than it is fixed (epic notes): 4 sites in 3 files when the epic was
registered, 17 lines in 7 files at the 0.53 assessment, and `rg -c "openspec/changes"` at `c78c6828`
finds 27 lines in 8 shipped files plus 7 in `README.md`:
`scripts/lib/rules.mjs` (1, EMITTED into every managed repo's `CLAUDE.md`), `agents/reconciler.md` (2),
`skills/conductor/SKILL.md` (3), `commands/{status,epic,sync,detour,cross-spec-review}.md` (7, 8, 4, 1, 1).
The emitted line spreads on every fleet upgrade.

## What Changes

- Every directive in shipped instruction text that names a change's location names it as OpenSpec
  resolves it: "the change's directory (`changeRoot` from `openspec status --change <id> --json`)", and
  for an archived change "its archived directory, which `/opsx:archive` moves it to".
- The default location may still be stated as a default, in the form `by default openspec/changes/…`,
  so a reader on a stock layout is not left guessing.
- A sweep test over the same shipped-document population `emitted-instructions` already derives, plus
  the rendered rules block and brief, fails on any other `openspec/changes/` literal, so the count can
  only fall.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `emitted-instructions`: ADDS "Shipped instructions name an OpenSpec change's location as OpenSpec
  resolves it".

## Impact

- Shipped text: `scripts/lib/rules.mjs` (emitted; managed-rules surface, functional certify),
  `agents/reconciler.md`, `skills/conductor/SKILL.md`, `commands/status.md`, `commands/epic.md`,
  `commands/sync.md`, `commands/detour.md`, `commands/cross-spec-review.md`, `README.md`.
- A new FILE-rung sweep test under `scripts/test/assert/`.
- **Out of scope (declined deferral):** the engine's own path handling and the messages it prints
  (`subcommands.mjs`, `integrity.mjs`, `update-epic.mjs`, `archive-gate.mjs`, `epic-progress.mjs` and
  others). The engine really does read `openspec/changes/`, so a message naming that path is true; making
  the engine follow `changeRoot` is a relocation feature, not an instruction fix.
- Mintlify mirrors several of these command pages; the orchestrator syncs them.
