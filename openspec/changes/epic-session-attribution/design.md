# Design: epic-session-attribution

## Context

`resolveSession(flags)` returns the `--session` value, else `PM_SESSION`, else null. The wrapper calls it
only while the activity log is on. The `session` flag row in `constants.mjs` lists `commands: ["claim", "unclaim"]`
with `write: "custom"`. `relates-to cross-session-epic-assignment` (archived): assignment records who
SHOULD work an epic (`epic.claim`); this records who DID.

## Goals / Non-Goals

**Goals:** the epic record names the sessions that changed it; `--session` works on every verb that can
change an epic.

**Non-Goals:**
- Linking a named session to a Claude Code transcript `sessionId` (the spend ledger's key). pm cannot see
  that mapping; a later change may record it if the agent supplies both.
- Rendering the trail in `PROJECT.md` or the brief. The brief is hot-path text; the record and `--json`
  surfaces are enough until someone asks.
- An activity-log change. It already stamps every event.

## Decisions

- **D1 — Stamp in the save, not in the wrapper.** The save already compares each epic with its loaded
  version to decide whether anything changed (`epic-annotation`, "A write that changes nothing says
  so"). Stamping there makes the session part of the SAME write and makes a no-op impossible to turn into
  a write. Alternative: a second write from the wrapper. Rejected: two writes per verb, and a window in
  which the change is recorded without its author.
- **D2 — One entry per identity, `{session, firstAt, lastAt}`.** A per-write entry would grow the epic
  with every `update-epic`; the activity log already holds the per-event trail. First-seen order is
  append-only; only `lastAt` moves.
- **D3 — Identity validation.** Non-blank after trimming, at most 128 characters, no control
  characters. Anything else is refused before any write, naming the rule. Printed through
  `escapeControls` anyway.
- **D4 — Every epic the save changed is stamped**, including an epic changed as a side effect (for
  example the previously active epic demoted by `set-active`). The trail answers "which sessions
  touched this record", which is what the save can know.
- **D5 — No inverse verb.** The trail is history; an epic removed with `remove-epic` takes it along. A
  mistyped identity is a true record of what was typed. R.1 records this as a justified omission.

## Risks / Trade-offs

- An agent that sets `PM_SESSION` once stamps every epic it touches, including bookkeeping writes. That
  is the intended reading: the record says the session wrote it, not that it did the work.
