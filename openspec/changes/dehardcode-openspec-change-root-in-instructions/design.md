# Design: dehardcode-openspec-change-root-in-instructions

## Context

`emitted-instructions` already derives "every shipped document an agent reads" at test time
(`commands/*.md`, `skills/**/SKILL.md`, `agents/*.md`, `README.md`) plus the rendered rules block and the
brief. This change reuses that population; it does not type a second list.

The epic's own NOTE warns that its original `rules.mjs:129` citation was wrong and that `rules.mjs` later
acquired an emitted literal (now `rules.mjs:301`). Every citation here is re-derived with `rg` at task time.

## Goals / Non-Goals

**Goals:** no shipped directive pins the change location; the default is still stated; the count cannot
grow back.

**Non-Goals:**
- The engine's path handling and printed messages (proposal Impact, declined deferral).
- Code comments in `scripts/lib` (not instruction text an agent is given).
- Archived change artifacts and `docs/` (project record, not shipped).

## Decisions

- **D1 — The reference form is `changeRoot` from `openspec status --change <id> --json`.** It is what the
  installed OpenSpec reports (verified on 1.14.2). Alternative: "the change root as OpenSpec resolves it"
  with no command. Rejected: an instruction an agent cannot execute is a description, not a directive.
- **D2 — One allowed literal form: `by default openspec/changes/…`.** The sweep accepts the literal only
  when the text immediately before it is `by default ` (case-insensitive). Anything else fails, naming
  the file and line.
- **D3 — Archived changes are named by what put them there**: "its archived directory (where
  `/opsx:archive` moved it)". The engine's archive detection is unchanged.
- **D4 — Older OpenSpec without `changeRoot`.** The instruction says to fall back to the default when the
  key is absent. That fallback sentence uses the D2 form.

## Risks / Trade-offs

- Longer sentences in the emitted block (a few dozen bytes). Measured by `rules --sections` before and
  after, and reported in the closeout.
- A future doc can still describe the path in prose without the `by default` prefix and fail the sweep;
  that is the intended pressure.
