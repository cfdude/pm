---
description: Set the stuck-loop and token-ceiling limits for the project, a lane or an epic
allowed-tools: Bash, Read
---

Configure the limits `spend-guard` checks. **No limit is set by default**: a repo that never runs this
sees no new behaviour except the always-on gate-round counter. `init` and `upgrade` never set one;
`upgrade` lists the guard as `NOT SET: spendGuard` until a limit exists.

```bash
conductor.mjs set-spend-guard [--epic <id> | --lane <lane>] [--max-failed-rounds <n>] [--tokens <n>] [--warn-at <pct>] [--unset max-failed-rounds|tokens|warn-at|all]
```

| Flag | Meaning |
|---|---|
| `--max-failed-rounds <n>` | a positive whole number. The epic is stuck when its rounds count reaches it. |
| `--tokens <n>` | a positive whole number of tokens. The epic is stuck when its attributed spend reaches it. |
| `--warn-at <pct>` | a whole number 1 to 99: the share of the ceiling at which the report warns. Default 80, a convention for when to start warning, not a measured threshold. |
| `--unset <field>` | removes that field from this layer only. Repeatable. `all` clears the layer. |

With neither `--epic` nor `--lane` it writes the **project** layer; `--lane` writes one lane's; `--epic`
one epic's. The two are refused together. Each field resolves independently, **epic first, then lane, then
project**, and a detour epic inherits nothing from the epic it paused. A stored value that fails its check
is ignored and reported, and resolution falls through. This is a separate cascade, not a fourth execution
profile field, so `profile` does not show it; `spend-guard` does, with each limit's source.

Every set has its inverse. A layer left with no field is removed from the record, so it is
indistinguishable from one never configured. Unsetting a field that is not set exits 0, says nothing
changed and writes nothing. A call that names nothing to set, sets and unsets the same field, or gives a
value out of range, is refused and writes nothing.

`--tokens` is only checked while spend tracking is on. With tracking off the value is recorded and the
output says it will not be checked until `set-spend-tracking on`; the guard counts rounds only.

When the first limit appears (a `maxFailedRounds` or `tokenCeiling` at the project, at any lane, or on any
epic that is not archived) the managed rules block gains a `## Spend guard` section; when the last goes it
is removed. A `warnAt` alone is not a limit. A suggested starting point for a repo that has seen a loop is
`set-spend-guard --max-failed-rounds 2`.
