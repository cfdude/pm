---
description: Report what pm itself injects into a session, by surface and by feature, with every figure labelled as an estimate
allowed-tools: Bash, Read
---

`overhead` answers "what does pm cost a session": the managed rules block section by section, the
SessionStart brief, the PreCompact snapshot, what each hook prints when it fires, and the command, skill
and agent descriptions the plugin ships. Each surface belongs to exactly one feature (`core`, `listings`,
or an opt-in such as `spendTracking`), so the cost of turning a feature on is a number you can read. It is
read-only: it writes nothing, opens no network connection, and reads no transcript or spend ledger.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" overhead [--all-features] [--json]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" overhead`

| Flag | Effect |
| --- | --- |
| `--all-features` | compute the same report over a named in-memory hypothetical in which every opt-in is on, and say so; each feature that is off in this repo also shows the bytes it would add. Nothing is written |
| `--json` | machine-readable: `surfaces` (`id`, `feature`, `bytes`, `estimatedTokens`, `method`, `conditional`), `features` (`on`, `bytes`, `estimatedTokens`, `surfaces`), and the session `total` |

## How to read the numbers

- Every token figure is `bytes/4`, an ESTIMATE. The engine has no tokenizer, so none is exact.
- The session total counts only surfaces paid on every session. A hook that fires on a condition (a
  reconcile owed, a matching command, a commit) is marked `[conditional]` and left out; the snapshot is
  written to a file and not injected; spend tracking's per-dispatch marker line is reported per dispatch.
- An off feature reports 0 bytes. The listings are the descriptions pm ships; the host adds formatting of
  its own that pm does not control.
- This verb measures what is injected. It does not measure whether that makes downstream work cheaper, and
  it prints no saving. Use `spend-analysis` for measured spend.
