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


def test_adapter_passes_the_runners_plugin_dir_into_the_post_run_observation(stubbed, monkeypatch):
    """Task 5's wiring: pm_adapter must REPLAY the runner's own reported plugin_dir into
    observe(), never let observe() re-derive its own. A stub runner reports a sentinel value;
    if the adapter ever stops threading it through, observe() would be called with the
    wrong (or no) plugin_dir and this test would still pass silently with a hardcoded lambda --
    so assert on the exact value observe() received."""
    import observe as observe_module

    captured = {}
    real_observe = observe_module.observe

    def _spy_observe(project, plugin_dir=None):
        captured.setdefault("calls", []).append(plugin_dir)
        return real_observe(project, plugin_dir=plugin_dir)

    monkeypatch.setattr(adapter, "observe", _spy_observe)

    def _stub_runner_with_plugin_dir(prompt, cwd, allowed_tools="Bash", timeout=300):
        from fixtures import _engine

        _engine(
            Path(cwd),
            ["add-epic", "--id", "agent-made-this", "--lane", "claude-code",
             "--priority", "P3", "--title", "Created by the stub runner"],
        )
        return {"exit_code": 0, "stdout": "{}", "duration_ms": 1, "num_turns": 1,
                "total_cost_usd": 0.0, "plugin_dir": "/sentinel/plugin/dir"}

    stubbed.setitem(adapter.RUNNERS, "stub", _stub_runner_with_plugin_dir)

    _invoke()

    # First call is the pre-run `before` snapshot (no plugin_dir passed); second is the
    # post-run observation, which must carry the runner's reported value verbatim.
    assert captured["calls"] == [None, "/sentinel/plugin/dir"]


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


def test_runner_returning_incomplete_dict_returns_sentinel_instead_of_raising(stubbed):
    """A runner that returns a dict missing an expected key (e.g. a new platform
    port that forgot `total_cost_usd`) must fail loudly via the shared guard,
    not raise a KeyError that propagates into INDETERMINATE."""
    expected_keys = _success_keys(stubbed)

    def incomplete_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
        return {"exit_code": 0, "duration_ms": 1, "num_turns": 1}  # no total_cost_usd

    stubbed.setitem(adapter.RUNNERS, "stub", incomplete_runner)

    out = _invoke()  # must NOT raise

    assert out["exit_code"] == adapter.INFRA_FAILURE_EXIT_CODE == -1
    assert set(out) == expected_keys, "a failed run must be shape-identical to a good one"
    assert "KeyError" in out["error"] and "total_cost_usd" in out["error"]


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


# ── the agent's own output must survive into the observation ──────────────────
#
# A scorer that fails was undiagnosable if the agent's output was gone: the runner
# captured stdout, and the adapter copied exit_code/duration/turns/cost out of the
# result and dropped the rest — so the only way to see what the agent actually said
# was to RUN IT AGAIN, 90 seconds and a different sample against a non-deterministic
# surface. The failure path already knew this ("Keep the diagnostic. A failing run
# that can't be explained is worse than no run at all"); the
# success-with-a-failing-scorer path did not, which is the case a corpus produces
# most often.
#
# `stderr` was captured NOWHERE — `runners.py` discarded `proc.stderr` outright — so
# a crashed agent's error text was lost even on the path that keeps diagnostics.
#
# Deliberately NOT truncated. A bounded excerpt is the silent-truncation shape this
# repo has already shipped once (#156), and the interesting part of an agent
# transcript is as often the end as the beginning, so any cap discards evidence
# exactly on the run worth reading.

def _loud_runner(prompt, cwd, allowed_tools="Bash", timeout=300):
    return {"exit_code": 0, "stdout": '{"num_turns": 3}', "stderr": "a warning on stderr",
            "duration_ms": 1, "num_turns": 3, "total_cost_usd": 0.0}


def test_adapter_carries_agent_stdout_into_the_observation(stubbed):
    stubbed.setitem(adapter.RUNNERS, "stub", _loud_runner)
    assert _invoke()["stdout"] == '{"num_turns": 3}'


def test_adapter_carries_agent_stderr_too(stubbed):
    stubbed.setitem(adapter.RUNNERS, "stub", _loud_runner)
    assert _invoke()["stderr"] == "a warning on stderr"


def test_stdout_is_whole_not_excerpted(stubbed):
    big = "x" * 50_000

    def _verbose(prompt, cwd, allowed_tools="Bash", timeout=300):
        return {"exit_code": 0, "stdout": big, "stderr": "",
                "duration_ms": 1, "num_turns": 1, "total_cost_usd": 0.0}

    stubbed.setitem(adapter.RUNNERS, "stub", _verbose)
    assert len(_invoke()["stdout"]) == 50_000, "the transcript must not be capped"


def test_a_runner_without_stderr_still_works(stubbed):
    # The existing stub returns no `stderr` key. Absent must read as "" rather than
    # raising: an adapter that crashes on a missing DIAGNOSTIC field turns a scorer
    # failure into an infrastructure failure, which is strictly worse than the gap.
    out = _invoke()
    assert out["stderr"] == ""
    assert out["stdout"] == "{}"
