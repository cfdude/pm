# Eval Measures the Worktree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EDD harness measure the pm artifacts in this worktree instead of the separately-installed plugin, and record in every observation which artifact tree was measured.

**Architecture:** `claude -p` gains `--plugin-dir <REPO_ROOT>`, which loads the worktree's plugin for that invocation only. Because `--plugin-dir` *adds* rather than replaces, the fixture must also disable the installed pm — computed from `claude plugin list --json` rather than hardcoded. That same JSON is the provenance source: a new `evals/provenance.py` parses it once and serves both the disable list and the provenance fields, so the disable and the check that the disable worked cannot disagree.

**Tech Stack:** Python 3 + pytest (`evals/`, run with `uv run pytest`). No new dependencies. Shells out to `claude` and `git` via `subprocess`, which `evals/` already does.

**Spec:** `docs/superpowers/specs/2026-08-07-eval-measures-worktree-design.md`

## Global Constraints

- **`evals/` may shell out; the pm ENGINE may not.** `scripts/conductor.mjs` and `scripts/lib/*.mjs` must not be touched by this plan at all. pm is an instruction layer and never calls an external system; `evals/` is repo-maintenance tooling and already invokes `node` and `claude`.
- **No new Python dependencies.** `evals/pyproject.toml` gains nothing. Standard library only (`subprocess`, `json`, `pathlib`, `shutil`).
- **Test suites must pass:** `cd evals && uv run pytest` — currently **23 passed**. And `node --test scripts/test/*.test.mjs` — currently **301 passed** — must remain untouched and green (run it once at the end to prove nothing leaked).
- **NEVER `git commit --no-verify`.** The pre-commit hook runs the node suite.
- **Do NOT push and do NOT open a pull request.** Commits stay local; the branch is finished separately via the `pr-workflow` skill.
- **Stay on branch `dev`.** The working tree has pre-existing uncommitted `.claude/commands/opsx/*` and `.claude/skills/openspec-*` changes from an OpenSpec upgrade — **leave them alone, do not stage them.**
- Conventional commits (`feat|fix|docs|test|chore|refactor`).
- **No version bump, no `CHANGELOG.md` entry, no `MIGRATIONS` entry, no README/Mintlify change.** Stated explicitly rather than skipped: `evals/` is repo-maintenance tooling, not part of what the plugin ships to users. Nothing user-invocable changes. Version stays `0.25.0`.

### Frozen facts — verified, do not re-derive

| Fact | Value |
|---|---|
| Flag that loads a local plugin | `claude --plugin-dir <path>` — **global flag, before the subcommand** |
| Its effect | **adds**; the installed plugin stays enabled unless separately disabled |
| Loaded worktree entry | `{"id":"pm@inline","version":"0.25.0","scope":"session","enabled":true,"installPath":"<REPO_ROOT>"}` |
| Installed entry | `{"id":"pm@cfdude-plugins","version":"0.25.0","scope":"user","enabled":true|false,"installPath":"~/.claude/plugins/cache/..."}` |
| Disabling from project settings | `.claude/settings.json` → `{"enabledPlugins": {"pm@cfdude-plugins": false}}` works headlessly |
| Machine-readable listing | `claude --plugin-dir <p> plugin list --json` → a JSON array of those objects |

`installPath` for `pm@inline` is the **literal path passed to `--plugin-dir`**, so comparing it to `REPO_ROOT` detects a stale-copy mistake.

## File Structure

- **`evals/provenance.py`** (create) — the only place `claude plugin list --json` is parsed. Owns `REPO_ROOT`, the pm-entry filters, the disable list, and git provenance. One responsibility: *answer "which pm is loaded, and which tree is it".*
- **`evals/fixtures.py`** (modify) — import `REPO_ROOT` from `provenance` instead of defining it; write the computed `enabledPlugins` disable into the settings file it already writes.
- **`evals/runners.py`** (modify) — add `--plugin-dir` to the `claude -p` argv.
- **`evals/observe.py`** (modify) — add the five provenance fields to the returned dict.
- **`evals/adapter.py`** (modify) — add the same five keys to `_failure()` so the key-set invariant holds.
- **`evals/corpus.py`** (modify) — add the `measured_the_worktree` scorer.
- **`evals/tests/test_provenance.py`** (create) — unit tests over captured JSON, no agent runs.

---

### Task 1: The provenance module

**Files:**
- Create: `evals/provenance.py`
- Create: `evals/tests/test_provenance.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```python
  REPO_ROOT: Path                                   # the pm worktree root
  def plugin_list(project: Path) -> list[dict]      # `claude --plugin-dir REPO_ROOT plugin list --json`, [] on any failure
  def pm_entries(entries: list[dict]) -> list[dict] # entries whose id's name component is exactly "pm"
  def installed_pm_ids(entries: list[dict]) -> list[str]   # enabled + scope=="user" -> ids to disable
  def git_provenance() -> dict                      # {"plugin_commit": str|None, "plugin_dirty": bool|None}
  def plugin_provenance(project: Path) -> dict      # the five observe fields
  ```
  `plugin_provenance` returns exactly these keys: `plugin_id`, `plugin_install_path`, `plugin_version`, `plugin_commit`, `plugin_dirty`. `plugin_id`/`plugin_install_path`/`plugin_version` are `None` unless **exactly one** pm entry is enabled — zero or two both yield `None`, which is what makes "exactly one enabled" assertable by Task 4's scorer without a fifth field.

- [ ] **Step 1: Write the failing tests**

Create `evals/tests/test_provenance.py` with exactly this content:

```python
"""Unit tests for provenance parsing. No agent runs, no `claude` invocation —
every test feeds captured `plugin list --json` shapes to the pure functions."""

from __future__ import annotations

import provenance

# Captured verbatim from `claude --plugin-dir <repo> plugin list --json` (trimmed to pm rows).
INLINE = {
    "id": "pm@inline", "version": "0.25.0", "scope": "session", "enabled": True,
    "installPath": "/Users/x/Documents/Repos/pm",
}
INSTALLED_ON = {
    "id": "pm@cfdude-plugins", "version": "0.25.0", "scope": "user", "enabled": True,
    "installPath": "/Users/x/.claude/plugins/cache/cfdude-plugins/pm/0.25.0",
}
INSTALLED_OFF = {**INSTALLED_ON, "enabled": False}
OTHER_PLUGIN = {
    "id": "honcho@cfdude-plugins", "version": "0.7.0", "scope": "user", "enabled": True,
    "installPath": "/Users/x/.claude/plugins/cache/cfdude-plugins/honcho/0.7.0",
}


def test_pm_entries_matches_the_name_component_not_the_marketplace():
    entries = [OTHER_PLUGIN, INLINE, INSTALLED_ON]
    assert provenance.pm_entries(entries) == [INLINE, INSTALLED_ON]


def test_pm_entries_ignores_a_plugin_whose_name_merely_starts_with_pm():
    # `pm-worktree@x` is NOT pm. Matching on a prefix would disable an unrelated plugin.
    entries = [{"id": "pm-worktree@x", "version": "1", "scope": "user", "enabled": True, "installPath": "/tmp/a"}]
    assert provenance.pm_entries(entries) == []


def test_installed_pm_ids_returns_every_enabled_user_scope_pm():
    # Deliberately NOT hardcoded to "pm@cfdude-plugins" — a pm installed from a differently
    # named marketplace must still be disabled, or the run silently measures two plugins.
    second = {**INSTALLED_ON, "id": "pm@other-marketplace"}
    assert provenance.installed_pm_ids([INLINE, INSTALLED_ON, second, OTHER_PLUGIN]) == [
        "pm@cfdude-plugins", "pm@other-marketplace",
    ]


def test_installed_pm_ids_skips_already_disabled_and_session_scope():
    assert provenance.installed_pm_ids([INLINE, INSTALLED_OFF]) == []


def test_plugin_fields_report_the_single_enabled_pm():
    fields = provenance._fields_from_entries([INLINE, INSTALLED_OFF])
    assert fields == {
        "plugin_id": "pm@inline",
        "plugin_install_path": "/Users/x/Documents/Repos/pm",
        "plugin_version": "0.25.0",
    }


def test_plugin_fields_are_none_when_two_pms_are_enabled():
    # The double-load case. None here is what makes the scorer fail instead of silently
    # reporting whichever entry happened to sort first.
    assert provenance._fields_from_entries([INLINE, INSTALLED_ON]) == {
        "plugin_id": None, "plugin_install_path": None, "plugin_version": None,
    }


def test_plugin_fields_are_none_when_no_pm_is_enabled():
    assert provenance._fields_from_entries([INSTALLED_OFF]) == {
        "plugin_id": None, "plugin_install_path": None, "plugin_version": None,
    }


def test_plugin_provenance_carries_exactly_the_five_documented_keys(monkeypatch, tmp_path):
    monkeypatch.setattr(provenance, "plugin_list", lambda project: [INLINE, INSTALLED_OFF])
    out = provenance.plugin_provenance(tmp_path)
    assert set(out) == {
        "plugin_id", "plugin_install_path", "plugin_version", "plugin_commit", "plugin_dirty",
    }


def test_plugin_list_returns_empty_rather_than_raising_when_claude_is_unavailable(monkeypatch, tmp_path):
    # An eval must be able to SCORE a broken run, not crash on it — same rule the adapter
    # follows for infrastructural failure.
    def boom(*a, **k):
        raise OSError("claude: not found")
    monkeypatch.setattr(provenance.subprocess, "run", boom)
    assert provenance.plugin_list(tmp_path) == []


def test_git_provenance_reports_the_real_repo_and_a_boolean_dirty_flag():
    out = provenance.git_provenance()
    assert set(out) == {"plugin_commit", "plugin_dirty"}
    assert isinstance(out["plugin_commit"], str) and len(out["plugin_commit"]) >= 7
    assert isinstance(out["plugin_dirty"], bool)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd evals && uv run pytest tests/test_provenance.py -q`

Expected: collection error — `ModuleNotFoundError: No module named 'provenance'`.

- [ ] **Step 3: Write the module**

Create `evals/provenance.py` with exactly this content:

```python
"""Which pm plugin a run actually loaded, and which tree it came from.

THE POINT. `claude -p` loads plugins from the operator's user-scope settings, so before
`--plugin-dir` existed the harness measured the INSTALLED pm while fixtures and observation
used the worktree. Everything under test came from a different copy of the code than the one
being edited. This module is the single parser of `claude plugin list --json`: it produces both
the disable list (which installed pm to switch off) and the provenance fields (which pm was
actually loaded). One parser on purpose — if the disable and the check that the disable worked
read different sources, they can disagree, and a disagreement here is invisible.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

TIMEOUT = 60


def plugin_list(project: Path) -> list[dict]:
    """`claude --plugin-dir <REPO_ROOT> plugin list --json`, run inside `project`.

    Returns [] on ANY failure (claude missing, non-zero exit, unparseable output). An eval must
    be able to score a broken run rather than crash on it; [] flows through to `plugin_id: None`,
    which the scorer FAILS on -- loudly, and without an exception that would be mapped to
    INDETERMINATE and silently exit 0.
    """
    try:
        proc = subprocess.run(
            ["claude", "--plugin-dir", str(REPO_ROOT), "plugin", "list", "--json"],
            cwd=str(project),
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    try:
        parsed = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def pm_entries(entries: list[dict]) -> list[dict]:
    """Entries whose id's NAME component is exactly `pm` (`pm@<marketplace>`).

    Split on "@" rather than prefix-matching: `pm-worktree@x` is a different plugin, and a
    prefix match would disable it.
    """
    return [e for e in entries if str(e.get("id", "")).split("@")[0] == "pm"]


def installed_pm_ids(entries: list[dict]) -> list[str]:
    """Ids of every ENABLED user-scope pm -- the ones a fixture must switch off.

    Computed, never hardcoded to `pm@cfdude-plugins`. A hardcoded id is correct until pm is
    installed from a differently named marketplace, at which point the disable silently misses
    and the run measures two plugins at once (two SessionStart hooks, two /pm: command sets).
    """
    return sorted(
        str(e["id"]) for e in pm_entries(entries)
        if e.get("enabled") and e.get("scope") == "user"
    )


def _fields_from_entries(entries: list[dict]) -> dict:
    """Identify the single enabled pm. All-None unless there is EXACTLY one.

    Zero and two are both wrong and both yield None, which is what lets one scorer assertion
    cover "nothing loaded", "the wrong one loaded", and "both loaded" without a count field.
    """
    enabled = [e for e in pm_entries(entries) if e.get("enabled")]
    if len(enabled) != 1:
        return {"plugin_id": None, "plugin_install_path": None, "plugin_version": None}
    only = enabled[0]
    return {
        "plugin_id": only.get("id"),
        "plugin_install_path": only.get("installPath"),
        "plugin_version": only.get("version"),
    }


def git_provenance() -> dict:
    """The worktree's commit and whether it has uncommitted changes.

    `plugin_dirty` is the field that matters later: running against uncommitted edits is the
    normal daily loop, but a BASELINE blessed from a dirty tree describes a state no commit
    reproduces. Recording it is what makes that visible.
    """
    def _git(args: list[str]) -> str | None:
        try:
            proc = subprocess.run(
                ["git", *args], cwd=str(REPO_ROOT),
                capture_output=True, text=True, timeout=TIMEOUT,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return proc.stdout if proc.returncode == 0 else None

    head = _git(["rev-parse", "HEAD"])
    status = _git(["status", "--porcelain"])
    return {
        "plugin_commit": head.strip() if head else None,
        "plugin_dirty": bool(status.strip()) if status is not None else None,
    }


def plugin_provenance(project: Path) -> dict:
    """The five provenance fields every observation carries."""
    return {**_fields_from_entries(plugin_list(project)), **git_provenance()}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd evals && uv run pytest tests/test_provenance.py -q`

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole Python suite**

Run: `cd evals && uv run pytest -q`

Expected: 33 passed (23 + 10).

- [ ] **Step 6: Commit**

```bash
git add evals/provenance.py evals/tests/test_provenance.py
git commit -m "test(evals): provenance module — parse plugin list --json once, for both the disable and the check"
```

---

### Task 2: Load the worktree, disable the installed pm

**Files:**
- Modify: `evals/runners.py` (the `subprocess.run` argv in `run_claude_code`)
- Modify: `evals/fixtures.py:15` (`REPO_ROOT`) and `_write_memory_isolation`'s `settings` dict
- Modify: `evals/tests/test_fixtures.py` (append)

**Interfaces:**
- Consumes: `provenance.REPO_ROOT`, `provenance.plugin_list`, `provenance.installed_pm_ids` from Task 1.
- Produces: fixtures whose `.claude/settings.local.json` contains an `enabledPlugins` object; runs that load `pm@inline`.

- [ ] **Step 1: Write the failing test**

Append to `evals/tests/test_fixtures.py`:

```python
def test_materialize_disables_every_enabled_user_scope_pm(tmp_path, monkeypatch):
    """The installed pm must be switched off, or --plugin-dir yields TWO active pm plugins:
    two SessionStart hooks, two /pm: command sets, two engines. Computed from the live
    listing, so a differently-named marketplace is still caught."""
    import fixtures
    import provenance

    monkeypatch.setattr(provenance, "plugin_list", lambda project: [
        {"id": "pm@cfdude-plugins", "scope": "user", "enabled": True, "version": "0.25.0", "installPath": "/x"},
        {"id": "pm@other", "scope": "user", "enabled": True, "version": "0.25.0", "installPath": "/y"},
        {"id": "pm@inline", "scope": "session", "enabled": True, "version": "0.25.0", "installPath": "/z"},
    ])

    project = fixtures.materialize("single-active-epic", tmp_path)
    settings = json.loads((project / ".claude" / "settings.local.json").read_text())

    assert settings["enabledPlugins"] == {"pm@cfdude-plugins": False, "pm@other": False}
    # session-scope pm@inline is the plugin under test — it must NOT be disabled
    assert "pm@inline" not in settings["enabledPlugins"]


def test_runner_argv_loads_the_worktree_plugin(monkeypatch, tmp_path):
    """--plugin-dir is a GLOBAL flag and must precede the -p subcommand form's arguments."""
    import runners
    import provenance

    captured = {}

    class _Proc:
        returncode = 0
        stdout = "{}"

    def _fake_run(argv, **kwargs):
        captured["argv"] = argv
        return _Proc()

    monkeypatch.setattr(runners.subprocess, "run", _fake_run)
    runners.run_claude_code("hi", tmp_path)

    argv = captured["argv"]
    assert "--plugin-dir" in argv, "the run must load the worktree, not the installed plugin"
    assert argv[argv.index("--plugin-dir") + 1] == str(provenance.REPO_ROOT)
```

Ensure `import json` is present at the top of `test_fixtures.py` (add it if absent).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd evals && uv run pytest tests/test_fixtures.py -q`

Expected: both new tests FAIL — the first with `KeyError: 'enabledPlugins'`, the second with `AssertionError: the run must load the worktree, not the installed plugin`.

- [ ] **Step 3: Add `--plugin-dir` to the runner**

In `evals/runners.py`, add the import at the top (after the existing imports):

```python
from provenance import REPO_ROOT
```

Then in `run_claude_code`, change the argv list from:

```python
        [
            "claude", "-p", prompt,
            "--allowedTools", allowed_tools,
            "--permission-mode", "acceptEdits",
            "--output-format", "json",
        ],
```

to:

```python
        [
            "claude", "-p", prompt,
            # The plugin under test is THIS worktree, not the copy installed in the operator's
            # user-scope settings. Without this the harness measured a different tree than the
            # one being edited, so editing an artifact changed nothing about the result.
            # `--plugin-dir` ADDS rather than replaces; fixtures.py disables the installed pm.
            "--plugin-dir", str(REPO_ROOT),
            "--allowedTools", allowed_tools,
            "--permission-mode", "acceptEdits",
            "--output-format", "json",
        ],
```

- [ ] **Step 4: Compute the disable in the fixture**

In `evals/fixtures.py`, replace line 15's definition:

```python
REPO_ROOT = Path(__file__).resolve().parent.parent
```

with an import (leave `ENGINE` as it is, defined from `REPO_ROOT`):

```python
from provenance import REPO_ROOT, installed_pm_ids, plugin_list
```

placed with the other imports, so `REPO_ROOT` has exactly one definition in `evals/`.

Then in `_write_memory_isolation`, extend the `settings` dict. Add this immediately before it:

```python
    # --plugin-dir ADDS the worktree plugin; it does not replace the installed one. Leaving the
    # installed pm enabled means two SessionStart hooks, two /pm: command sets and two engines
    # in the same session. Computed from the live listing rather than hardcoding
    # "pm@cfdude-plugins" -- a pm installed from a differently named marketplace must still be
    # switched off, and if this enumeration ever misses one, observe()'s plugin_id goes None and
    # the measured_the_worktree scorer FAILS rather than the run quietly measuring both.
    disabled_plugins = {pid: False for pid in installed_pm_ids(plugin_list(project))}
```

and add the key to the `settings` dict literal, after `"autoMemoryEnabled": False,`:

```python
        "enabledPlugins": disabled_plugins,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd evals && uv run pytest tests/test_fixtures.py tests/test_runners.py -q`

Expected: PASS.

- [ ] **Step 6: Run the whole Python suite**

Run: `cd evals && uv run pytest -q`

Expected: 35 passed (33 + 2).

- [ ] **Step 7: Commit**

```bash
git add evals/runners.py evals/fixtures.py evals/tests/test_fixtures.py
git commit -m "feat(evals): measure the worktree — --plugin-dir plus a computed disable of the installed pm"
```

---

### Task 3: Provenance in the observation

**Files:**
- Modify: `evals/observe.py` (imports and the `observe()` return dict)
- Modify: `evals/adapter.py` (`_failure()`'s dict)
- Modify: `evals/tests/test_observe.py` (append)

**Interfaces:**
- Consumes: `provenance.plugin_provenance(project) -> dict` from Task 1.
- Produces: every observation carries `plugin_id`, `plugin_install_path`, `plugin_version`, `plugin_commit`, `plugin_dirty`. Task 4's scorer reads `plugin_id` and `plugin_install_path`.

- [ ] **Step 1: Write the failing test**

Append to `evals/tests/test_observe.py`:

```python
def test_observe_carries_plugin_provenance(tmp_path, monkeypatch):
    """A baseline that does not say which artifact tree it described is not interpretable
    later. These five fields are what make a blessed baseline mean something."""
    import observe
    import provenance

    monkeypatch.setattr(provenance, "plugin_list", lambda project: [
        {"id": "pm@inline", "scope": "session", "enabled": True,
         "version": "0.25.0", "installPath": str(provenance.REPO_ROOT)},
    ])

    out = observe.observe(tmp_path)

    assert out["plugin_id"] == "pm@inline"
    assert out["plugin_install_path"] == str(provenance.REPO_ROOT)
    assert out["plugin_version"] == "0.25.0"
    assert isinstance(out["plugin_commit"], str)
    assert isinstance(out["plugin_dirty"], bool)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd evals && uv run pytest tests/test_observe.py -q`

Expected: FAIL with `KeyError: 'plugin_id'`.

- [ ] **Step 3: Add the fields to `observe()`**

In `evals/observe.py`, add to the imports:

```python
from provenance import plugin_provenance
```

and change the end of `observe()`'s returned dict from:

```python
        "project_md_present": (project / "PROJECT.md").exists(),
    }
```

to:

```python
        "project_md_present": (project / "PROJECT.md").exists(),
        # WHICH artifact tree this run measured. Without it a blessed baseline describes an
        # unidentified plugin: comparing against it three releases later compares against
        # something nobody can name. plugin_id is None unless exactly one pm was enabled, which
        # is how the double-load case becomes a scorer failure rather than a silent average of
        # two plugins.
        **plugin_provenance(project),
    }
```

- [ ] **Step 4: Keep the failure path shape-identical**

In `evals/adapter.py`, add the same five keys to `_failure()`'s returned dict, after `"project_md_present": False,`:

```python
        "plugin_id": None,
        "plugin_install_path": None,
        "plugin_version": None,
        "plugin_commit": None,
        "plugin_dirty": None,
```

This is not optional bookkeeping: `tests/test_adapter.py:88` asserts a failed run is key-identical to a successful one, because a scorer that raises `KeyError` cannot FAIL a broken run — it turns into an adapter exception, which the harness maps to INDETERMINATE and never classifies as a regression.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd evals && uv run pytest -q`

Expected: 36 passed (35 + 1), including the existing key-set invariant test in `tests/test_adapter.py`.

- [ ] **Step 6: Commit**

```bash
git add evals/observe.py evals/adapter.py evals/tests/test_observe.py
git commit -m "feat(evals): record which plugin tree an observation measured"
```

---

### Task 4: The scorer, and proof it can fail

**Files:**
- Modify: `evals/corpus.py` (append a scorer to `LANE_ROUTING_TYPO`'s `scorers` list)

**Interfaces:**
- Consumes: `plugin_id` and `plugin_install_path` from Task 3's observation.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the scorer**

In `evals/corpus.py`, add this import near the top (with the existing `from adapter import pm_adapter`):

```python
from provenance import REPO_ROOT
```

and append this entry to `LANE_ROUTING_TYPO`'s `scorers` list, immediately after the `run_succeeded` check (it belongs early — like `run_succeeded`, it guards against every later check passing vacuously, here by having measured the wrong code):

```python
        check(
            "measured_the_worktree",
            lambda o: o["plugin_id"] == "pm@inline"
            and o["plugin_install_path"] == str(REPO_ROOT),
            reason=(
                "The corpus measures the artifacts in THIS worktree. `claude -p` otherwise "
                "loads the separately-installed pm from user-scope settings, so editing a "
                "command doc changes nothing about the result -- the port loop this harness "
                "exists to support silently cannot work. plugin_id is None unless exactly one "
                "pm was enabled, so this one assertion also catches the double-load case "
                "(--plugin-dir ADDS; the installed pm must be disabled) and the stale-copy "
                "case (install path is whatever was passed to --plugin-dir)."
            ),
        ),
```

- [ ] **Step 2: Verify the scorer passes on a real run**

Run `cd evals && uv run pytest -q` first (expected: 36 passed), then one live scenario. The exact invocation, from `CONTRIBUTING.md:142` — `PYTHONPATH=.` is required or it fails immediately:

```bash
cd evals && PYTHONPATH=. uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 1
```

Expected: `measured_the_worktree` passes, and the run's observation shows `plugin_id: "pm@inline"` with `plugin_install_path` equal to the repo root. A live run costs one real `claude -p` invocation (~95 s); do not loop it.

- [ ] **Step 3: Prove failure mode 1 — no `--plugin-dir`**

Temporarily remove the two `--plugin-dir` argv entries from `evals/runners.py`, run one live scenario, and record the verbatim output.

Expected: `measured_the_worktree` FAILS with `plugin_id == "pm@cfdude-plugins"`.

Restore the lines and confirm `git diff evals/runners.py` is empty.

- [ ] **Step 4: Prove failure mode 2 — no disable**

Temporarily change `fixtures.py`'s `disabled_plugins` line to `disabled_plugins = {}`, run one live scenario, and record the verbatim output.

Expected: two pm entries enabled → `plugin_id is None` → `measured_the_worktree` FAILS.

Restore the line and confirm `git diff evals/fixtures.py` is empty.

- [ ] **Step 5: Prove failure mode 3 — stale copy**

Temporarily point `--plugin-dir` at a copy rather than the worktree:

```bash
rsync -a --exclude .git --exclude evals /Users/robsherman/Documents/Repos/pm/ /tmp/pm-stale/
```

and set the runner's `--plugin-dir` argument to `/tmp/pm-stale`, then run one live scenario with the Step 2 command.

Expected: `plugin_id == "pm@inline"` but `plugin_install_path == "/tmp/pm-stale"` → `measured_the_worktree` FAILS on the path comparison.

Restore the line, `rm -rf /tmp/pm-stale`, and confirm `git diff evals/runners.py` is empty.

- [ ] **Step 6: Full verification**

Run both suites:

```bash
cd evals && uv run pytest -q            # expect 36 passed
cd .. && node --test scripts/test/*.test.mjs   # expect 301 passed, untouched
```

The node run takes ~130 s; pass a Bash timeout of 300000 ms.

- [ ] **Step 7: Commit**

```bash
git add evals/corpus.py
git commit -m "feat(evals): scorer asserting the run measured the worktree, not the installed plugin"
```

---

## Done means

- `cd evals && uv run pytest` → 36 passed; `node --test scripts/test/*.test.mjs` → 301 passed.
- A live corpus run reports `plugin_id: "pm@inline"` and `plugin_install_path` equal to the repo root.
- All three failure modes demonstrated with recorded output and then reverted — not asserted.
- No engine file touched, no new dependency, no version bump.
- **The existing `evals/.edd/baseline.json` is now stale by construction** — every check in it was blessed against the installed plugin. Re-bless with a provenance label (`bless(..., label="pm <version> @ <sha>")`) before trusting the next comparison. This is an operator action, deliberately not automated here.
