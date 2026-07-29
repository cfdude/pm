"""The harness must be importable before anything else is worth building."""


def test_edd_harness_public_api_is_importable():
    from edd_harness import JudgeScorer, Scenario, bless, check, compare_run, run, write_run

    assert callable(check)
    assert callable(run)
    assert callable(bless)
    assert callable(write_run)
    assert callable(compare_run)
    assert Scenario is not None
    assert JudgeScorer is not None
