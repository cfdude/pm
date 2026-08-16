"""The single domain seam.

edd-harness never imports pm; it only sees the dict this returns. The engine
is invoked and observed, never imported.
"""

from __future__ import annotations

import tempfile
import traceback
from pathlib import Path

from fixtures import materialize
from observe import observe
from runners import RUNNERS

# Sentinel exit code for an INFRASTRUCTURAL failure -- `claude` not on PATH, the
# run exceeding its timeout, `node`/the pm engine erroring during fixture
# materialization, or a corrupted state.json breaking the post-run observation.
#
# Why swallow rather than propagate: edd-harness maps any adapter exception to
# INDETERMINATE, and compare.py never classifies INDETERMINATE as a regression --
# so a propagated infra failure would exit 0 and report success from a totally
# broken harness. Returning a well-formed dict with exit_code == -1 lets the
# corpus's `run_succeeded` scorer FAIL loudly instead.
INFRA_FAILURE_EXIT_CODE = -1


def _workdir() -> Path:
    """Overridden in tests. A fresh temp dir per invocation keeps runs isolated."""
    return Path(tempfile.mkdtemp(prefix="pm-eval-"))


def _failure(error: str) -> dict:
    """A harness-failure observation.

    MUST carry the same key set as a successful run so scorers never KeyError
    on a broken run -- they need to evaluate (and fail) rather than raise.
    """
    return {
        "active": None,
        "epics": [],
        "epic_ids": [],
        "detours": [],
        "rules_block_present": False,
        "rules_block_file": None,
        "user_memory_files_loaded": [],
        "project_md_present": False,
        "plugin_id": None,
        "plugin_install_path": None,
        "plugin_version": None,
        "plugin_commit": None,
        "plugin_dirty": None,
        "new_epics": [],
        "exit_code": INFRA_FAILURE_EXIT_CODE,
        "duration_ms": None,
        "num_turns": None,
        "total_cost_usd": None,
        "error": error,
    }


def pm_adapter(scenario_input: dict) -> dict:
    seed = scenario_input["seed"]
    prompt = scenario_input["prompt"]
    platform = scenario_input["platform"]
    allowed_tools = scenario_input.get("allowed_tools", "Bash")

    # NOT inside the guard below: an unknown platform is a corpus-authoring bug,
    # not an infrastructural failure. Under pytest this raises straight into the
    # test failure, in the author's face. Under `edd run` it still propagates
    # out of pm_adapter -- which edd_harness maps to all-INDETERMINATE, i.e. the
    # same silent exit-0 as any other uncaught adapter exception (see
    # INFRA_FAILURE_EXIT_CODE above). We accept that tradeoff here because the
    # platform is a hardcoded literal set in corpus.py, not runtime input: a
    # typo is caught immediately by the very first run's verdict counts, so the
    # window for it to hide silently is one run, not indefinite.
    if platform not in RUNNERS:
        raise KeyError(f"unknown platform {platform!r}; known: {sorted(RUNNERS)}")

    try:
        project = materialize(seed, _workdir())
        before = set(observe(project)["epic_ids"])

        result = RUNNERS[platform](prompt, project, allowed_tools=allowed_tools)

        after = observe(project)

        after["new_epics"] = [e for e in after["epics"] if e["id"] not in before]
        after["exit_code"] = result["exit_code"]
        after["duration_ms"] = result["duration_ms"]
        after["num_turns"] = result["num_turns"]
        # NOTIONAL under Claude subscription auth: an equivalent-API estimate, not
        # billed spend. Only a real API key makes this actual money.
        after["total_cost_usd"] = result["total_cost_usd"]
        after["error"] = None
        return after
    except Exception:  # noqa: BLE001 -- deliberate: see INFRA_FAILURE_EXIT_CODE
        # Keep the diagnostic. A failing run that can't be explained is worse
        # than no run at all.
        return _failure(traceback.format_exc().strip())
