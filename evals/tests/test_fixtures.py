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
