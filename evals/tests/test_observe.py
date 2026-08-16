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


def test_observe_finds_the_block_where_a_NON_claude_platform_writes_it(tmp_path: Path):
    """The regression this epic exists for.

    observe() used to hardcode CLAUDE.md. Once the engine started writing a per-platform target,
    that made observe a SECOND, undeclared platform seam: a codex project's block lands in
    AGENTS.md, so the observer reported rules_block_present=False -- a confident wrong answer
    that would surface on the first non-Claude run as a parity failure that is not real.

    This test fails under the old behavior and passes now.
    """
    import subprocess
    import os

    project = materialize("single-active-epic", tmp_path)
    engine = Path(__file__).resolve().parent.parent.parent / "scripts" / "conductor.mjs"

    # Re-target this project at codex, exactly as a codex host would declare itself.
    subprocess.run(
        ["node", str(engine), "write-rules", "--platform", "codex"],
        cwd=project,
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(project), "PM_QUIET_ENGINE_BANNER": "1"},
        capture_output=True, text=True, check=True, timeout=60,
    )

    assert (project / "AGENTS.md").exists(), "codex's block belongs in AGENTS.md"

    out = observe(project)

    assert out["rules_block_file"] == "AGENTS.md", (
        "observe must follow the platform's target, not assume CLAUDE.md"
    )
    assert out["rules_block_present"] is True, (
        "the block IS present -- reporting False here is the exact bug this epic fixed"
    )


def test_observe_reports_cannot_tell_rather_than_crashing_outside_a_pm_project(tmp_path: Path):
    """A broken run must be SCOREABLE, not an exception -- same principle as the adapter's
    infrastructural-failure guard. An eval that raises cannot report a verdict."""
    bare = tmp_path / "not-a-pm-project"
    bare.mkdir()

    out = observe(bare)

    assert out["rules_block_present"] is False
    assert out["project_md_present"] is False
    assert out["epic_ids"] == []


def test_observe_carries_plugin_provenance(tmp_path, monkeypatch):
    """A baseline that does not say which artifact tree it described is not interpretable
    later. These five fields are what make a blessed baseline mean something."""
    import observe
    import provenance

    monkeypatch.setattr(provenance, "plugin_list", lambda project, plugin_dir=None: [
        {"id": "pm@inline", "scope": "session", "enabled": True,
         "version": "0.25.0", "installPath": str(provenance.REPO_ROOT)},
    ])

    out = observe.observe(tmp_path)

    assert out["plugin_id"] == "pm@inline"
    assert out["plugin_install_path"] == str(provenance.REPO_ROOT)
    assert out["plugin_version"] == "0.25.0"
    assert isinstance(out["plugin_commit"], str)
    assert isinstance(out["plugin_dirty"], bool)


def test_observe_forwards_none_plugin_dir_unchanged_to_plugin_provenance(tmp_path, monkeypatch):
    """Guards the FIRST call site on the plugin_dir path: observe()'s own call into
    plugin_provenance. The mutation-tested gap this closes: inserting
    `plugin_dir or str(REPO_ROOT)` right here leaves the full suite green (Finding 1), because
    the existing coverage only pins argv construction inside plugin_list itself, three frames
    away -- it never asserts on what observe() actually passes down.

    Patching `provenance.plugin_provenance` would NOT catch this: observe.py does
    `from provenance import plugin_provenance`, a module-level name binding copied at import
    time, so the spy must replace `observe.plugin_provenance`, the name observe() actually
    calls, not `provenance.plugin_provenance`.
    """
    import observe as observe_module

    captured = {}

    def _spy(project, plugin_dir=None):
        captured["plugin_dir"] = plugin_dir
        return {
            "plugin_id": None,
            "plugin_install_path": None,
            "plugin_version": None,
            "plugin_commit": None,
            "plugin_dirty": None,
        }

    monkeypatch.setattr(observe_module, "plugin_provenance", _spy)

    bare = tmp_path / "not-a-pm-project"
    bare.mkdir()
    observe_module.observe(bare, plugin_dir=None)

    assert captured["plugin_dir"] is None
