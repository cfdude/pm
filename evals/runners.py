"""Headless invocation, one function per platform.

Each runner takes a prompt and a working directory and returns a plain dict.
Adding a platform means adding a function here and a RUNNERS entry -- the
corpus and scorers stay untouched.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from provenance import REPO_ROOT


def _child_env() -> dict[str, str]:
    """Environment for every spawned agent session.

    HONCHO_ENABLED=false: honcho is a *user-scope* Claude Code plugin, so each headless
    session this harness spawns would otherwise write machine-generated eval text into the
    maintainer's personal memory workspace -- content with no value to a human reader, and
    the overwhelming majority of sessions on the machine. `false` is the plugin's hard off
    switch (isPluginEnabled() returns false and every hook exits before doing any work).

    It is a per-invocation runtime override that the plugin deliberately never persists to
    its config file, so interactive work in this same repo keeps honcho ON.

    Set here rather than at the call site so that a platform runner added later (hermes,
    codex) inherits it by construction instead of having to remember. Nested processes --
    a session that shells out, a worktree child -- inherit it the normal way.
    """
    return {**os.environ, "HONCHO_ENABLED": "false"}


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
    # The plugin under test is THIS worktree, not the copy installed in the operator's
    # user-scope settings. Without this the harness measures a different tree than the one
    # being edited, so editing an artifact changes nothing about the result. `--plugin-dir`
    # ADDS rather than replaces; fixtures.py disables the installed pm.
    #
    # Captured to a local so it can be reported back below -- the post-run observation must
    # REPLAY this exact value rather than re-deriving its own from REPO_ROOT (that decoupling
    # was the Task 4/5 defect: a diagnostic re-query that ignores what this argv actually used).
    plugin_dir = str(REPO_ROOT)
    # TimeoutExpired CARRIES the partial transcript in e.stdout/e.stderr, and letting it
    # propagate discarded both — the adapter's bare except turns it into a sentinel with empty
    # strings. INFRA_FAILURE_EXIT_CODE's own docstring names a timeout as an expected failure, and
    # a timed-out run is exactly the one whose partial output explains what the agent was doing
    # when it hung. Caught here rather than in the adapter: the adapter cannot recover what this
    # frame already holds.
    try:
        proc = subprocess.run(
            [
                "claude", "-p", prompt,
                "--plugin-dir", plugin_dir,
                "--allowedTools", allowed_tools,
                "--permission-mode", "acceptEdits",
                "--output-format", "json",
            ],
            cwd=str(cwd),
            env=_child_env(),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        # Decoded defensively: with text=True these are str, but a runner added later that omits
        # it would hand back bytes, and a diagnostic path must not raise while reporting a failure.
        def _text(v):
            if v is None:
                return ""
            return v if isinstance(v, str) else v.decode("utf-8", "replace")
        return {
            "exit_code": -1,
            "stdout": _text(e.stdout),
            "stderr": _text(e.stderr) + f"\n[timed out after {timeout}s]",
            "plugin_dir": plugin_dir,
            **_parse_result(_text(e.stdout)),
        }
    return {
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        # stderr was captured by subprocess and then DISCARDED here, so a crashed
        # agent's error text was lost even on the path whose whole job is keeping
        # diagnostics. It costs nothing to carry and is the first thing anyone reads
        # when a run fails for a reason the JSON payload cannot express.
        "stderr": proc.stderr,
        "plugin_dir": plugin_dir,
        **_parse_result(proc.stdout),
    }


RUNNERS = {
    "claude-code": run_claude_code,
}
