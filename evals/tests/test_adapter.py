"""The adapter is tested with a stub runner. Real agent invocation belongs to
the corpus, not to pytest -- a unit test must never cost 90 seconds."""

import itertools
from pathlib import Path

import pytest

import adapter


def _stub_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
    # Simulate the agent registering an epic by invoking the real engine.
    from fixtures import _engine

    _engine(
        Path(cwd),
        ["add-epic", "--id", "agent-made-this", "--lane", "claude-code",
         "--priority", "P3", "--title", "Created by the stub runner"],
    )
    return {"exit_code": 0, "stdout": "{}", "duration_ms": 1,
            "num_turns": 1, "total_cost_usd": 0.0}


@pytest.fixture
def stubbed(tmp_path, monkeypatch):
    """Wire a successful stub runner and a FRESH workdir per invocation.

    Per-invocation isolation mirrors production (`_workdir` is `mkdtemp`) and is
    required by tests that invoke the adapter twice -- reusing one directory makes
    the second `materialize` fail with "epic already exists", masking the real
    failure under test.
    """
    counter = itertools.count()
    monkeypatch.setitem(adapter.RUNNERS, "stub", _stub_runner)
    monkeypatch.setattr(adapter, "_workdir", lambda: tmp_path / f"run{next(counter)}")
    return monkeypatch


def _invoke():
    return adapter.pm_adapter(
        {"seed": "single-active-epic", "prompt": "irrelevant", "platform": "stub"}
    )


def test_adapter_reports_new_epics_against_the_seed(stubbed):
    out = _invoke()

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


# --- C1: infrastructural failure must be LOUD, not INDETERMINATE ---------------
#
# edd-harness turns any adapter exception into INDETERMINATE, and INDETERMINATE is
# never a regression -- so a propagated infra failure exits 0 and a totally broken
# harness reports success. These tests are the proof that no longer happens.


def _success_keys(stubbed) -> set:
    return set(_invoke())


def test_runner_blowup_returns_sentinel_instead_of_raising(stubbed):
    """`claude` not on PATH is the canonical case: FileNotFoundError from subprocess."""
    expected_keys = _success_keys(stubbed)

    def exploding_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
        raise FileNotFoundError(2, "No such file or directory: 'claude'")

    stubbed.setitem(adapter.RUNNERS, "stub", exploding_runner)

    out = _invoke()  # must NOT raise

    assert out["exit_code"] == adapter.INFRA_FAILURE_EXIT_CODE == -1
    assert set(out) == expected_keys, "a failed run must be shape-identical to a good one"
    assert out["new_epics"] == []
    assert "FileNotFoundError" in out["error"] and "claude" in out["error"]


def test_materialize_blowup_returns_sentinel_instead_of_raising(stubbed):
    """A missing `node` / erroring pm engine fails during fixture materialization --
    just as broken a harness as a missing agent, and just as easy to miss."""
    expected_keys = _success_keys(stubbed)

    def exploding_materialize(seed, workdir):
        raise RuntimeError("engine ['init'] failed: node: command not found")

    stubbed.setattr(adapter, "materialize", exploding_materialize)

    out = _invoke()  # must NOT raise

    assert out["exit_code"] == -1
    assert set(out) == expected_keys
    assert "node: command not found" in out["error"]


def test_corrupt_state_during_observation_returns_sentinel(stubbed):
    """The third phase the finding didn't enumerate: an agent that corrupts
    state.json makes the POST-run observe() raise."""
    expected_keys = _success_keys(stubbed)

    def corrupting_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
        (Path(cwd) / ".conductor" / "state.json").write_text("{ not json")
        return {"exit_code": 0, "stdout": "{}", "duration_ms": 1,
                "num_turns": 1, "total_cost_usd": 0.0}

    stubbed.setitem(adapter.RUNNERS, "stub", corrupting_runner)

    out = _invoke()  # must NOT raise

    assert out["exit_code"] == -1
    assert set(out) == expected_keys
    assert "JSONDecodeError" in out["error"]


def test_scorers_survive_a_failed_run_without_keyerror(stubbed):
    """The whole point of the shared key set: every corpus scorer must be able to
    EVALUATE (and fail) a broken run rather than raise into INDETERMINATE."""
    from corpus import LANE_ROUTING_TYPO

    def exploding_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
        raise TimeoutError("timed out after 300s")

    stubbed.setitem(adapter.RUNNERS, "stub", exploding_runner)
    out = _invoke()

    # .score() is the real runner path: a predicate that RAISES here would become
    # INDETERMINATE, which is precisely the escape hatch C1 closes.
    results = {s.name: s.score(out).passed for s in LANE_ROUTING_TYPO.scorers}

    assert results["run_succeeded"] is False, "the gate scorer must FAIL a broken run"
    # And the illustration of why it is load-bearing: this one passes vacuously.
    assert results["logged_no_spurious_detour"] is True
