* **Moving an epic between releases now leaves a record on the release it left.** `release r2
  --member e1`, with `e1` in `r1`, still moves it, but `r1` now gets an `unmember` amendment
  marked `via: "member"` and `to: "r2"`, and stderr names both releases. `release show r1` shows
  "moved to `r2`". Before this change it showed no members, no amendment, and nothing on stderr.
  Re-adding an epic to the release it is already in writes nothing.
* **Re-deferring an epic with a new reason keeps the old reason.** `deferred[]` holds the current
  reason, and the replaced one goes into the release's `amendments[]` as a `redefer` entry with
  `was` and `wasRecordedAt`, so `release show` renders both. Re-running `--defer` with the same
  reason writes nothing, and no longer refreshes `recordedAt`. A `state.json` written by 0.49.0
  loads unchanged, and no migration runs.
