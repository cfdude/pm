"""Unit tests for provenance parsing. No agent runs, no `claude` invocation —
every test feeds captured `plugin list --json` shapes to the pure functions."""

from __future__ import annotations

import provenance

# Captured verbatim from `claude --plugin-dir <repo> plugin list --json` (trimmed to pm rows).
INLINE = {
    "id": "pm@inline", "version": "0.25.0", "scope": "session", "enabled": True,
    "installPath": "/Users/x/Documents/Repos/pm",
}
INSTALLED_ON = {
    "id": "pm@cfdude-plugins", "version": "0.25.0", "scope": "user", "enabled": True,
    "installPath": "/Users/x/.claude/plugins/cache/cfdude-plugins/pm/0.25.0",
}
INSTALLED_OFF = {**INSTALLED_ON, "enabled": False}
OTHER_PLUGIN = {
    "id": "honcho@cfdude-plugins", "version": "0.7.0", "scope": "user", "enabled": True,
    "installPath": "/Users/x/.claude/plugins/cache/cfdude-plugins/honcho/0.7.0",
}


def test_pm_entries_matches_the_name_component_not_the_marketplace():
    entries = [OTHER_PLUGIN, INLINE, INSTALLED_ON]
    assert provenance.pm_entries(entries) == [INLINE, INSTALLED_ON]


def test_pm_entries_ignores_a_plugin_whose_name_merely_starts_with_pm():
    # `pm-worktree@x` is NOT pm. Matching on a prefix would disable an unrelated plugin.
    entries = [{"id": "pm-worktree@x", "version": "1", "scope": "user", "enabled": True, "installPath": "/tmp/a"}]
    assert provenance.pm_entries(entries) == []


def test_installed_pm_ids_returns_every_enabled_user_scope_pm():
    # Deliberately NOT hardcoded to "pm@cfdude-plugins" — a pm installed from a differently
    # named marketplace must still be disabled, or the run silently measures two plugins.
    second = {**INSTALLED_ON, "id": "pm@other-marketplace"}
    assert provenance.installed_pm_ids([INLINE, INSTALLED_ON, second, OTHER_PLUGIN]) == [
        "pm@cfdude-plugins", "pm@other-marketplace",
    ]


def test_installed_pm_ids_skips_already_disabled_and_session_scope():
    assert provenance.installed_pm_ids([INLINE, INSTALLED_OFF]) == []


def test_plugin_fields_report_the_single_enabled_pm():
    fields = provenance._fields_from_entries([INLINE, INSTALLED_OFF])
    assert fields == {
        "plugin_id": "pm@inline",
        "plugin_install_path": "/Users/x/Documents/Repos/pm",
        "plugin_version": "0.25.0",
    }


def test_plugin_fields_are_none_when_two_pms_are_enabled():
    # The double-load case. None here is what makes the scorer fail instead of silently
    # reporting whichever entry happened to sort first.
    assert provenance._fields_from_entries([INLINE, INSTALLED_ON]) == {
        "plugin_id": None, "plugin_install_path": None, "plugin_version": None,
    }


def test_plugin_fields_are_none_when_no_pm_is_enabled():
    assert provenance._fields_from_entries([INSTALLED_OFF]) == {
        "plugin_id": None, "plugin_install_path": None, "plugin_version": None,
    }


def test_plugin_provenance_carries_exactly_the_five_documented_keys(monkeypatch, tmp_path):
    monkeypatch.setattr(provenance, "plugin_list", lambda project, plugin_dir=None: [INLINE, INSTALLED_OFF])
    out = provenance.plugin_provenance(tmp_path)
    assert set(out) == {
        "plugin_id", "plugin_install_path", "plugin_version", "plugin_commit", "plugin_dirty",
    }


def test_plugin_list_returns_empty_rather_than_raising_when_claude_is_unavailable(monkeypatch, tmp_path):
    # An eval must be able to SCORE a broken run, not crash on it — same rule the adapter
    # follows for infrastructural failure.
    def boom(*a, **k):
        raise OSError("claude: not found")
    monkeypatch.setattr(provenance.subprocess, "run", boom)
    assert provenance.plugin_list(tmp_path) == []


def test_git_provenance_reports_the_real_repo_and_a_boolean_dirty_flag():
    out = provenance.git_provenance()
    assert set(out) == {"plugin_commit", "plugin_dirty"}
    assert isinstance(out["plugin_commit"], str) and len(out["plugin_commit"]) >= 7
    assert isinstance(out["plugin_dirty"], bool)


def test_plugin_list_includes_plugin_dir_flag_when_given_one(monkeypatch, tmp_path):
    # Task 5: plugin_list must REPLAY the caller's plugin_dir, never re-derive its own from
    # REPO_ROOT. Assert directly on the argv a caller-supplied value produces.
    captured = {}

    class _Proc:
        returncode = 0
        stdout = "[]"

    def _fake_run(argv, **kwargs):
        captured["argv"] = argv
        return _Proc()

    monkeypatch.setattr(provenance.subprocess, "run", _fake_run)
    provenance.plugin_list(tmp_path, "/some/worktree")

    argv = captured["argv"]
    assert "--plugin-dir" in argv
    assert argv[argv.index("--plugin-dir") + 1] == "/some/worktree"


def test_plugin_list_omits_plugin_dir_flag_when_none(monkeypatch, tmp_path):
    # Anti-regression test: the exact fallback that must never exist. If plugin_dir=None ever
    # silently substitutes REPO_ROOT, this is the test that catches it -- Task 4 proved that
    # fallback makes the measured_the_worktree scorer pass vacuously in two of three failure
    # modes (see provenance.plugin_list's docstring).
    captured = {}

    class _Proc:
        returncode = 0
        stdout = "[]"

    def _fake_run(argv, **kwargs):
        captured["argv"] = argv
        return _Proc()

    monkeypatch.setattr(provenance.subprocess, "run", _fake_run)
    provenance.plugin_list(tmp_path, None)

    argv = captured["argv"]
    assert "--plugin-dir" not in argv


def test_plugin_provenance_forwards_none_plugin_dir_unchanged_to_plugin_list(monkeypatch, tmp_path):
    """Guards the SECOND call site on the plugin_dir path: plugin_provenance's own call into
    plugin_list. The mutation-tested gap this closes: inserting `plugin_dir or str(REPO_ROOT)`
    right here leaves the full suite green (Finding 1) because nothing asserted on the exact
    value plugin_list actually received -- only on plugin_provenance's return dict, which a
    `[]`-returning plugin_list produces identically either way. Spy on plugin_list directly and
    assert on the recorded argument, not on a downstream effect.
    """
    captured = {}

    def _spy(project, plugin_dir=None):
        captured["plugin_dir"] = plugin_dir
        return []

    monkeypatch.setattr(provenance, "plugin_list", _spy)
    provenance.plugin_provenance(tmp_path, None)

    assert captured["plugin_dir"] is None
