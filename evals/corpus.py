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

ENGINE_HINT = (
    "Use the pm engine at ../../scripts/conductor.mjs relative to the pm repo, "
    "or the installed pm plugin's commands."
)

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
            "logged_no_spurious_detour",
            lambda o: o["detours"] == [],
            reason="Registering an epic is not a detour; the detour trail should stay empty.",
        ),
    ],
)

SCENARIOS = [LANE_ROUTING_TYPO]
