"""The evaluation corpus.

Every scorer asserts DESIRED behavior, never one platform against another:
two platforms failing identically is parity but still broken. Parity means
every supported platform passes this same corpus.

Scorers are deterministic check() wherever the behavior is observable in
.conductor state -- which is almost always, because the engine is the
instrumentation.
"""

from __future__ import annotations

from edd_harness import Scenario, check

from adapter import pm_adapter

LANE_ROUTING_TYPO = Scenario(
    id="lane-routing/typo-fix-is-claude-code",
    input={
        "seed": "single-active-epic",
        "platform": "claude-code",
        "prompt": (
            "A one-word typo needs fixing in README.md. Register that work as an epic "
            "in the pm conductor. Choose the lane yourself per pm's routing heuristic. "
            "Do not start the fix; registration only."
        ),
    },
    adapter=pm_adapter,
    samples=3,
    tags=("lane-routing", "deterministic"),
    scorers=[
        check(
            "run_succeeded",
            lambda o: o["exit_code"] == 0,
            reason=(
                "A non-zero exit means the HARNESS or the agent session failed "
                "(claude not on PATH, timeout, engine error, corrupt state) -- NOT that "
                "the agent chose to do nothing. Without this check every other scorer "
                "can pass vacuously on a run that never happened: `detours == []` is "
                "trivially true when nothing ever ran."
            ),
        ),
        check(
            "registered_exactly_one_epic",
            lambda o: len(o["new_epics"]) == 1,
            reason="The agent should register the work as a single epic.",
        ),
        check(
            "chose_claude_code_lane",
            lambda o: o["new_epics"][0]["lane"] == "claude-code" if o["new_epics"] else False,
            reason="A <2h single-file tweak routes to claude-code, not openspec/superpowers.",
        ),
        check(
            "left_active_epic_untouched",
            lambda o: o["active"] == "canary-active",
            reason="Registering new work must not steal the active pointer.",
        ),
        check(
            "no_operator_memory_loaded",
            lambda o: o["user_memory_files_loaded"] == [],
            reason=(
                "The corpus measures pm's ARTIFACTS. The operator's user-scope CLAUDE.md states "
                "pm's lane heuristic verbatim, so if it loads, a pass cannot be attributed to "
                "pm's rules block. Asserted POSITIVELY from an InstructionsLoaded hook rather "
                "than inferred from the agent failing to recite something -- absence of evidence "
                "is not evidence of isolation. Also asymmetric: Hermes and Codex read AGENTS.md, "
                "so leaving this unchecked hands Claude Code an assist they never get."
            ),
        ),
        check(
            "logged_no_spurious_detour",
            lambda o: o["detours"] == [],
            reason="Registering an epic is not a detour; the detour trail should stay empty.",
        ),
    ],
)

SCENARIOS = [LANE_ROUTING_TYPO]
