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
