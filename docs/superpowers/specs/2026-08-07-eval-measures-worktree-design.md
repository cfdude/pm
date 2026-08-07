# Design: the eval measures the worktree, and records what it measured

**Epic:** `edd-measures-installed-plugin-not-worktree`
**Date:** 2026-08-07
**Blocks:** `hermes-platform-support`

## The defect

`evals/fixtures.py` and `evals/observe.py` invoke the **worktree** engine
(`REPO_ROOT/scripts/conductor.mjs`). But `evals/runners.py` spawns a bare `claude -p`, and that
session loads `pm@cfdude-plugins` from user-scope settings — resolved out of
`~/.claude/plugins/cache/cfdude-plugins/pm/0.25.0/`. Verified with `claude plugin list`.

So the harness is half worktree and half installed plugin, and the halves are exactly backwards:
fixture setup and observation come from the code under development, while **everything actually
under test** — the SessionStart brief, the rules block, the command docs, the agents, the hooks,
and the engine those hooks call — comes from a separately installed copy.

Two consequences:

1. **Editing an artifact does not change the measurement.** Change `commands/next.md` in the
   worktree, re-run the corpus, get an identical result. The port loop this epic exists to
   enable — change a Hermes artifact, re-run, compare — cannot work.
2. **A blessed baseline does not say what it described.** `evals/.edd/baseline.json` keys on
   one axis, `pm@claude-code|-`, and records no plugin version. A baseline blessed today and
   compared against in three releases' time is a comparison against an unidentified artifact set.

Note the second survives even if the first is fixed: pointing the run at the worktree makes the
measurement correct *today* without making a stored baseline interpretable *later*. Both halves
are in scope.

## Mechanism: `--plugin-dir`

`claude --plugin-dir <path>` loads a plugin from a directory for that invocation only. It is
per-invocation, needs no marketplace registration, and mutates nothing. Proven end-to-end
against the live worktree with the corpus's own lane-routing prompt:

```
claude -p "<lane-routing prompt>" --plugin-dir /Users/robsherman/Documents/Repos/pm \
  --allowedTools Bash --permission-mode acceptEdits --output-format json
→ is_error: false, num_turns: 9, duration_ms: 95200
→ epics after: canary-active (active), readme-typo-fix (claude-code, queued)
```

pm's hooks fired, the rules block routed the lane, the active pointer survived — the scenario
passing against the worktree rather than the installed copy.

### `--plugin-dir` ADDS; it does not replace

```
$ claude --plugin-dir <worktree> plugin list        # without a disable
  ❯ pm@cfdude-plugins   0.25.0            ✔ enabled
  ❯ pm@inline           0.25.0  Path:...  ✔ loaded
```

Both load: two SessionStart hooks, two sets of `/pm:` commands, two engines. **The fixture must
also disable the installed pm**, which project-scope settings can do headlessly (verified:
`pm@cfdude-plugins` → `✘ disabled`).

### Rejected alternatives, each ruled out empirically

| Approach | Why not |
|---|---|
| `CLAUDE_CODE_PLUGIN_SEED_DIR` | Ignored when the plugin is already installed — it only pre-populates what is missing. Tested; no override. |
| `CLAUDE_CODE_PLUGIN_CACHE_DIR` | Same. Tested; no override. |
| Project settings alone installing a local marketplace | Needs an interactive trust prompt that `-p` never receives. The marketplace never registers. |
| `plugin marketplace add` + `install` from a temp marketplace | Works, but leaves a permanent marketplace + plugin in user-scope config, and plugin sources must be `./`-relative inside the marketplace root (an absolute path is rejected: `source: Invalid input`), so it also needs a per-run snapshot copy. |
| Isolating everything under `CLAUDE_CONFIG_DIR` | The run is **`Not logged in`**. Claude Code keys its keychain credential on a service name suffixed with a hash of the config dir (`Claude Code-credentials-<hex>`), so a new config dir looks up an entry that never existed. Copying `settings.json` and even the whole `~/.claude.json` does not help — the credential was never in a file. Making it work would mean duplicating a live OAuth token into a second keychain entry per run. |
| Materializing artifacts into the fixture's own `.claude/` | Project-scope commands are not namespaced, so the agent would see `/status` where the product ships `/pm:status` — the corpus would measure a command surface that does not exist in production. It also needs a `hooks.json` → settings-hooks translation layer, a fresh drift seam of exactly the kind this repo keeps getting bitten by. |

`--plugin-dir` beats all of them on the axis that matters: everything under test loads through
the same plugin machinery it ships through — same `/pm:` namespace, same `${CLAUDE_PLUGIN_ROOT}`
hook resolution — while the session authenticates normally because it is the operator's real
config.

## Provenance

`claude plugin list --json`, run in the fixture with the same flags, reports what a run loads:

```json
{"id":"pm@inline","version":"0.25.0","scope":"session","enabled":true,
 "installPath":"/Users/robsherman/Documents/Repos/pm"}
{"id":"pm@cfdude-plugins","version":"0.25.0","scope":"user","enabled":false, ...}
```

`observe()` gains four fields from that JSON plus git:

| Field | Source |
|---|---|
| `plugin_id` | the single enabled `pm@*` entry — `pm@inline` when correct |
| `plugin_install_path` | its `installPath`, expected to equal `REPO_ROOT` |
| `plugin_version` | its `version` |
| `plugin_commit`, `plugin_dirty` | `git rev-parse HEAD`, `git status --porcelain` in `REPO_ROOT` |

`plugin_dirty` earns its place: a run against uncommitted edits is the normal daily loop, but a
*baseline* blessed from a dirty tree describes a state no commit reproduces. Recording it is what
makes that visible.

### The axis key does not change

`edd_harness.store.bless()` writes `{model_under_test, judge_model, label, checks}` under
`axis_key(model_under_test, judge_model)`. Provenance goes in `label` —
`bless(..., label="pm 0.25.0 @ 3dccc2e")` — never in the key.

Putting the version into `model_under_test` would mint a fresh axis on every release. A version
bump would then produce "no baseline for this axis → every check NEW → nothing classified as a
regression," blinding the comparison at exactly the moment behavior is most likely to have
changed. That is the vacuous-coverage failure mode promoted to the axis level.

`label` is a **convention, not an enforced field**: nothing compels a future bless to supply it.
Enforcement belongs to edd-harness, which is outside this epic — see Out of scope.

## The check that can fail

A scorer, `measured_the_worktree`, asserting `plugin_id == "pm@inline"` **and**
`plugin_install_path == REPO_ROOT`.

Three concrete ways it fails today, each to be demonstrated during implementation rather than
asserted:

1. Drop `--plugin-dir` from `runners.py` → `plugin_id` is `pm@cfdude-plugins`.
2. Omit the `enabledPlugins` disable → two enabled `pm@*` entries, which the "exactly one
   enabled" derivation rejects.
3. Point `--plugin-dir` at a stale copy → `plugin_install_path` mismatches `REPO_ROOT`.

This also retires a hardcode. Rather than a literal `"pm@cfdude-plugins": false` — the same shape
as `observe.py`'s old hardcoded `CLAUDE.md`, and silent in the same way — `fixtures.py` enumerates
enabled `pm@*` entries of `scope: "user"` from that JSON and disables each by id. A pm installed
from a differently named marketplace is then still disabled, and if the enumeration ever misses
one, the scorer fails loudly instead of the run quietly measuring two plugins at once.

## Scope

**In scope:** `--plugin-dir` in `runners.py`; computed disable in `fixtures.py`; four provenance
fields in `observe.py`; the `measured_the_worktree` scorer in `corpus.py`; the adapter's
failure-path key set kept in sync.

**Out of scope, each filed rather than assumed:**

- **Enforcing the bless label** — belongs to `edd-harness`, a sibling repo. This epic writes the
  convention; making a bless without provenance impossible is a change there.
- **Committed self-tests that spend real `claude -p` runs.** Verifying the three failure modes
  costs a live agent run each. They will be run during implementation as verification; whether
  any belong in the committed suite is a separate decision, not smuggled in here.
- **Re-blessing the existing baseline.** The current `evals/.edd/baseline.json` describes the
  installed plugin. Once the harness measures the worktree, it describes something else and must
  be re-blessed with a provenance label — an operator action, not a code change.
- **Retiring `_write_memory_isolation`'s `claudeMdExcludes`.** An isolated `CLAUDE_CONFIG_DIR`
  would have suppressed operator memory structurally, which is tempting — but it is ruled out
  above for auth reasons, and the shipped isolation belongs to a different, completed epic.

## Testing

- **The scorer is the test**, and it can fail three ways (above), each demonstrated empirically
  during implementation.
- **Unit tests, no agent runs:** the `pm@*` enumeration and disable computation, and the
  provenance extraction, both against captured `plugin list --json` fixtures — including the
  two-enabled-entries case and the zero-entries case.
- **The adapter's key-set invariant holds:** `_failure()` must carry the four new keys, or a
  broken run raises `KeyError` in a scorer instead of failing. This invariant already has a test;
  it must cover the new keys.

## Consequence

Editing an artifact in the worktree changes the next run's result. That is the loop
`hermes-platform-support` needs, and it does not exist today.
