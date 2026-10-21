---
description: Set the stuck-loop and token-ceiling limits for the project, a lane or an epic
allowed-tools: Bash, Read
---

Configure the limits `spend-guard` checks. **No limit is set by default**: a repo that never runs this
sees no new behaviour except the always-on gate-round counter. `init` and `upgrade` never set one;
`upgrade` lists the guard as `NOT SET: spendGuard` until a limit exists.

```bash
conductor.mjs set-spend-guard [--epic <id> | --lane <lane>] [--max-failed-rounds <n>] [--tokens <n>] [--token-basis total|work] [--warn-at <pct>] [--unset max-failed-rounds|tokens|token-basis|warn-at|all]
```

| Flag | Meaning |
|---|---|
| `--max-failed-rounds <n>` | a positive whole number. The epic is stuck when its rounds count reaches it. |
| `--tokens <n>` | a positive whole number of tokens. The epic is stuck when its attributed spend reaches it. |
| `--token-basis total\|work` | the unit `--tokens` is counted in. `total` (the default, and what an absent basis means) is every token class including `cache-read`; `work` is `input + cache-write + output`. A basis alone is not a limit. |
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

**Why a basis exists.** `cache-read` is re-counted on every assistant message, so a `total` grows with
context size times message count, not with the work done (GitHub #251: 99.3% of a 1,500,000 ceiling's count
was cache-read after 5 messages). An absent basis reads as `total`, so a ceiling set on 0.52 keeps its
meaning and nothing is migrated; `--token-basis work` counts what was actually produced. A `--tokens` value
below 10,000,000 on a `total` basis is recorded and prints one line naming `cache-read` and
`--token-basis work`; 10,000,000 is the issue's suggested floor, not a measurement, and a `work` basis has no
floor because no range has been measured yet. A tokens override is bound to the basis it was counted in
(see `override-spend-guard`).

**A worked ceiling, with provenance.** `set-spend-guard --epic <id> --tokens 300000000` (total basis) is the
value the GitHub #251 reporter reached for one epic in `cfdude/weekly-product-updates` by measuring 30
transcripts, after guessing 1,500,000 and over-correcting to 50,000,000; cache-read was 95.3% of the longest
session's 1,973,048,595 tokens. It is one repo's measurement, not a default: read your own `spend` totals
first, or count `work` instead.

`--tokens` is only checked while spend tracking is on. With tracking off the value is recorded and the
output says it will not be checked until `set-spend-tracking on`; the guard counts rounds only.

When the first limit appears (a `maxFailedRounds` or `tokenCeiling` at the project, at any lane, or on any
epic that is not archived) the managed rules block gains a `## Spend guard` section; when the last goes it
is removed. A `warnAt` alone is not a limit. A suggested starting point for a repo that has seen a loop is
`set-spend-guard --max-failed-rounds 2`.
