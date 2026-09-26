# Baseline before implementation (task 1.1)

Measured 2026-09-25 at `fcdd11b` (the `dev` tip this change's branch fast-forwarded to), in the
implementation worktree, before any engine edit. Nothing here is copied from `design.md`: every
number below was produced by running the command named beside it on the day. The read-only script
behind (a), (e) and (f) is `measure.mjs` in the implementing session's scratchpad; it imports the
engine's own `epic-progress.mjs` / `disposition.mjs` / `constants.mjs` and writes nothing.

## (a) Archived openspec epics whose render moves off `0/0`

Scope: `status: archived`, openspec lane (absent lane read as openspec), not backfilled, no
`planPath`, no live `tasks.md`, and an archived `tasks.md` found by the one-resolver rule.

**17 epics**, every one rendering `0/0` today:

| epic | archived `tasks.md` | outcome |
|---|---|---|
| multi-tracker-primary-secondary-support | 21/21 | delivered |
| conductor-tells-the-truth | 114/114 | delivered |
| record-answers-for-itself | 61/61 | delivered |
| detached-head-is-not-a-workspace | 23/23 | delivered |
| **gate-verdict-withdrawal** | **53/54** | delivered |
| **archive-gate-reads-what-it-writes** | **46/47** | delivered |
| every-verb-refuses-what-it-does-not-read | 25/25 | delivered |
| state-file-refuses-to-guess | 48/48 | delivered |
| gates-bind-to-verified-evidence | 75/75 | delivered |
| commit-nudge-reads-the-whole-move | 52/52 | delivered |
| emitted-commands-run-as-written | 65/65 | delivered |
| user-text-never-forges-output | 55/55 | delivered |
| operations-ship-their-inverses | 42/42 | delivered |
| the-guard-covers-every-write-path | 44/44 | delivered |
| functional-assertion-test-split | 47/47 | delivered |
| unit-rung-and-fixture-snapshots | 40/40 | delivered |
| node-support-policy | 50/50 | delivered |

Outstanding work above zero once read: **2**, both `delivered` — `gate-verdict-withdrawal` (1 open)
and `archive-gate-reads-what-it-writes` (1 open). None of the 17 carries inline stories.

## (b) `node scripts/conductor.mjs integrity`, findings per check id

| check | findings |
|---|---|
| archived-with-zero-ticked-tasks | 0 |
| verdict-range-omits-cited-commits | 0 |
| archived-with-no-gate-2-review | 0 |
| archived-with-withdrawn-gate-2 | 0 |
| delivered-epic-attributed-no-commits | 0 |
| archived-openspec-epic-with-no-gate-1 | 2 |
| archive-directory-has-no-epic | 0 |
| heal-archived-epic-passed-gate-2 | 0 |
| gate-recorded-as-bookkeeping | 0 |
| change-registered-under-two-lanes | 4 |
| link-of-unknown-type | 0 |
| epic-in-undefined-status | 0 |
| dangling-epic-reference | 0 |
| self-referential-epic-id | 0 |
| empty-epic-id | 0 |
| grant-names-nothing | 0 |
| superseded-epic-never-ended | 0 |
| delivered-release-epic-left-open | 0 |
| recorded-sha-the-repository-cannot-resolve | 0 |
| tracker-repo-not-a-github-repository | 0 |
| advisory-claim-shape | 0 |

Total: 6 findings across 21 checks.

## (c) `node scripts/conductor.mjs unconsidered-outcomes`

`{"count": 0, "unconsidered": []}` — no entry, so no `deliveredBlockedBy` to record. D1/D2 can move
this set only through an archived epic stamped `unknown` by the engine; there is none.

## (d) Live-record tests

`rg -ln "liveState|\.conductor/state\.json" scripts/test` matches 33 files, nearly all of which
only name the path of a FIXTURE's state file. The tests that read THIS repository's own record are
the two that define `liveState()`: `scripts/test/functional/conductor-15.test.mjs` and
`scripts/test/functional/conductor-18.test.mjs`. Run together, targeted:
**98 tests, 98 pass, 0 fail.**

## (e) The missing-source warning under D2

A story no longer suppresses a missing checkbox source. Candidates: epics carrying `stories[]`
whose checkbox source is expected (a `planPath`, or openspec lane with an absent lane read as
openspec), unreadable at the live AND the archived location, and not archived (by status or on
disk). D2 removes a suppression and adds none, so no warning can disappear.

| repository | warnings that APPEAR | archived epics moving off `0/0` (a) | of which open |
|---|---|---|---|
| `~/Documents/Repos/pm` (this one) | 0 | 17 | 2 |
| `~/Documents/Repos/cfdude-plugins` | 0 | 1 | 0 |
| `~/Documents/Repos/knowledge-store` | 0 | 2 | 0 |
| `~/Documents/Repos/job-search-agent` | 0 | 2 | 0 |
| `~/Documents/Repos/agent-dm` | 0 | 4 | 0 |
| `~/Servers/market-intelligence` | 0 | 12 | 5 |

No flood: zero new warnings in six repositories, so 2.1 is not held. `market-intelligence`'s five
open archived epics (four `unknown`, one `delivered` at 38/39) are that repository's own records and
are reported, not corrected, here.

## (f) One-resolver disagreements

Over every archive directory name, its stripped id and every epic id in the record: the ids where
`isArchived()`, `archivedTasksPath()` and the one-resolver rule (latest date wins, undated below
dated) disagree today: **0** in this repository and in each of the five others. So
`reconcileArchived()` would write nothing differently under the resolver on any of them. 1.2 still
adds the two-dated-directories and dated-id cases, because the disagreement is reachable even
though no live record reaches it.
