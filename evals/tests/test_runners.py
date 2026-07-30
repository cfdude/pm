"""Unit tests for the runner layer. These must NOT invoke a real agent --
agent invocation is exercised by the corpus, not by pytest."""

import json

import runners


def test_claude_code_is_registered():
    assert "claude-code" in runners.RUNNERS


def test_parses_metrics_from_output_format_json():
    payload = json.dumps(
        {"result": "ok", "duration_ms": 90406, "num_turns": 7, "total_cost_usd": 0.42}
    )

    parsed = runners._parse_result(payload)

    assert parsed["duration_ms"] == 90406
    assert parsed["num_turns"] == 7
    assert parsed["total_cost_usd"] == 0.42


def test_parse_result_survives_non_json_output():
    parsed = runners._parse_result("not json at all")

    assert parsed["duration_ms"] is None
    assert parsed["num_turns"] is None
    assert parsed["total_cost_usd"] is None


def test_child_env_disables_honcho_without_dropping_the_environment():
    """honcho is a user-scope plugin; spawned eval sessions must not write to the
    maintainer's personal memory. Passing env= replaces the environment wholesale, so
    assert PATH survived too -- a bare {"HONCHO_ENABLED": "false"} would break `claude`."""
    env = runners._child_env()

    assert env["HONCHO_ENABLED"] == "false"
    assert env.get("PATH"), "env= replaces the environment; PATH must be carried through"


def test_every_runner_passes_the_disabling_env_to_the_subprocess(monkeypatch):
    """Guards the whole RUNNERS registry, not just claude-code, so a platform runner
    added later cannot silently reintroduce memory pollution."""
    seen = {}

    def fake_run(argv, **kwargs):
        seen[argv[0]] = kwargs.get("env")

        class _Proc:
            returncode = 0
            stdout = "{}"

        return _Proc()

    monkeypatch.setattr(runners.subprocess, "run", fake_run)

    for platform, runner in runners.RUNNERS.items():
        seen.clear()
        runner("noop prompt", cwd=".")
        assert seen, f"{platform} runner spawned nothing observable"
        for binary, env in seen.items():
            assert env is not None, f"{platform} inherits the environment instead of setting it"
            assert env.get("HONCHO_ENABLED") == "false", (
                f"{platform} spawns {binary} without HONCHO_ENABLED=false"
            )
