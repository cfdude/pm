* **`spend` names the invalid pm-spend markers it refused (#242).** A marker whose role, phase or round is
  invalid used to surface only as tokens under `invalid-marker`. Measured in this repo, 24.5M tokens (17% of
  a 141.2M ledger) of real work were dispatched with `phase=spec` or `phase=gate-1` and went unseen until
  attribution read 68.1%. The text report now prints one line per distinct `(field, value)` (the first
  failing field in the order role, phase, round), with the accepted set, the agent count and the tokens,
  and `--json` carries `unattributed.invalidMarkers`. Validation stays strict: no alias is accepted.
