* **An epic archived by `/opsx:archive` no longer keeps its advisory claim.** `update-epic
  --status archived` already cleared the claim of an epic that ended, but the archive-drift heal —
  the path an `/opsx:archive`d change usually takes to `archived` — did not, and `integrity` then
  reported the leftover claim as one that "predates that rule or was hand-edited". Both paths now
  clear it the same way and say so: `cleared the advisory claim held by '<session>' — '<id>' has
  ended`.
