## ADDED Requirements

### Requirement: The inward registration recipe carries a summary

The emitted inward registration recipe SHALL include `--summary=<one-line summary>` on its `add-epic` line, and SHALL
instruct the agent to write that summary from the item's body: one line, at most 200 characters, in the agent's own
words and never the raw body. The placeholder SHALL follow the same single-quoting rule as `<issue-title>`. When the
body gives nothing to summarise, the recipe SHALL tell the agent to omit the flag rather than invent a summary.

#### Scenario: Recipe carries the summary flag

- **WHEN** the rules block emits the inward registration recipe for a github-issues tracker
- **THEN** its `add-epic` line contains `--summary=<one-line summary>`, and the recipe states the one-line limit and the quoting rule

#### Scenario: The recipe still runs as written

- **WHEN** the emitted-invocations check fills every placeholder in that line with a quoted value
- **THEN** the engine accepts the line, because the check's placeholder substitution (`fillRecipe` in `scripts/test/functional/emitted-invocations.test.mjs`) fills `<one-line summary>` like the other placeholders
