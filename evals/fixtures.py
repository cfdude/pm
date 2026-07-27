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
