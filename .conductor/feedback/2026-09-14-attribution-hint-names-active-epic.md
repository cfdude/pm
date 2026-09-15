# The post-commit ATTRIBUTION hint always names the active epic, even for a commit that belongs to the paused one

## What happens
After every commit the PostToolUse hook prints
`ATTRIBUTION — record this commit against its epic now: update-epic <ACTIVE-ID> --attribute-commit <sha>`.
The id is the active (detour) epic, whatever the commit touched. During a detour, commits that amend the
PAUSED epic's own artifacts (or that belong to both) get a hint naming the wrong epic.

Required task item 4 says the engine infers attribution from NOTHING, which is right — but the hint
presents one epic's id as if it were the answer. Followed literally, it attributes a paused epic's commit
to the detour, which corrupts the detour's Gate 2 endpoint (the last attributed sha) and leaves the paused
epic's range incomplete.

## How it bit (pm 0.43.0, dogfooding)
`gate-verdict-withdrawal` paused behind `archive-gate-reads-what-it-writes`. Several commits amended only
the paused change's tasks/design/spec (cross-spec fixes); each hint named `archive-gate-reads-what-it-writes`.
Routed around by hand, every time.

## Suggested shape
Keep emitting a copy-pasteable line, but when the detour stack is non-empty name every candidate:
the active epic AND each paused epic, stating the choice is the agent's. Optionally, where the commit
touches only `openspec/changes/<id>/` for a registered epic id, list that epic first (as a hint, never
as inferred attribution).
