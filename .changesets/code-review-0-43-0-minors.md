* **A priority outside `P0`–`P3` and `P?` is refused.** `add-epic`, `update-epic` and `add-many`
  stored any value — `--priority banana` became a band of its own that ranked last and rendered as
  if it were real. All three now refuse it by name and write nothing; a record an older engine wrote
  with another value still loads.
* **An `--external-updated-at` watermark must be a timestamp.** The tracker watermark was stored
  whatever it held, so a non-date compared against nothing and the "item changed since you read it"
  check could never fire. `add-epic`, `update-epic`, `add-many` (`externalUpdatedAt`) and
  `record-tracker-refresh` now require an ISO-8601 date-time with a zone in the shapes trackers
  report — `2026-09-25T12:00:00Z`, `…000Z`, or Jira's `…000+0000` — and refuse impossible dates
  such as February 30. `record-tracker-refresh` also refuses a watermark older than the one already
  recorded (a tracker's updated time only moves forward) and names `update-epic
  --external-updated-at` as the correction path when the recorded one is wrong.
