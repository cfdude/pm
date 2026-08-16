"""Which pm plugin a run actually loaded, and which tree it came from.

THE POINT. `claude -p` loads plugins from the operator's user-scope settings, so before
`--plugin-dir` existed the harness measured a *separately installed* copy of pm rather than this worktree.
Everything under test came from a different copy of the code than the one
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
