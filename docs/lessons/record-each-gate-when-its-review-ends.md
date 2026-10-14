---
lesson: record-each-gate-when-its-review-ends
date: 2026-10-13
trigger: You are about to record a Gate 1 and a Gate 2 verdict for the same epic back to back, in one sitting or one script, because both reviews already happened and the record is behind.
cost: One `record-gate-review` pair landed 779 ms apart (as the closing orchestrator reported it; the record has since been re-recorded, so the timestamps are not recoverable from state). `integrity` raised `gate-recorded-as-bookkeeping`, and the live-record functional tests 9.4 and 9.14 in `conductor-15.test.mjs` went red in the next functional certify, which blocked the commit. The cost reported was about one full certify cycle (30+ minutes on that run).
rule: Record each gate in its own command at the moment its review ends, with its artifacts or its base and head sha. If a backfill is unavoidable, record the two verdicts far apart in time or carry the evidence form, and expect the check to name them. Never batch both gates of one epic in one go.
enforced_in: scripts/lib/integrity.mjs check `gate-recorded-as-bookkeeping` (arm 2, two gates within 60 seconds, no exemption) names it after the fact; scripts/test/functional/conductor-15.test.mjs 9.4 and 9.14 turn the suite red. Nothing prevents the write.
tags: [gates, integrity, certify, records]
---

**Cause.** `gate-recorded-as-bookkeeping` arm 2 fires when an epic's Gate 1 and Gate 2 `reviewedAt`
stamps are within 60 seconds. Unlike arm 1 it has no evidence exemption, so a correctly evidenced pair
recorded in one sitting is still reported. 9.14 reads the LIVE record and requires every finding to be
explained in a frozen day-one document, so one new finding anywhere fails it.

**What to do instead.** Record Gate 1 the moment the spec review is fixed and validated, before apply.
Record Gate 2 when the implementation review ends. When the reviews really did happen earlier and the
record is catching up, space the writes by the real review times (the verb stamps the clock; there is
no flag to set it), or accept the finding and route it before the certify, not during it.
