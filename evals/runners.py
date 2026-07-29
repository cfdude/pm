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
