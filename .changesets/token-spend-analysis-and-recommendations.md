* **New `spend-analysis [--epic <id> | --release <id>] [--json] [--no-ingest]` verb: where the tokens went, which agents are outliers, and what to change.**
  Reads the existing spend ledger through `spend`'s own ingest and attribution (it never turns tracking on, writes nothing
  to `state.json`, opens no network connection and calls no model). It keeps `input`, `cache-write`, `cache-read`,
  `output`, `work` and `total` apart, split by actor, model tier, role and phase; ranks sub-agents by `work` and prints
  `total` beside it; gives the unattributed reasons and ledger-wide coverage their own section; and counts tool use per
  tool name from the tool names each ledger row already stores (messages that called the tool, never a token figure).
  There is no money cost. With tracking off it says so and opens no spend or transcript path.
* **Six outlier rules, each flag printing its evidence, its threshold and one rule-rendered recommendation.**
  `long-context-agent` (at least 100 messages and 200,000 mean context per message), `dominant-agent` (at least 50% of an
  epic's work, on an epic with 2 or more agents), `tier-mismatch` (a mechanical, rudimentary or test role on an opus or
  fable model; a plan or review role on a haiku model), `review-loop` (3 or more distinct review rounds, not the spend
  guard's rounds signal), `low-coverage` (under 90%) and `invalid-markers`. Every threshold is a named constant labelled
  a proposal, not a measurement, and the output says so.
* **A cross-release trend with a data floor.** Mean `work` per epic for each release, and a `growing`, `falling` or `flat`
  verdict (a 20% band) only when two releases each hold at least 3 epics with attributed rows; otherwise
  `insufficient data` with the release and epic counts.
