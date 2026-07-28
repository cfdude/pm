"""The adapter is tested with a stub runner. Real agent invocation belongs to
the corpus, not to pytest -- a unit test must never cost 90 seconds."""

from pathlib import Path

import adapter


def test_adapter_reports_new_epics_against_the_seed(tmp_path, monkeypatch):
    def stub_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
        # Simulate the agent registering an epic by invoking the real engine.
        from fixtures import _engine

        _engine(
            Path(cwd),
            ["add-epic", "--id", "agent-made-this", "--lane", "claude-code",
             "--priority", "P3", "--title", "Created by the stub runner"],
        )
        return {"exit_code": 0, "stdout": "{}", "duration_ms": 1,
                "num_turns": 1, "total_cost_usd": 0.0}

    monkeypatch.setitem(adapter.RUNNERS, "stub", stub_runner)
    monkeypatch.setattr(adapter, "_workdir", lambda: tmp_path)

    out = adapter.pm_adapter(
        {"seed": "single-active-epic", "prompt": "irrelevant", "platform": "stub"}
    )

    assert [e["id"] for e in out["new_epics"]] == ["agent-made-this"]
    assert out["active"] == "canary-active", "the seed's active epic must be untouched"
    assert out["exit_code"] == 0


def test_adapter_rejects_unknown_platform(tmp_path, monkeypatch):
    monkeypatch.setattr(adapter, "_workdir", lambda: tmp_path)

    try:
        adapter.pm_adapter({"seed": "single-active-epic", "prompt": "x", "platform": "nope"})
    except KeyError as exc:
        assert "nope" in str(exc)
    else:
        raise AssertionError("expected KeyError for an unknown platform")
