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


def test_the_instructions_recorder_actually_works(tmp_path: Path):
    """Pipe a real payload through the recorder rather than trusting it.

    The recorder swallows all errors on purpose -- an observability hook must never break the
    run it observes. But that swallow also HID a real bug: the first version was `.mjs` and
    used `require`/`__dirname`, neither of which exists in an ES module. It threw
    ReferenceError, the catch ate it, the log stayed empty, and `no_operator_memory_loaded`
    would have passed vacuously forever. This test is why that cannot recur.
    """
    import subprocess as sp

    project = materialize("single-active-epic", tmp_path)
    recorder = project / ".claude" / "record-instructions.cjs"
    assert recorder.exists(), "the InstructionsLoaded recorder must be written into the fixture"

    payload = json.dumps({"memory_type": "User", "file_path": "/home/someone/.claude/CLAUDE.md"})
    sp.run(["node", str(recorder)], input=payload, text=True, check=True, timeout=30)

    log = project / ".claude" / "instructions-loaded.log"
    assert log.exists() and log.read_text().strip(), (
        "the recorder produced nothing -- it is broken, and the scorer built on it is vacuous"
    )
    assert log.read_text().startswith("User\t/home/someone/.claude/CLAUDE.md")


def test_observe_surfaces_a_user_scope_load_so_the_scorer_can_fail(tmp_path: Path):
    """The scorer must be able to FAIL. Simulate isolation breaking and confirm it is seen."""
    from observe import observe

    project = materialize("single-active-epic", tmp_path)
    assert observe(project)["user_memory_files_loaded"] == [], "clean fixture: nothing user-scope"

    (project / ".claude" / "instructions-loaded.log").write_text(
        "Project\t/tmp/p/CLAUDE.md\nUser\t/home/someone/.claude/CLAUDE.md\n"
    )
    leaked = observe(project)["user_memory_files_loaded"]
    assert leaked == ["/home/someone/.claude/CLAUDE.md"], (
        "a User-scope load must surface, or no_operator_memory_loaded can never fail"
    )


def test_materialize_disables_every_enabled_user_scope_pm(tmp_path, monkeypatch):
    """The installed pm must be switched off, or --plugin-dir yields TWO active pm plugins:
    two SessionStart hooks, two /pm: command sets, two engines. Computed from the live
    listing, so a differently-named marketplace is still caught."""
    import fixtures
    import provenance

    monkeypatch.setattr(provenance, "plugin_list", lambda project, plugin_dir=None: [
        {"id": "pm@cfdude-plugins", "scope": "user", "enabled": True, "version": "0.25.0", "installPath": "/x"},
        {"id": "pm@other", "scope": "user", "enabled": True, "version": "0.25.0", "installPath": "/y"},
        {"id": "pm@inline", "scope": "session", "enabled": True, "version": "0.25.0", "installPath": "/z"},
    ])

    project = fixtures.materialize("single-active-epic", tmp_path)
    settings = json.loads((project / ".claude" / "settings.local.json").read_text())

    assert settings["enabledPlugins"] == {"pm@cfdude-plugins": False, "pm@other": False}
    # session-scope pm@inline is the plugin under test — it must NOT be disabled
    assert "pm@inline" not in settings["enabledPlugins"]


def test_runner_argv_loads_the_worktree_plugin(monkeypatch, tmp_path):
    """--plugin-dir is a GLOBAL flag and must precede the -p subcommand form's arguments."""
    import runners
    import provenance

    captured = {}

    class _Proc:
        returncode = 0
        stdout = "{}"

    def _fake_run(argv, **kwargs):
        captured["argv"] = argv
        return _Proc()

    monkeypatch.setattr(runners.subprocess, "run", _fake_run)
    runners.run_claude_code("hi", tmp_path)

    argv = captured["argv"]
    assert "--plugin-dir" in argv, "the run must load the worktree, not the installed plugin"
    assert argv[argv.index("--plugin-dir") + 1] == str(provenance.REPO_ROOT)


def test_run_claude_code_reports_the_plugin_dir_it_used(monkeypatch, tmp_path):
    """The post-run observation must REPLAY this value, never re-derive its own from
    REPO_ROOT (Task 5) -- so the runner has to report what it actually passed."""
    import runners
    import provenance

    class _Proc:
        returncode = 0
        stdout = "{}"

    def _fake_run(argv, **kwargs):
        return _Proc()

    monkeypatch.setattr(runners.subprocess, "run", _fake_run)
    result = runners.run_claude_code("hi", tmp_path)

    assert result["plugin_dir"] == str(provenance.REPO_ROOT)
