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
