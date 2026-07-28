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
