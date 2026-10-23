* **`record-gate-review --gate 2 --verdict fail` now requires `--base-sha` and `--head-sha`.** A failing review of
  shipped work still reviewed a range, and a Gate 2 fail with none could not say which work it covered. The refusal
  names the missing flag(s) and says a Gate 2 fail carries a range, and writes nothing. A Gate 1 fail is unchanged
  (`--artifact`, no range needed), and so is a pass on either gate. A Gate 2 fail recorded without a range by an
  earlier version still loads and is still reported by `integrity` as `late-failing-gate-review`.
