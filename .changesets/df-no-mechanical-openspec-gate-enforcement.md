- **OpenSpec's two mandatory gates are now mechanically enforced at archive time, not just
  narrated.** Nothing previously checked that an `openspec`-lane epic actually passed Gate 1
  (spec review, before code) and Gate 2 (implementation review, before docs) before it was
  archived — an epic could go straight from `apply` to `archive` on narration alone. A new
  `record-gate-review <epicId> --gate 1|2 --verdict pass|fail [--reviewer "<note>"]` subcommand
  writes a fresh-context reviewer's verdict durably onto the epic (`gateReview.gate1`/`gate2`,
  mirroring `record-reconcile`'s shape), and `update-epic --status archived` now REJECTS the
  transition for any `openspec`-lane epic that doesn't already have a recorded
  `gateReview.gate2.verdict === "pass"`. Scoped strictly to the `openspec` lane —
  `superpowers`/`claude-code`/`decision`/`external` epics are completely unaffected, since they
  have no two-gate process.
