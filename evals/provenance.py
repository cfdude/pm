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


def plugin_list(project: Path, plugin_dir: str | None = None) -> list[dict]:
    """`claude [--plugin-dir <plugin_dir>] plugin list --json`, run inside `project`.

    `plugin_dir` MUST be the value the runner's OWN argv actually used for the session under
    observation -- it must NEVER default to `REPO_ROOT`. A `REPO_ROOT` fallback here is exactly
    the bug this parameter exists to fix: Task 4's live proofs showed that when this function
    re-derived its own `--plugin-dir` from `REPO_ROOT` instead of replaying what `runners.py`
    passed, `measured_the_worktree` passed vacuously in two of its three failure modes --
    proof 1 (runner omits `--plugin-dir` entirely) and proof 3 (runner points `--plugin-dir` at
    a stale copy) both still reported the true worktree, because the diagnostic re-query never
    saw what the runner actually did. `None` here means "the caller wants a listing of
    installed/enabled plugins without adding any session-scope one" -- it omits the flag rather
    than substituting REPO_ROOT, so the observation reflects the real session, not a guess.

    Returns [] on ANY failure (claude missing, non-zero exit, unparseable output). An eval must
    be able to score a broken run rather than crash on it; [] flows through to `plugin_id: None`,
    which the scorer FAILS on -- loudly, and without an exception that would be mapped to
    INDETERMINATE and silently exit 0.
    """
    argv = ["claude"]
    if plugin_dir is not None:
        argv += ["--plugin-dir", plugin_dir]
    argv += ["plugin", "list", "--json"]
    try:
        proc = subprocess.run(
            argv,
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


def plugin_provenance(project: Path, plugin_dir: str | None = None) -> dict:
    """The five provenance fields every observation carries.

    `plugin_dir` is forwarded to `plugin_list` untouched -- see that function's docstring for
    why it must never default to `REPO_ROOT`.
    """
    return {**_fields_from_entries(plugin_list(project, plugin_dir)), **git_provenance()}
