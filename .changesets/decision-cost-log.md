* **New `record-decision <epic> --what "<decision>" --why "<why>" --since <iso>` verb: the decisions an epic's work reached, for a postmortem.**
  Appends a numbered decision (`what`, `why`, `--alternative` once per alternative considered, `--phase`, and the window of
  work that reached it, `--since` to `--until`, which defaults to the record time) to the epic. Numbers are per epic, start at
  1 and are never reused. Recording is refused while spend tracking is off, naming `set-spend-tracking on` and
  `update-epic <id> --notes`; an archived epic accepts a decision. `record-decision <epic> --withdraw <n> --reason "<why>"`
  marks a decision withdrawn and keeps it (it reads no ledger, so it stays accepted with tracking off).
* **New `decisions <epic> [--json] [--no-ingest]` verb, and a Decisions section in `spend-analysis --epic <id>`.** Each decision's
  cost is computed when read, never typed and never stored: the `work` and `total` the spend ledger attributes to the epic
  inside the decision's window, plus that window's coverage share. It is the epic's spend in the window, not spend the
  decision alone caused, and overlapping windows are not summed. With tracking off each decision reads
  `cost: not computed` and no spend or transcript path is opened.
