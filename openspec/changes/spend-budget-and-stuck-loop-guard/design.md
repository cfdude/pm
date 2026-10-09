# Design: spend-budget-and-stuck-loop-guard

## Context

The motivation is in proposal.md ("Why"). The requirements are in `specs/spend-guard/spec.md`.

What the engine has today, and why it is not enough:

| Fact (read from source on 2026-10-09) | Consequence |
|---|---|
| `record-gate-review` (`scripts/lib/gate-review-writeback.mjs:180-186`) keeps the latest verdict per gate plus ONE superseded entry, and drops the chain below it. | State cannot say how many rounds a gate took. A counter has to be its own field, written by that verb. |
| The 0.51.0 loop's rounds were mostly not recorded as failed verdicts. The spend ledger's dispatch marker carries `phase=review round=<n>` (`rules.mjs` `spendTrackingLines`). | A counter fed only by recorded verdicts misses the real incident. With tracking on, the ledger is a second source. |
| `spend` (`scripts/lib/spend-command.mjs`) runs ingest, then `attribute()`, then `buildReport()`. `report.epics[id].totals.total` is the per-epic figure, and `report.coverage.share` is the attributed share. The ledger design (D2) already says the budget guard will use this pipeline for live totals. | The guard reuses the pipeline in-process. It never re-reads transcripts by another route. |
| The `spend-ledger` spec says: no hook reads a transcript or a ledger file; with tracking off, nothing but `spend` and `set-spend-tracking` touches the spend directory. | The guard reads the ledger only inside `spend-guard` and only while tracking is on. The brief and `record-gate-review` read `state.json` only. |
| `execution-profile` says "a profile SHALL hold at most three fields", and every profile field owes an unset at every layer. | Putting limits in the profile is a MODIFIED delta on a capability `execution-profile-planning-and-light-roles` is also changing in 0.52.0 (D3). |
| `set-autonomy --revoke` keeps a revoked grant in the record. | The override's inverse follows that precedent (D6). |

## Goals / Non-Goals

**Goals**

- Count gate rounds durably, from this release forward.
- Make "stuck" a mechanical signal with one check verb, one exit code and one brief line.
- Name who to hand the failure to.
- Leave every hot path as cheap as it is now, and leave a repo that configures nothing unchanged
  except for the counter.

**Non-goals**

- Dispatching, killing or throttling anything. pm is an instruction layer.
- Per-test failure tracking. The engine cannot see which test failed in a fix round. The ledger round
  on `phase=build` markers is a possible later signal (see Open Questions).
- Repeated failing `certify` per epic. A certify run is bound to the index, not to an epic, so there is
  nothing to count against. This is a declined deferral at archive.
- A money budget (`spend-ledger` D11: no price table).
- Charging unattributed spend to an epic.

## Decisions

### D1. Count consecutive FAILED rounds, not recorded rounds

`epic.gateRounds.gate<N> = {fails, passes, failStreak, lastVerdictAt}`, written inside
`recordGateReview()` in the same `saveState` as the verdict.

- **Why the streak, not the total.** This repo re-records passing verdicts routinely: "re-record Gate 2
  after docs, never withdraw", and the release candidate records Gate 2 for every member at one head.
  A total would trip healthy epics.
- **Why a pass resets.** A pass is convergence. Lifetime `fails` and `passes` are kept for the analysis
  epic.
- **Withdrawal does not decrement.** The round happened and the tokens were spent. Un-counting it would
  let a withdrawal launder a loop.
- **No backfill.** One superseded entry cannot say how many rounds came before it. A fabricated count
  is worse than an honest zero, and the report says when counting started.
- **Rejected: a separate `record-round` verb.** It is one more thing the agent must remember, on
  exactly the path where it already forgot to record the fails.

### D2. The rounds signal is max(recorded fail streak, ledger review rounds since the last pass − 1)

- The ledger side counts the DISTINCT `round` values on the epic's attributed `phase=review` rows
  timestamped after its latest recorded `pass` (any gate), minus one. Four review rounds with no pass
  means three did not converge, which is comparable to a fail streak.
- **Why "since the last pass".** The marker carries no gate. Without a reset, Gate 1 taking three
  rounds and then passing would leave the epic tripped through Gate 2 forever, which is the same
  failure D1 rejects lifetime totals for (Gate 1 review finding). A recorded pass is the one
  convergence event state holds, and rows carry `at`.
- **Why distinct values, not the max.** A marker sequence that restarts its numbering after a pass
  (round 1 again for Gate 2), or continues it (round 4), counts the same way.
- Rows go through `attribute()`, so a marker naming an unknown epic or an invalid phase counts for
  nothing. This change's own Gate 1 dispatch was marked `phase=gate-1`, which is not in
  `KNOWN_SPEND_PHASES`, so it lands as `invalid-marker`; the rules section therefore repeats the
  exact `phase=review round=<n>` form.
- **Rejected: the ledger alone.** That would make the stuck-loop half depend on an opt-in that is off by
  default. Rob's handoff puts the stuck-loop half first.

### D3. Limits are a separate three-layer cascade, not profile fields

Storage: `state.spendGuard`, `state.laneSpendGuards[<lane>]` and `epic.spendGuard`, each
`{maxFailedRounds?, tokenCeiling?, warnAt?}`. The resolver mirrors `execution-profile.mjs`'s
`resolveField`:

- most specific valid layer first
- an invalid stored value is ignored and reported
- a detour has no inherited layer

The shared helper is exported rather than copied, so the two cascades cannot fork.

- **Why not profile fields.** The profile's "at most three fields" requirement, its per-layer unset
  list (`parseUnsetField`) and `profile`'s output are all being changed by
  `execution-profile-planning-and-light-roles` in the same release. A fourth field would be a MODIFIED
  delta on a capability two changes edit at once. The cross-spec review (task 0.2) names this
  chokepoint whichever way it goes.
- **What it costs.** `profile` does not show the limits; `spend-guard` does, with each layer's source.
  This is put to Rob as a decision (proposal discussion, tasks 0.3).
- **Rejected: a single project-level setting.** The budget an epic needs varies by lane and by size,
  and the epic text says "set in the profile layers".

### D4. Defaults: no limit, `warnAt` 80

- No `maxFailedRounds` and no `tokenCeiling` ship as defaults.
  - A token figure would be an invented number.
  - A default rounds limit would change `record-gate-review`'s output for every user on upgrade.
- The `OPT_INS` row advertises the rounds limit, and `upgrade` prints it as `NOT SET`.
- `warnAt: 80` is a convention for when to start warning, not a measured threshold. It is configurable
  and documented as such.
- Recommended for this repo after the build (task 6.2): `set-spend-guard --max-failed-rounds 2`. Two
  is one more than the release-candidate rule "one round; only a Critical reopens it", and far below
  0.51.0's seven Gate 1 rounds.

### D5a. Which tree's record the guard reads

The tally, limits and overrides are read from the `state.json` of the tree the verb runs in. That is
the file `record-gate-review`, `set-spend-guard` and `override-spend-guard` write there, and the file
the brief reads. Only the tracking switch and the ledger come from the main working tree, as `spend`
reads them (`spend-command.mjs` `mainState`, exported for this). Reading guard state from the main
tree made the four surfaces disagree inside a linked worktree, whose committed `state.json` is a stale
copy (Gate 1 Critical). In this repo the orchestrator records in the main tree, so both agree there.

### D5. At the limit: STOP surfaces, never a refused verdict

| Surface | Reads | When |
|---|---|---|
| `spend-guard <id>` | state; with tracking on, ingest then ledger | the agent runs it before each review or fix dispatch, as the rules section says; exit 2 = STOP |
| `record-gate-review` stderr | state only | an accepted verdict leaves the recorded part tripped |
| SessionStart/PreCompact brief | state only (already loaded) | the active epic is tripped on recorded verdicts |
| `## Spend guard` rules section | state only | any limit is configured |

- **Why not refuse the next verdict.** A recorded fail is evidence. CLAUDE.md "Reporting" item 1 says
  a recorded fact is not output and must not be shortened. Refusing it would push the agent to stop
  recording fails, which is how the 0.51.0 loop went unseen.
- **Why exit 2.** Exit 1 is the engine's usage or refusal code. A distinct code lets a scripted check
  tell "stuck" from "wrong arguments". It is declared as a named constant beside
  `CONFLICT_EXIT_CODE` in `constants.mjs`. Exit 2 is also Claude Code's hook "block" code, so
  `commands/spend-guard.md` says never to wire `spend-guard` into a hook.
- **A ledger that cannot be read is not a refusal.** An unreadable `enabledAt`, a held `ingest.lock` or
  a detached main HEAD makes `spend` refuse with exit 1. A per-dispatch check that exits 1 would read
  as "wrong arguments" and the loop would continue, so `spend-guard` reports the ledger side
  `not-read` with the reason and still applies the recorded-verdict check and the 0/2 rule.
- **The brief sees only part of the signal.** The ledger is never read on a hook path, so the brief can
  miss a ledger-only trip. The rules section's per-dispatch `spend-guard` call covers that. The
  limitation is stated in `commands/spend-guard.md`.
- **Autonomy.** The STOP text says it is a stop autonomy does not bypass. That text lives in the guard's
  own section and STOP block, not in the epic-autonomy decision rule, so `epic-autonomy` is not
  modified. The decision rule's step (d), "no context to act on → STOP", already covers a stop that
  needs a decision.

### D6. Override = recorded escalation plus a new baseline; revoke = recorded, not deleted

- **Accepted only while the signal is tripped.** An override given in advance would be a
  pre-authorization to loop, and that is what this guard exists to prevent.
- **`--escalated-to` is required.** The point of the stop is that someone other than the same-tier
  retry decided, and the record says who.
- **Baseline = the count at override time.** The guard trips again after `limit` more rounds, or after
  another ceiling's worth of tokens.
- **A later pass spends a rounds override.** A pass resets the streak the baseline was measured
  against; a surviving baseline would let twice the limit in fails pass unseen (Gate 1 finding).
- **The override cannot be a same-tier retry in disguise.** `--escalated-to` must rank at or above the
  computed target (D7). When the target is `user`, or a live model override already exists for that
  signal, only `user` is accepted, so trip, override, trip cannot repeat without a person. No
  autonomy grant covers `override-spend-guard`, and the rules section says so: an override is the
  escalation decision, and pre-authorizing it would remove the stop the guard exists for.
- **A tokens override needs tracking on.** Without the ledger there is no count to baseline. The token
  signal is `not-checked` then, so there is nothing to override.
- **Revoke** follows `set-autonomy --revoke`: it marks the entry and keeps it. The baseline falls back
  to the previous live override.
- **Rejected: `--override` on `record-gate-review`.** That would mix acknowledging a stop into recording
  evidence, and add a flag to a verb whose flags the integrity checks read.

### D7. Escalation target

- The order is `KNOWN_MODELS` ranked `haiku < sonnet < opus < fable`. It is declared once, next to
  `KNOWN_MODELS`.
- Rounds escalate from the epic's resolved `review` model. Tokens escalate from its resolved
  `implement` model, which does most of the spending. If `execution-profile-planning-and-light-roles`
  adds roles, the mapping stays signal → role.
- `fable`, or no configured model, gives `user`. The block always also names `the user` as valid.
- **The engine checks the claim's rank, not the run.** It cannot know which model the agent actually
  ran (`execution-profile`: "never checks which model ran"), so `--escalated-to` is a recorded claim.
  It still refuses a claim below the target, because a same-tier claim is the loop this guard stops.

### D8. Inverses (required item 1)

| Write | Inverse | Note |
|---|---|---|
| `gateRounds` update on a verdict | none shipped | It is a record of events. A pass ends the streak, and an override is the operational "continue". A reset verb would erase the evidence the guard reads. |
| `set-spend-guard` field at any layer | `--unset <field>` at that layer | `all` clears a layer. |
| `override-spend-guard` | `--revoke --reason` | The entry is kept. |
| `OPT_INS` row / rules-block section | `--unset` of the last limit removes the section | A limit is `maxFailedRounds` or `tokenCeiling` on the project, a lane, or a non-archived epic. `warnAt` alone is not one. |

## Risks / Trade-offs

- **[Risk] Agents keep forgetting to run `spend-guard` before dispatch.** → The recorded-verdict half
  also surfaces on `record-gate-review` and in the brief, without the agent asking. Only the ledger-only
  half depends on the per-dispatch call.
- **[Risk] Markers carry the wrong round** (for example, a resumed session restarts at 1). → The signal
  takes the max over the epic's rows, so a restart cannot lower it. A wrongly high round trips early,
  which is the safe direction, and an override clears it.
- **[Trade-off] `spend-guard` with tracking on runs an ingest**, and on a long-lived repo the first one
  can be slow. → `--no-ingest` reads the ledger as it stands, and the report says it did not ingest.
- **[Risk] A release-candidate merge commit's review is window-attributed** to the active epic
  (`spend-ledger` Risks). → The token signal reads only attributed totals, and prints coverage next to
  them.

## Migration Plan

- No state transform. Every field is additive and optional, and absence reads as zero or no limit.
- `upgrade` lists the opt-in.
- Rollback: `set-spend-guard --unset all` at each layer that has a value. `gateRounds` stays as a
  harmless record.

## Open Questions

- Should `phase=build` marker rounds feed a "fix rounds" signal? It needs the marker convention to say
  what a build round is. It does not change these specs, and belongs to
  `token-spend-analysis-and-recommendations`.
