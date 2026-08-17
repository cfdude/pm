"""Read a pm project's observable state back as a plain JSON dict.

This is the answer key surface: a correctly-followed instruction leaves
deterministic traces on disk, so scorers assert on THIS rather than on the
agent's prose.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from provenance import plugin_provenance

ENGINE = Path(__file__).resolve().parent.parent / "scripts" / "conductor.mjs"

# Only the stable PREFIX, never the full decorated marker. The engine's own detection keys on
# this same prefix precisely so the parenthetical can change without stranding older blocks --
# matching the full string here would re-create that bug on the observer side.
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


def _rules_target(project: Path) -> Path | None:
    """Ask the ENGINE which file this project's rules block belongs in.

    Deliberately a subprocess call rather than mirroring PLATFORM_RULES_CHAIN in Python. This
    module used to hardcode `CLAUDE.md`, which quietly made it a SECOND platform seam: once the
    engine started writing a per-platform target, the observer reported rules_block_present=False
    for any platform whose block lands elsewhere -- a confident wrong answer that would surface
    as a fake parity failure on the first non-Claude run. A Python copy of the chain would only
    move that drift rather than remove it, so the engine stays the single source of truth.

    Returns None when the engine cannot answer (not installed, not a pm project, a timeout).
    None is "cannot tell", which the caller renders as absent rather than raising -- an eval
    must be able to score a broken run, not crash on it.
    """
    try:
        proc = subprocess.run(
            ["node", str(ENGINE), "rules-target"],
            cwd=project,
            env={**os.environ, "CLAUDE_PROJECT_DIR": str(project), "PM_QUIET_ENGINE_BANNER": "1"},
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    out = proc.stdout.strip()          # stdout ONLY -- stderr may still carry engine chatter
    return Path(out) if out else None


def _user_memory_files_loaded(project: Path) -> list[str]:
    """USER-scope instruction files the session actually loaded — should always be empty.

    Read from the log an `InstructionsLoaded` hook writes into the fixture (see
    fixtures._write_memory_isolation). This is the POSITIVE half of the isolation proof: without
    it, the only evidence that suppression worked is the agent failing to recite something,
    which cannot be told apart from the probe not landing.

    An empty list is returned when the log is absent. That is deliberately indistinguishable
    from "nothing user-scope loaded", because a fixture built before this hook existed is not a
    failure -- and the scorer's job is to catch a REGRESSION in isolation, not to police fixture
    vintage.
    """
    log = project / ".claude" / "instructions-loaded.log"
    if not log.exists():
        return []
    out = []
    for line in log.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) == 2 and parts[0] == "User":
            out.append(parts[1])
    return out


def observe(project: Path, plugin_dir: str | None = None) -> dict:
    """`plugin_dir`, when given, MUST be the value the runner's own argv actually used for the
    session being observed -- see provenance.plugin_list's docstring for why. Callers that only
    want the epic_ids (the adapter's pre-run `before` snapshot) can omit it; the post-run
    observation must always pass the runner's reported `plugin_dir`.
    """
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

    # Where the block BELONGS for this project's recorded platform -- not a guess, and not
    # "wherever a block happens to exist". Reporting the filename alongside the boolean makes a
    # failure diagnosable without a re-run: "false" and "false, and we were looking at AGENTS.md"
    # are very different findings.
    target = _rules_target(project)

    return {
        "active": state.get("active"),
        "epics": epics,
        "epic_ids": [e["id"] for e in epics],
        "detours": _read_detours(project / ".conductor" / "detours.log"),
        "rules_block_present": bool(
            target and target.exists() and RULES_BEGIN in target.read_text()
        ),
        "rules_block_file": target.name if target else None,
        "user_memory_files_loaded": _user_memory_files_loaded(project),
        "project_md_present": (project / "PROJECT.md").exists(),
        # WHICH artifact tree this run measured. Without it a blessed baseline describes an
        # unidentified plugin: comparing against it three releases later compares against
        # something nobody can name. plugin_id is None unless exactly one pm was enabled, which
        # is how the double-load case becomes a scorer failure rather than a silent average of
        # two plugins.
        **plugin_provenance(project, plugin_dir),
    }
