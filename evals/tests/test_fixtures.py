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


def test_materialize_isolates_the_run_from_the_operators_own_memory(tmp_path: Path):
    """The corpus measures pm's artifacts, not the operator's ~/.claude/CLAUDE.md.

    Verified live that a headless session recites facts from that file even in an empty
    directory with tools disabled -- and this maintainer's copy states pm's lane heuristic
    verbatim, which is exactly what a scorer asserts. The bias is asymmetric too: Hermes and
    Codex read AGENTS.md, so Claude Code would enter every parity comparison with an assist
    the others never get.
    """
    import json as _json

    project = materialize("single-active-epic", tmp_path)
    settings_path = project / ".claude" / "settings.local.json"

    assert settings_path.exists(), "every fixture must be memory-isolated by construction"
    settings = _json.loads(settings_path.read_text())

    assert settings["autoMemoryEnabled"] is False, (
        "auto-memory is written from the operator's own corrections, so it drifts toward "
        "whatever is being tested -- the more insidious of the two sources"
    )

    excludes = settings["claudeMdExcludes"]
    assert all(p.startswith("/") for p in excludes), (
        "claudeMdExcludes does NOT expand ~; a relative path silently excludes nothing"
    )
    assert any(p.endswith("/.claude/CLAUDE.md") for p in excludes)
    assert any(p.endswith("SHIP-REAL-SOFTWARE.md") for p in excludes), (
        "CLAUDE.md @-imports it, and whether excluding a parent drops its imports is "
        "undocumented -- so it is listed explicitly rather than assumed"
    )


def test_memory_isolation_does_not_disturb_the_conductor_state(tmp_path: Path):
    """Isolation is additive: it must not perturb what the scorers actually read."""
    project = materialize("single-active-epic", tmp_path)
    state = json.loads((project / ".conductor" / "state.json").read_text())
    assert state["active"] == "canary-active"
    assert (project / "CLAUDE.md").exists(), "pm's own rules block is still written"
