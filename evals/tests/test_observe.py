from pathlib import Path

from fixtures import materialize
from observe import observe


def test_observe_reports_active_and_epics(tmp_path: Path):
    project = materialize("single-active-epic", tmp_path)

    out = observe(project)

    assert out["active"] == "canary-active"
    assert "canary-active" in out["epic_ids"]
    assert out["rules_block_present"] is True
    assert out["project_md_present"] is True
    assert out["detours"] == []


def test_observe_is_json_serializable(tmp_path: Path):
    import json

    project = materialize("single-active-epic", tmp_path)
    json.dumps(observe(project))  # must not raise
