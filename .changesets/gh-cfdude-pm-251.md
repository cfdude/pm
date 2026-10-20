* **A token ceiling can now count work instead of cache-read (#251).** `spend` totals gain `work`
  (`input + cacheCreation + output`), the one definition every consumer reads. `set-spend-guard
  --token-basis total|work` (with `--unset token-basis`) records the unit a `--tokens` ceiling is counted in,
  at the project, a lane or an epic. An absent basis reads as `total`, so every ceiling set on 0.52 keeps its
  meaning and no migration runs. `spend-guard` always prints the epic's four token classes plus `work` and
  `total` beside the token signal (`signals.tokens.basis` and `.breakdown` in `--json`). A `total`-basis
  ceiling below 10,000,000 is recorded with a one-line note naming cache-read and `--token-basis work`
  (the floor is the issue's suggestion, not a measurement). A tokens override records the basis its
  baseline was counted in and is set aside, with a notice, when the epic now counts another basis.
