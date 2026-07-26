# EDD Harness for Agent Behavior Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an evaluation-driven-development corpus inside the pm repo that measures whether pm's *agent-facing artifacts* (command docs, skills, rules block, hooks) produce the intended agent behavior — and can prove the same on a second platform later.

**Architecture:** A self-contained Python project at `evals/` depends on the external `edd-harness` library. Its single domain seam is an adapter that (1) materializes a throwaway pm project from a named fixture seed using the real engine, (2) runs a headless agent session against it, (3) reads back `.conductor` state as a plain JSON dict. Scorers then assert *desired behavior* on that dict. pm's Node engine is never imported, never modified — only invoked and observed.

**Tech Stack:** Python 3.13 + `uv` + `pytest` (evals only) · `edd-harness` · `claude -p` as the first runner · Ollama for judge scorers.

## Global Constraints

- **`scripts/conductor.mjs` and `scripts/lib/*.mjs` are NEVER modified by this epic.** The engine is zero-dependency Node 18+ built-ins; never add an npm package or `package.json` dependency.
- **`node --test scripts/conductor.test.mjs` must stay green (250 tests).** The `.githooks/pre-commit` hook runs it and blocks any failing commit. Never use `--no-verify`.
- **Nothing in `evals/` may be referenced from `.claude-plugin/plugin.json`.** It ships inert, like `docs/` and `openspec/`.
- **All Python lives under `evals/`** — including `pyproject.toml` and `.edd/`. pm's repo root stays a Node project with no `pyproject.toml`.
- **Scorers assert desired behavior absolutely.** Never score by diffing one platform against another; two platforms failing identically is parity but still broken.
- **Prefer deterministic `check()` over `JudgeScorer`.** Judges cost money, add variance, and land on edd-harness's *advisory* gate rather than its blocking one.
- **Judge model must differ from the model under test.** Local Ollama models confirmed present: `gemma4:e4b`, `nemotron-3-nano:4b`.
- **A headless run costs ~90s wall-clock (measured).** Keep `samples` modest; EDD is a deliberate gate, never a per-commit hook.
- Conventional commits (`feat|fix|docs|test|chore|refactor`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `evals/pyproject.toml` | Python project + `edd-harness` dependency. Keeps Python out of the repo root. |
| `evals/fixtures.py` | Materialize a throwaway pm project from a named seed, using the real engine CLI. |
| `evals/observe.py` | Read `.conductor` state + `CLAUDE.md` back into a plain JSON dict. |
| `evals/runners.py` | Per-platform headless invocation. `claude -p` today; `codex exec` later. |
| `evals/adapter.py` | The single domain seam — composes fixtures → runner → observe. |
| `evals/corpus.py` | `SCENARIOS`: the scenario definitions and their scorers. |
| `evals/tests/` | pytest unit tests for the eval code itself (no agent calls). |
| `evals/.edd/baseline.json` | Blessed baseline — committed; its diff is the drift review. |
| `CONTRIBUTING.md` | Gains the repeatable EDD setup procedure. |
| `.gitignore` | Ignores `evals/.edd/runs/`, `evals/.venv/`, `__pycache__`. |

**Why `evals/` is a flat module set, not a nested package:** `edd` is invoked from inside `evals/`, so the spec is simply `corpus:SCENARIOS`. No package nesting, no `sys.path` juggling.

---

### Task 1: Scaffold `evals/` and prove the harness imports

**Files:**
- Create: `evals/pyproject.toml`, `evals/tests/test_smoke.py`, `evals/.gitignore`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Produces: a working `uv` project in `evals/` where `from edd_harness import Scenario, check, run` succeeds. Every later task runs its tests with `cd evals && uv run pytest`.

- [ ] **Step 1: Write the failing test**

Create `evals/tests/test_smoke.py`:

```python
"""The harness must be importable before anything else is worth building."""


def test_edd_harness_public_api_is_importable():
    from edd_harness import JudgeScorer, Scenario, bless, check, compare_run, run, write_run

    assert callable(check)
    assert callable(run)
    assert callable(bless)
    assert callable(write_run)
    assert callable(compare_run)
    assert Scenario is not None
    assert JudgeScorer is not None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd evals && uv run pytest tests/test_smoke.py -v`
Expected: FAIL — no `pyproject.toml` yet, so `uv run` errors out.

- [ ] **Step 3: Create the project files**

Create `evals/pyproject.toml`:

```toml
[project]
name = "pm-evals"
version = "0.1.0"
description = "EDD corpus for the pm plugin's agent-facing artifacts. Not shipped as part of the plugin."
requires-python = ">=3.13"
dependencies = [
    "edd-harness",
]

[dependency-groups]
dev = [
    "pytest>=8",
]

[tool.uv.sources]
edd-harness = { path = "../../edd-harness", editable = true }

[tool.pytest.ini_options]
testpaths = ["tests"]
```

> **Note on `[tool.uv.sources]`:** this points at the sibling local clone so development tracks the harness directly. If `edd-harness` is published to PyPI, delete that block and the plain `dependencies` entry resolves normally. Record whichever is true in `CONTRIBUTING.md` (Task 7).

Create `evals/.gitignore`:

```
.venv/
.edd/runs/
__pycache__/
.pytest_cache/
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd evals && uv sync && uv run pytest tests/test_smoke.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Confirm the Node suite is untouched**

Run: `node --test scripts/conductor.test.mjs 2>&1 | tail -5`
Expected: `pass 250`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add evals/pyproject.toml evals/.gitignore evals/tests/test_smoke.py evals/uv.lock
git commit -m "feat(evals): scaffold the EDD Python project

Self-contained under evals/ so pm's repo root stays a Node project
with no pyproject.toml. Nothing here is referenced by
.claude-plugin/plugin.json -- it ships inert like docs/ and openspec/."
```

---

### Task 2: Fixture materialization

**Files:**
- Create: `evals/fixtures.py`, `evals/tests/test_fixtures.py`

**Interfaces:**
- Produces:
  - `SEEDS: dict[str, dict]` — named fixture definitions.
  - `materialize(seed_name: str, workdir: Path) -> Path` — builds a pm-initialized project in `workdir`, returns the project path.
- Consumes: nothing from earlier tasks.

**Why the real engine, not a hand-written `state.json`:** a fixture built by `conductor.mjs` is guaranteed schema-correct and stays correct through future migrations. Hand-writing state would silently rot.

- [ ] **Step 1: Write the failing test**

Create `evals/tests/test_fixtures.py`:

```python
import json
from pathlib import Path

from fixtures import SEEDS, materialize


def test_single_active_epic_seed_materializes(tmp_path: Path):
    project = materialize("single-active-epic", tmp_path)

    state = json.loads((project / ".conductor" / "state.json").read_text())

    assert state["active"] == "canary-active"
    ids = {e["id"] for e in state["epics"]}
    assert "canary-active" in ids
    assert (project / "CLAUDE.md").exists(), "init must write the managed rules block"


def test_seeds_are_declared():
    assert "single-active-epic" in SEEDS
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd evals && uv run pytest tests/test_fixtures.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fixtures'`.

- [ ] **Step 3: Implement `evals/fixtures.py`**

```python
"""Materialize throwaway pm projects for evaluation.

Fixtures are built by invoking the REAL engine CLI, never by hand-writing
state.json -- so a fixture is schema-correct by construction and survives
future migrations.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE = REPO_ROOT / "scripts" / "conductor.mjs"

# Each seed is a list of engine invocations applied after `init`.
SEEDS: dict[str, dict] = {
    "single-active-epic": {
        "description": "One active P0 epic. The baseline shape for most scenarios.",
        "commands": [
            [
                "add-epic",
                "--id", "canary-active",
                "--lane", "claude-code",
                "--priority", "P0",
                "--status", "active",
                "--title", "Canary active epic for evaluation fixtures",
            ],
        ],
    },
    "reconcile-owed": {
        "description": (
            "An active epic that owes a reconcile, so the gate-guard PreToolUse hook "
            "should block edits."
        ),
        "commands": [
            [
                "add-epic",
                "--id", "paused-work",
                "--lane", "openspec",
                "--priority", "P1",
                "--status", "active",
                "--title", "Epic that owes a reconcile after a detour",
            ],
        ],
    },
}


def _engine(project: Path, args: list[str]) -> str:
    """Run the pm engine against `project`, returning stderr+stdout for diagnostics."""
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(project), "PM_QUIET_ENGINE_BANNER": "1"}
    proc = subprocess.run(
        ["node", str(ENGINE), *args],
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"engine {args!r} failed: {proc.stderr.strip()}")
    return proc.stdout + proc.stderr


def materialize(seed_name: str, workdir: Path) -> Path:
    """Build a pm-initialized project for `seed_name` inside `workdir`."""
    if seed_name not in SEEDS:
        raise KeyError(f"unknown seed {seed_name!r}; known: {sorted(SEEDS)}")

    project = Path(workdir) / "project"
    project.mkdir(parents=True, exist_ok=True)

    _engine(project, ["init"])
    for command in SEEDS[seed_name]["commands"]:
        _engine(project, command)

    return project
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd evals && uv run pytest tests/test_fixtures.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add evals/fixtures.py evals/tests/test_fixtures.py
git commit -m "feat(evals): materialize fixtures via the real engine CLI

Fixtures are built by invoking conductor.mjs rather than hand-writing
state.json, so they are schema-correct by construction and survive
future migrations."
```

---

### Task 3: Observation — read `.conductor` state back as JSON

**Files:**
- Create: `evals/observe.py`, `evals/tests/test_observe.py`

**Interfaces:**
- Consumes: `materialize()` from Task 2.
- Produces: `observe(project: Path) -> dict` returning exactly these keys:
  - `active: str | None`
  - `epics: list[dict]` — each `{id, lane, priority, status, reconcileNeeded}`
  - `epic_ids: list[str]`
  - `detours: list[dict]` — each `{kind, epic, note}` parsed from `detours.log`
  - `rules_block_present: bool`
  - `project_md_present: bool`

- [ ] **Step 1: Write the failing test**

Create `evals/tests/test_observe.py`:

```python
from pathlib import Path

from fixtures import materialize
from observe import observe


def test_observe_reports_active_and_epics(tmp_path: Path):
    project = materialize("single-active-epic", tmp_path)

    out = observe(project)

    assert out["active"] == "canary-active"
    assert "canary-active" in out["epic_ids"]
    assert out["rules_block_present"] is True
    assert out["project_md_present"] is True
    assert out["detours"] == []


def test_observe_is_json_serializable(tmp_path: Path):
    import json

    project = materialize("single-active-epic", tmp_path)
    json.dumps(observe(project))  # must not raise
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd evals && uv run pytest tests/test_observe.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'observe'`.

- [ ] **Step 3: Implement `evals/observe.py`**

```python
"""Read a pm project's observable state back as a plain JSON dict.

This is the answer key surface: a correctly-followed instruction leaves
deterministic traces on disk, so scorers assert on THIS rather than on the
agent's prose.
"""

from __future__ import annotations

import json
from pathlib import Path

RULES_BEGIN = "<!-- BEGIN pm-conductor rules"


def _read_detours(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        rows.append({"kind": parts[2], "epic": parts[3], "note": parts[4] if len(parts) > 4 else ""})
    return rows


def observe(project: Path) -> dict:
    project = Path(project)
    state_path = project / ".conductor" / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}

    epics = [
        {
            "id": e.get("id"),
            "lane": e.get("lane"),
            "priority": e.get("priority"),
            "status": e.get("status"),
            "reconcileNeeded": bool(e.get("reconcileNeeded", False)),
        }
        for e in state.get("epics", [])
    ]

    claude_md = project / "CLAUDE.md"

    return {
        "active": state.get("active"),
        "epics": epics,
        "epic_ids": [e["id"] for e in epics],
        "detours": _read_detours(project / ".conductor" / "detours.log"),
        "rules_block_present": claude_md.exists() and RULES_BEGIN in claude_md.read_text(),
        "project_md_present": (project / "PROJECT.md").exists(),
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd evals && uv run pytest tests/test_observe.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add evals/observe.py evals/tests/test_observe.py
git commit -m "feat(evals): observe .conductor state as a JSON answer key"
```

---

### Task 4: Platform runners

**Files:**
- Create: `evals/runners.py`, `evals/tests/test_runners.py`

**Interfaces:**
- Produces:
  - `RUNNERS: dict[str, Callable]` keyed by platform name (`"claude-code"` today).
  - `run_claude_code(prompt: str, cwd: Path, allowed_tools: str = "Bash", timeout: int = 300) -> dict` returning `{"exit_code": int, "stdout": str, "duration_ms": int | None, "num_turns": int | None, "total_cost_usd": float | None}`.

**Empirically established:** `claude -p` fires plugin hooks (including `SessionStart` context injection) in an arbitrary directory. `--output-format json` carries the run metrics. Under subscription auth `total_cost_usd` is **notional**, not billed spend.

- [ ] **Step 1: Write the failing test**

Create `evals/tests/test_runners.py`:

```python
"""Unit tests for the runner layer. These must NOT invoke a real agent --
agent invocation is exercised by the corpus, not by pytest."""

import json

import runners


def test_claude_code_is_registered():
    assert "claude-code" in runners.RUNNERS


def test_parses_metrics_from_output_format_json():
    payload = json.dumps(
        {"result": "ok", "duration_ms": 90406, "num_turns": 7, "total_cost_usd": 0.42}
    )

    parsed = runners._parse_result(payload)

    assert parsed["duration_ms"] == 90406
    assert parsed["num_turns"] == 7
    assert parsed["total_cost_usd"] == 0.42


def test_parse_result_survives_non_json_output():
    parsed = runners._parse_result("not json at all")

    assert parsed["duration_ms"] is None
    assert parsed["num_turns"] is None
    assert parsed["total_cost_usd"] is None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd evals && uv run pytest tests/test_runners.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'runners'`.

- [ ] **Step 3: Implement `evals/runners.py`**

```python
"""Headless invocation, one function per platform.

Each runner takes a prompt and a working directory and returns a plain dict.
Adding a platform means adding a function here and a RUNNERS entry -- the
corpus and scorers stay untouched.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


def _parse_result(stdout: str) -> dict:
    """Pull run metrics out of --output-format json, tolerating non-JSON output."""
    try:
        payload = json.loads(stdout)
    except (json.JSONDecodeError, TypeError):
        return {"duration_ms": None, "num_turns": None, "total_cost_usd": None}
    return {
        "duration_ms": payload.get("duration_ms"),
        "num_turns": payload.get("num_turns"),
        "total_cost_usd": payload.get("total_cost_usd"),
    }


def run_claude_code(
    prompt: str,
    cwd: Path,
    allowed_tools: str = "Bash",
    timeout: int = 300,
) -> dict:
    proc = subprocess.run(
        [
            "claude", "-p", prompt,
            "--allowedTools", allowed_tools,
            "--permission-mode", "acceptEdits",
            "--output-format", "json",
        ],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return {
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        **_parse_result(proc.stdout),
    }


RUNNERS = {
    "claude-code": run_claude_code,
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd evals && uv run pytest tests/test_runners.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add evals/runners.py evals/tests/test_runners.py
git commit -m "feat(evals): per-platform headless runners

Adding a platform is a function plus a RUNNERS entry; the corpus and
scorers never change. Metrics parsing tolerates non-JSON output so a
malformed run degrades rather than crashing the suite."
```

---

### Task 5: The adapter — the single domain seam

**Files:**
- Create: `evals/adapter.py`, `evals/tests/test_adapter.py`

**Interfaces:**
- Consumes: `materialize()` (Task 2), `observe()` (Task 3), `RUNNERS` (Task 4).
- Produces: `pm_adapter(scenario_input: dict) -> dict`.
  - `scenario_input` keys: `seed: str`, `prompt: str`, `platform: str`, optional `allowed_tools: str`.
  - Returns the `observe()` dict plus: `new_epics: list[dict]` (epics absent from the seed), `exit_code`, `duration_ms`, `num_turns`, `total_cost_usd`.

**`new_epics` is computed here, not in scorers,** so every scenario asserting "the agent registered something" shares one definition of what "new" means.

- [ ] **Step 1: Write the failing test**

Create `evals/tests/test_adapter.py`:

```python
"""The adapter is tested with a stub runner. Real agent invocation belongs to
the corpus, not to pytest -- a unit test must never cost 90 seconds."""

from pathlib import Path

import adapter


def test_adapter_reports_new_epics_against_the_seed(tmp_path, monkeypatch):
    def stub_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
        # Simulate the agent registering an epic by invoking the real engine.
        from fixtures import _engine

        _engine(
            Path(cwd),
            ["add-epic", "--id", "agent-made-this", "--lane", "claude-code",
             "--priority", "P3", "--title", "Created by the stub runner"],
        )
        return {"exit_code": 0, "stdout": "{}", "duration_ms": 1,
                "num_turns": 1, "total_cost_usd": 0.0}

    monkeypatch.setitem(adapter.RUNNERS, "stub", stub_runner)
    monkeypatch.setattr(adapter, "_workdir", lambda: tmp_path)

    out = adapter.pm_adapter(
        {"seed": "single-active-epic", "prompt": "irrelevant", "platform": "stub"}
    )

    assert [e["id"] for e in out["new_epics"]] == ["agent-made-this"]
    assert out["active"] == "canary-active", "the seed's active epic must be untouched"
    assert out["exit_code"] == 0


def test_adapter_rejects_unknown_platform(tmp_path, monkeypatch):
    monkeypatch.setattr(adapter, "_workdir", lambda: tmp_path)

    try:
        adapter.pm_adapter({"seed": "single-active-epic", "prompt": "x", "platform": "nope"})
    except KeyError as exc:
        assert "nope" in str(exc)
    else:
        raise AssertionError("expected KeyError for an unknown platform")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd evals && uv run pytest tests/test_adapter.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'adapter'`.

- [ ] **Step 3: Implement `evals/adapter.py`**

```python
"""The single domain seam.

edd-harness never imports pm; it only sees the dict this returns. The engine
is invoked and observed, never imported.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fixtures import materialize
from observe import observe
from runners import RUNNERS


def _workdir() -> Path:
    """Overridden in tests. A fresh temp dir per invocation keeps runs isolated."""
    return Path(tempfile.mkdtemp(prefix="pm-eval-"))


def pm_adapter(scenario_input: dict) -> dict:
    seed = scenario_input["seed"]
    prompt = scenario_input["prompt"]
    platform = scenario_input["platform"]
    allowed_tools = scenario_input.get("allowed_tools", "Bash")

    if platform not in RUNNERS:
        raise KeyError(f"unknown platform {platform!r}; known: {sorted(RUNNERS)}")

    project = materialize(seed, _workdir())
    before = set(observe(project)["epic_ids"])

    result = RUNNERS[platform](prompt, project, allowed_tools=allowed_tools)

    after = observe(project)
    after["new_epics"] = [e for e in after["epics"] if e["id"] not in before]
    after["exit_code"] = result["exit_code"]
    after["duration_ms"] = result["duration_ms"]
    after["num_turns"] = result["num_turns"]
    after["total_cost_usd"] = result["total_cost_usd"]
    return after
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd evals && uv run pytest tests/test_adapter.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole unit suite**

Run: `cd evals && uv run pytest -v`
Expected: PASS (9 tests), and the whole run finishes in seconds — no agent was invoked.

- [ ] **Step 6: Commit**

```bash
git add evals/adapter.py evals/tests/test_adapter.py
git commit -m "feat(evals): the adapter seam (fixture -> runner -> observe)

Computes new_epics centrally so every scenario shares one definition of
'new'. Unit-tested with a stub runner -- a unit test must never cost a
90-second agent call."
```

---

### Task 6: First real scenario — lane routing

**Files:**
- Create: `evals/corpus.py`

**Interfaces:**
- Consumes: `pm_adapter` (Task 5).
- Produces: `SCENARIOS: list[Scenario]` — the `module:attr` target `corpus:SCENARIOS`.

**This scenario is already known to pass** — it was executed manually during design and produced epic `readme-typo-fix` with lane `claude-code`. Encoding it makes that repeatable and measurable.

- [ ] **Step 1: Create `evals/corpus.py`**

```python
"""The evaluation corpus.

Every scorer asserts DESIRED behavior, never one platform against another:
two platforms failing identically is parity but still broken. Parity means
every supported platform passes this same corpus.

Scorers are deterministic check() wherever the behavior is observable in
.conductor state -- which is almost always, because the engine is the
instrumentation.
"""

from __future__ import annotations

from edd_harness import Scenario, check

from adapter import pm_adapter

ENGINE_HINT = (
    "Use the pm engine at ../../scripts/conductor.mjs relative to the pm repo, "
    "or the installed pm plugin's commands."
)

LANE_ROUTING_TYPO = Scenario(
    id="lane-routing/typo-fix-is-claude-code",
    input={
        "seed": "single-active-epic",
        "platform": "claude-code",
        "prompt": (
            "A one-word typo needs fixing in README.md. Register that work as an epic "
            "in the pm conductor. Choose the lane yourself per pm's routing heuristic. "
            "Do not start the fix; registration only."
        ),
    },
    adapter=pm_adapter,
    samples=3,
    tags=("lane-routing", "deterministic"),
    scorers=[
        check(
            "registered_exactly_one_epic",
            lambda o: len(o["new_epics"]) == 1,
            reason="The agent should register the work as a single epic.",
        ),
        check(
            "chose_claude_code_lane",
            lambda o: o["new_epics"][0]["lane"] == "claude-code" if o["new_epics"] else False,
            reason="A <2h single-file tweak routes to claude-code, not openspec/superpowers.",
        ),
        check(
            "left_active_epic_untouched",
            lambda o: o["active"] == "canary-active",
            reason="Registering new work must not steal the active pointer.",
        ),
        check(
            "logged_no_spurious_detour",
            lambda o: o["detours"] == [],
            reason="Registering an epic is not a detour; the detour trail should stay empty.",
        ),
    ],
)

SCENARIOS = [LANE_ROUTING_TYPO]
```

- [ ] **Step 2: Verify the corpus loads without invoking an agent**

Run:
```bash
cd evals && uv run python -c "
from edd_harness import load_suite
s = load_suite('corpus:SCENARIOS')
print(f'{len(s)} scenario(s)')
for sc in s: print(' ', sc.id, '| scorers:', len(sc.scorers), '| samples:', sc.samples)
"
```
Expected: `1 scenario(s)` and the scorer/sample counts printed. This catches import and construction errors for free.

- [ ] **Step 3: Run the scenario for real, deterministic scorers only**

Run: `cd evals && uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 1`

Expected: the run completes in roughly 90–120s and all four checks pass. If `chose_claude_code_lane` fails, do **not** weaken the scorer — that is a real finding about pm's lane-routing instructions and should be reported, not scored away.

- [ ] **Step 4: Commit**

```bash
git add evals/corpus.py
git commit -m "feat(evals): first scenario -- lane routing for a trivial tweak

Encodes a behavior verified manually during design (a typo fix routes to
claude-code). Four deterministic checks: one epic registered, correct
lane, active pointer untouched, no spurious detour logged."
```

---

### Task 7: Bless the Claude Code baseline and document setup

**Files:**
- Create: `evals/.edd/baseline.json` (generated, committed)
- Modify: `CONTRIBUTING.md`, `.gitignore` (repo root)

**Interfaces:**
- Consumes: everything above.
- Produces: a committed baseline that later platform runs are measured against, plus the contributor procedure.

**Why the baseline is committed:** its git diff *is* the drift review. A silent behavior change shows up as a reviewable diff instead of a surprise.

- [ ] **Step 1: Produce a run and bless it**

Run:
```bash
cd evals
uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 3
uv run edd bless .edd/runs/<the-run-file>.jsonl --label clean
```

Expected: `.edd/baseline.json` is created. Three samples at ~90s each means this step takes roughly 4–5 minutes — that is expected, not a hang.

- [ ] **Step 2: Verify the gate actually gates**

Run: `cd evals && uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 1 --baseline`

Expected: exits 0 with no blocking regression. This proves the gate is wired, not merely that a run happened.

- [ ] **Step 3: Add the root `.gitignore` entries**

Append to the repo-root `.gitignore`:

```
evals/.venv/
evals/.edd/runs/
evals/__pycache__/
evals/.pytest_cache/
```

- [ ] **Step 4: Add the CONTRIBUTING.md section**

Insert before the `## What you inherit when you fork this repo` heading:

```markdown
## Running the EDD evaluation corpus (optional)

pm's engine is covered by `node --test scripts/conductor.test.mjs`. That suite cannot cover
pm's *agent-facing* artifacts — command docs, skills, the rules block, hooks — because their
correctness is a non-deterministic judgment made by an agent, not an assertable return value.
Those are covered by an evaluation corpus under `evals/`, built on
[`edd-harness`](https://github.com/cfdude/edd-harness).

**This setup is optional.** You only need it if you are changing an artifact the corpus
evaluates. Contributors touching only the engine, docs, or tests can skip it entirely.

### One-time setup

```bash
# 1. Python 3.13 + uv (Homebrew: brew install uv)
uv --version

# 2. Install the corpus's dependencies
cd evals && uv sync
```

`evals/pyproject.toml` resolves `edd-harness` from a sibling checkout via
`[tool.uv.sources]`. Clone it next to this repo:

```bash
git clone https://github.com/cfdude/edd-harness ../../edd-harness
```

### Judge backend (only for judge scorers)

Most scorers are deterministic — they assert on `.conductor` state, so they need no LLM. Only
`JudgeScorer`s do. If you are running those, start a local Ollama server:

```bash
ollama serve
```

The judge model **must differ from the model under test**, so a model never grades its own
homework. Local models are the flat-cost default; never point the judge at a metered API key.

### Running

```bash
cd evals
uv run pytest                                                    # fast unit tests, no agent calls
uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 1   # one real run
uv run edd run corpus:SCENARIOS --model pm@claude-code --baseline               # gate vs baseline
```

**Each scenario sample costs roughly 90 seconds of wall-clock**, because it spawns a real
headless agent session. Use `--samples 1` and `--tags` while iterating. This is why EDD is a
deliberate gate rather than a pre-commit hook.

### Blessing a new baseline

`evals/.edd/baseline.json` is committed on purpose — its diff is the drift review. Re-bless
only when a behavior change is *intended*, and say why in the commit message:

```bash
uv run edd bless .edd/runs/<run>.jsonl --label "<why this is the new expected behavior>"
```
```

- [ ] **Step 5: Verify the Node suite is still green**

Run: `node --test scripts/conductor.test.mjs 2>&1 | tail -5`
Expected: `pass 250`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add evals/.edd/baseline.json CONTRIBUTING.md .gitignore
git commit -m "feat(evals): bless the Claude Code baseline; document setup

The baseline is committed deliberately -- its diff is the drift review,
so a silent behavior change becomes a reviewable diff. CONTRIBUTING.md
gains the repeatable setup procedure, since edd-harness is a separate
Python project while pm itself needs only Node."
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `evals/` in-repo, not shipped | 1 (scaffold + no plugin.json reference) |
| Adapter is the single domain seam | 5 |
| Engine invoked/observed, never imported | 2, 3 (subprocess + file reads only) |
| Observable = `.conductor` state | 3 |
| Deterministic `check()` preferred over judges | 6 (all four scorers deterministic) |
| Scorers assert desired behavior, not platform diffs | 6 (absolute assertions; noted in module docstring) |
| Blessed Claude Code baseline | 7 |
| Judge ≠ model under test | 7 (CONTRIBUTING section) |
| CONTRIBUTING.md setup procedure | 7 |
| Not a per-commit gate | 7 (documented with the measured ~90s cost) |
| Platform-parameterized for a second runner | 4 (`RUNNERS` dict), 6 (`platform` in scenario input) |
| pm's Node engine untouched | Global Constraints; verified in Tasks 1 and 7 |

**Deliberately deferred, not forgotten:**

- **`reconcile-owed` seed is defined (Task 2) but has no scenario yet.** It exists so the
  gate-guard scenario in a follow-up has a fixture ready. Adding scenarios is additive to
  `corpus.py` and needs no structural change — which is the point of stopping at one.
- **No `JudgeScorer` in the initial corpus.** Every behavior targeted so far is observable in
  state, so a judge would add cost and variance for nothing. Add one only when a genuinely
  unassertable behavior needs scoring.
- **No Codex runner.** `codex exec` is confirmed present, but pm is not installable as a Codex
  plugin until `codex-platform-support`. Adding it is one function plus one `RUNNERS` entry.

**Placeholder scan:** clean — no TBD/TODO, every code step carries complete runnable content,
and the one templated value (the run filename in Task 7 Step 1) is produced by the immediately
preceding command.

**Type consistency:** `observe()`'s six keys (Task 3) are the exact keys the adapter extends
(Task 5) and the scorers read (Task 6). `_engine()` is defined in Task 2 and reused by the
Task 5 stub. `RUNNERS` keys (Task 4) match the `platform` values in scenario input (Task 6).
`_parse_result()`'s three metric keys (Task 4) match what the adapter copies through (Task 5).
