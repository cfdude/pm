* **Six job roles, and a built-in default model per role (execution profile).** The execution profile's
  job roles grow from `implement | test | review` to `plan | implement | test | review | mechanical |
  rudimentary`, and each role now resolves to a built-in default `{model, effort}` when no layer sets
  it: `plan` `opus` (`high`), `implement` `sonnet` (`medium`), `test` `sonnet` (`low`), `review` `opus`
  (`high`), `mechanical` `sonnet` (`low`), `rudimentary` `haiku`. A default is applied at read time,
  never written to `state.json`, and `profile` reports it as source `default`. The epic, lane and
  project layers override a default exactly as they override each other, and unsetting or clearing a
  role falls back to its default.
* **BREAKING (emitted instructions only).** A repo that never set a model used to read "no model
  directive"; after `/pm:upgrade` its rules block names a default pair for every role. Its
  `state.json` does not change. A repo that wants different tiers sets them with `set-profile`.
* **One-shot build.** To have a top-tier model build an epic straight off its finished plan, set
  `update-epic <id> --model implement=fable:<effort>`. It is an override of `implement`, not a role.
* `/pm:init` now recommends accepting the defaults (recording nothing) instead of `opus:medium` on
  every role. The spend ledger's `role` values are the same six roles. Every role list in help text,
  refusals and the rules block is rendered from the one constant.
