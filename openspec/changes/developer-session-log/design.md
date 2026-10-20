# Design: developer-session-log

## Context

Ingest (`spend-ledger`) reads each transcript incrementally, folds rows by message id, and stores
`messageId`, `sessionId`, `agentId`, `actor`, `source`, `at`, `model`, `tier`, the four token classes,
`thinking` and `tools` (the `tool_use` names). The spend directory lives in the main working tree and is
git-ignored. No hook reads a transcript.

## Goals / Non-Goals

**Goals:** a per-session developer view with request/response shape, features on, tokens and retention
warnings, off by default, with no new dependency and no new hot-path work.

**Non-Goals:**
- Storing prompt or response text. Privacy and size: the ledger's own rule is "never text". **Rob's
  call** if verbatim capture is wanted; it would need its own switch, its own retention limit and a
  sentinel test, and is not specified here.
- Per-epic analysis, outlier flags, recommendations: `spend-analysis` owns those.
- Live capture from hooks. A hook reading a transcript breaks `spend-ledger`'s hot-path requirement.

## Decisions

- **D1 — Requires spend tracking.** One transcript reader, one cursor, one main-tree location, one
  ignore line. Alternative: an independent reader. Rejected: two incremental readers of the same files
  drift, and the spend-guard precedent is "never a second transcript reader".
- **D2 — Composition is a delta per assistant message.** The entries between the previous assistant
  message and this one are the request's NEW content; the cached prefix is already measured by the
  ledger's `cacheRead`. Kinds: `userText`, `toolResults` (bytes per tool name, the name resolved from the
  `tool_use_id`), `attachments` (system reminders and other injected blocks), `images` (a count). Response:
  `textBytes`, `thinkingBytes`.
- **D3 — Join, don't copy.** Tokens and tool names come from the ledger row with the same `messageId`.
  An entry whose row is gone (after `spend --clear`) reports `tokens: not in ledger`.
- **D4 — Features snapshot from `pm-overhead`.** The snapshot holds each `OPT_INS` id's on/off state and
  the per-surface bytes the `overhead` verb computes, appended only on change. A session is shown with
  the latest snapshot at or before its first message, and marked when a snapshot changed mid-session.
- **D5 — Retention warnings and thresholds** are named constants labelled proposals: `stale-session`
  at 7 days (Rob's example); `large-context` when a message's `input + cacheCreation + cacheRead` is at
  least 300,000 (the one measured outlier ran about 379K cache-read per message — assessment §6);
  `compacted` when the transcript holds a compaction boundary entry (shape verified against a real
  transcript in task 1.1; if Claude Code writes none, the rule is dropped and the reason recorded).
- **D6 — `--session-id`, not `--session`.** `--session` is pm's own session identity
  (`epic-session-attribution`); this flag names a Claude Code transcript session id. Two meanings must
  not share one flag.
- **D7a — Main tree only, like spend tracking.** Ingest reads the switch from the main working tree's
  state; `set-dev-log` is refused elsewhere so an "off" is never written where capture does not look.
  Per-session totals, `work` included, come from the shared totals builder `spend` uses
  (`gh-cfdude-pm-251` defines `work` on totals objects; rows do not carry it), grouped by `sessionId`.
- **D7 — Off stops capture, deletes nothing**; turning spend tracking off stops it too, and `dev-log`
  says which switch is off.

## Risks / Trade-offs

- The extra pass costs ingest time only while the log is on; it reads entries ingest already parses.
- Byte counts are not tokens. The report labels them bytes and never converts them silently.
