# `integrity` — the day-one finding set for `cfdude/pm`

Produced by executing `node scripts/conductor.mjs integrity` against this repository's own
`.conductor/state.json` on **2026-08-25 at `e282599`**. Every finding below is **explained**, not
counted: counting alone is what let a check measure nothing in the first place.

**Read this first — the record measured here is UN-MIGRATED.** The 0.27.0 migration and the archive
backfill ship in this release but have not been applied to this repository yet (`pmVersion` is still
`0.26.0`, and `/pm:upgrade` is a per-repo command the user runs after the plugin updates). So no epic
here carries a disposition, and the scope rule's two exclusions currently exclude nobody. After the
upgrade, the same checks report the same findings: the migration stamps `unknown` on every archived
epic, and `unknown` stays in scope by design.

**15 checks, 11 findings.**

**Re-measured 2026-08-27** when `recorded-sha-the-repository-cannot-resolve` was added for #142,
and again when `delivered-release-epic-left-open` was added for #137 and
`superseded-epic-never-ended` alongside it (gh-112's deferred follow-up).
**Re-measured 2026-08-29** when `link-of-unknown-type` was added for #100, and again when
`advisory-claim-shape` was added for #84 — see its section at the end. The count of checks
moved; no finding did.
The count of checks moved; no finding did. This document is the living record of what the audit
reports, not a snapshot of one afternoon — a check added later that nobody wrote down here is a
check whose result nobody wrote down at all, which is the failure the document exists to end.

---

## `archived-with-zero-ticked-tasks` — 5 findings

An archived epic whose task source exists and contains checkboxes, none of them ticked.

| Epic | Progress | Explanation |
|---|---|---|
| `2026-07-14-epic-hierarchy-orchestration` | 0/17 | The date-prefixed **superpowers** registration of a change also held as `epic-hierarchy-orchestration` (decision lane). The plan file was registered as an epic in its own right by #64/#69; the work was tracked under the un-prefixed epic, so this plan's boxes were never anybody's to tick. Also reported by the dual-lane check. |
| `2026-07-21-conductor-mjs-module-split` | 0/99 | Same shape — the superpowers duplicate of `conductor-mjs-module-split` (openspec lane), which carries the real record including a passing Gate 2. |
| `2026-07-26-edd-harness-agent-behavior-testing` | 0/37 | Same shape — the superpowers duplicate of `edd-harness-agent-behavior-testing` (decision lane). |
| `2026-07-29-platform-aware-rules-block` | 0/34 | **Not a duplicate.** No sibling epic exists under any lane. The work shipped — the platform chain (`PLATFORM_RULES_CHAIN`, `resolvePlatform`) is in the engine and 0.24.0's migration stamps `platform` — but nobody ticked the plan's checkboxes as it went. This is the plain over-reporting-completion case: a delivered change whose record says nothing was done. |
| `2026-08-18-state-write-conflict-guard` | 0/39 | **Not a duplicate**, and archived during this change's own session. The guard shipped in 0.26.0 (`saveState`'s revision comparison, `CONFLICT_EXIT_CODE`, the contention latch); the plan's boxes were never ticked. |

The last two matter most: they are live candidates that are **not** artifacts of another finding, so
this check earns its place independently of the dual-lane check below.

---

## `change-registered-under-two-lanes` — 4 findings

Two epics whose ids are equal after stripping a leading `<YYYY-MM-DD>-` prefix, held under different
lanes. Identity is the stripped id: **zero** ids in this repository collide literally, so a
literal-equality check would report none of these while four exist.

| Change | Registrations | Explanation |
|---|---|---|
| `epic-hierarchy-orchestration` | `epic-hierarchy-orchestration` (**decision**) + `2026-07-14-…` (superpowers) | #64/#69 — `sync` registers every `.md` under `docs/superpowers/plans/` as an epic, including the plan for a change already registered under another lane. |
| `conductor-mjs-module-split` | `conductor-mjs-module-split` (**openspec**) + `2026-07-21-…` (superpowers) | Same. |
| `edd-harness-agent-behavior-testing` | `edd-harness-agent-behavior-testing` (**decision**) + `2026-07-26-…` (superpowers) | Same. |
| `platform-parity-mechanism` | `platform-parity-mechanism` (**openspec**) + `2026-08-03-…` (superpowers) | Same. |

The lanes are read from the record, not assumed uniform — **two of the four hold `decision`**, not
`openspec`, on the un-prefixed side. All four are the same deferred bug, which is why the finding
names #64/#69 rather than inviting a per-pair investigation. When that bug lands, these four
disappear on their own; a machine-readable "deliberate" field to suppress them was proposed and
ruled out as schema invented to quiet a symptom.

---

## `archived-openspec-epic-with-no-gate-1` — 2 findings

| Epic | Explanation |
|---|---|
| `conductor-mjs-module-split` | Its Gate 2 note records a final whole-branch review over `7061d07..a4f6db7` with 250/250 tests passing, so an implementation review demonstrably happened. No `gate1` was ever recorded — the spec review either did not happen or was never written down. |
| `platform-parity-mechanism` | Same shape: a fresh-context Gate 2 over `d168b1e..04c54c8`, no `gate1`. |

`multi-tracker-primary-secondary-support` is the third and only other epic with a passing Gate 2, and
it is correctly **absent** — it carries a `gate1` whose note enumerates 1 Critical and 5 Important
findings fixed before the pass. So the practice existed; it was applied to one of three changes and
recorded for one of three.

---

## The checks with zero findings — and why each zero is real

A check that reports nothing is still a check that ran. Each of these has a *reason* it cannot fire
on today's record, and each reason is checkable rather than asserted.

| Check | Why zero |
|---|---|
| `verdict-range-omits-cited-commits` | **No verdict in this repository carries structured `baseSha`/`headSha` fields.** This release introduces them and forbids rewriting the three legacy verdicts, so the live instance the spec cites — `platform-parity-mechanism`'s Gate 2 note citing `c63efc1` and `3cba2e9`, both descendants of the `d168b1e..04c54c8` it records — exists only as prose in a note, and the check never mines a range out of prose. It is reproduced as a fixture and evaluated against this repository's real git history, where those two hashes are verifiably not ancestors of `04c54c8`. |
| `gate-recorded-as-bookkeeping` | **Arm 1 finds nothing**: it needs an UNEVIDENCED verdict, a merge commit (the last hash in an epic's attribution array), and a `reviewedAt` after it. As measured on 2026-08-23 no epic had attributed anything at all. `conductor-tells-the-truth` has since attributed its own commits *and* recorded its own Gate 2, so the arm now has a real population — and **that is how the arm's original form was found to be wrong**. It fired, correctly per its own predicate, on the release's own honest verdict: attributing each commit as it is made and recording Gate 2 afterwards make `reviewedAt > commitDate(last attributed)` universally true for a correctly run gate, so the arm was firing on compliance. It was narrowed to exempt a verdict carrying `baseSha`/`headSha` (see the gate-integrity delta's scenario "An evidenced verdict recorded after the last attributed commit is not a finding"); the audited instances are unevidenced by construction, so the signal is unchanged. (`gh-132-lessons-advisor-hook` carries an *empty* array because it was created under this release; empty names no merge commit.) **Arm 2 finds nothing**: exactly one epic holds two gate verdicts, and it recorded them **22 minutes apart** — a spec review and an implementation review, which is what the arm's 60-second bound is calibrated to distinguish from bookkeeping. |
| `heal-archived-epic-passed-gate-2` | **No epic carries the `archive-drift-heal` stamp.** After the migration every pre-existing archived epic will be stamped `recordedBy: "migration"` instead, so this check is aimed at epics archived *from here on*, where the heal flips a status after a real Gate 2 was recorded. |
| `delivered-epic-attributed-no-commits` | **No archived epic carries an attribution array at all** — the migration is forbidden from adding one, so every pre-existing epic reads *absent* (unverifiable) rather than *present and empty* (asserts nothing was attributed). The one epic with `[]` is `queued`, not delivered. |
| `archive-directory-has-no-epic` | This repository holds exactly **one** directory under `openspec/changes/archive/` — `2026-07-19-multi-tracker-primary-secondary-support` — and it is registered. The zero comes from the directory being held, not from there being none to check. |
| `dangling-epic-reference` | **Every epic id this record names resolves to an epic it holds.** The check reads its holders from `epicReferences()` — `links[]`, `parent`, `disposition.carriedTo`, `deferralAssertion.deferrals[]`, a release's `deferred[]`, `state.active` and both epic ids on every detour-stack frame — so the zero is measured across all of them, not across the one that was reported. It was added after the day-one measurement, alongside the `remove-epic` sweep that stopped leaving them behind; the count is a live re-measurement, not a copy. |
| `recorded-sha-the-repository-cannot-resolve` | **All 35 recorded shas resolve here and every one is reachable from a ref.** That zero is not luck and it is not the natural state: measured immediately after 0.28.0 merged, all 36 recorded shas were reachable from *nothing* — a squash-merge orphans every commit on the branch, and squash is this repo's only permitted merge. They are reachable today because #143 made `pr-workflow` tag the pre-squash tip before merging, so 32 of the 35 are held by a `presquash/*` tag and by nothing else. Delete those tags and this check reports 32 findings on its orphaned arm. **The zero is measured against the fix, not against the absence of the problem.** In CI the same zero comes from the other direction: `actions/checkout` fetches one ref, so none of the 35 resolve, and the probe correctly reads that as "this clone lacks the history" rather than "the evidence was destroyed". |
| `delivered-release-epic-left-open` | **This repository holds one release, `0.27.0`, and every one of its 21 members is `archived`.** The zero is the *discharged* form of the finding this check was written from, not the absence of one: at the moment #137 was filed the same twenty epics were `queued` under a release whose change had archived `delivered`, and the check would have named all twenty. They were then given their dispositions by twenty hand-run `update-epic` calls, which is exactly what a cleared finding looks like. The four epics `0.27.0` deliberately cut — `gh-114`, `gh-66`, `gh-64`, `gh-69` — are correctly absent for a *second* reason: they are in the release's `deferred[]`, and `--defer` also cleared their membership pointer, so they are not members either. |
| `superseded-epic-never-ended` | **No epic in this repository holds a `supersedes` link.** Measured across all 148 epics: the link types actually in use are `relates-to` (22), `depends-on` (16) and `blocks` (4), and `supersedes` (0). The vocabulary shipped with gh-112's intake/triage layer and nothing has consolidated a pair through it yet — so the zero is "the declaration has never been made here", not "consolidations are being ended correctly". The first `--link "supersedes:<id>:<why>"` written in this repo puts a candidate in front of this check. |
| `link-of-unknown-type` | **Every link type stored in this repository is in the known set.** Measured 2026-08-29 across every epic: the types in use are `relates-to`, `depends-on` and `blocks`, and all three are known — so the zero says the vocabulary matches this record, not that the check cannot fire. It fires readily elsewhere: gh#100 was filed from a live repo holding `relates` (36), `resolves-blocker-for` (2), `parent` (2) and `may-invalidate` (1) with **zero** `depends-on`, which is the state this check exists to name. The zero here also has a second, weaker cause worth stating: `--link` is written by hand rarely in this repo, so the population is small. |
| `archived-with-no-gate-2-review` | **No epic carries an `ungated` Gate 2.** Only the archive-drift heal writes that verdict, and it writes it only where an openspec-lane epic reaches `archived` with no `gate2` at all; the three epics that have a `gate2` all carry `pass`. The backfill and the two archived-at-creation paths are forbidden from writing a `gate2` entry, which is what keeps this from becoming a permanent, unclearable condition against every historical change. |

---

## Differences from the enumeration recorded in `tasks.md` on 2026-08-23

Both are explained rather than silently absorbed.

0. **Ten checks, not nine.** `dangling-epic-reference` was added while fixing the BLOCKS that tasks 16.1 and 16.2 found, when
   `remove-epic` was found to strip only `links[]` while group 14 had added three more places the
   record holds an epic id. It is the sibling of `archive-directory-has-no-epic` — a reference that
   resolves to nothing — and reports 0 here.
1. **Nine checks, not eight.** Task 9.14's enumeration lists 9.3, 9.4, 9.5, 9.6, 9.9, 9.10, 9.11 and
   9.12. The ungated-archive condition (9.13) is surfaced as an integrity **check** as well as a
   briefing notice, because `gate-integrity` requires it to be named "wherever the conductor reports
   its own integrity" and the briefing is not the only such surface. It reports 0.
2. **One epic acquired an empty attribution array during the release.** On 2026-08-23 no epic carried
   `attributedCommits` in any form; `gh-132-lessons-advisor-hook` was registered mid-release and
   `add-epic` seeds `attributedCommits: []` at creation, deliberately, because absent and empty are
   different claims. It changes no finding: the array is empty and the epic is `queued`.

Every finding count — 5, 4, 2, and ten zeros — matches the 2026-08-23 measurement. The seventh
zero is `dangling-epic-reference`, added while fixing what tasks 16.1/16.2 found; the eighth is
`recorded-sha-the-repository-cannot-resolve`, added on 2026-08-27 for #142; the ninth and tenth are
`delivered-release-epic-left-open` and `superseded-epic-never-ended`, added on 2026-08-27 for #137;
the eleventh is `link-of-unknown-type`, added on 2026-08-29 for #100; the twelfth is
`advisory-claim-shape`, added on 2026-08-29 for #84.
None existed on 2026-08-23 and none changes a finding.

## `advisory-claim-shape` — 0 findings

Added 2026-08-29 with #84's advisory claim. Two shapes, and they are deliberately distinguished
rather than merged into one "bad claim" finding:

- **an EXPIRED claim** — the claim's own `ttlMinutes` has elapsed since `claimedAt`. This is
  ordinary, and it is exactly how a session that died mid-epic looks. Taking it over is a plain
  `claim` with no `--steal`.
- **a claim on an ARCHIVED epic** — a record that cannot be true. `update-epic --status archived`
  clears the claim, so one that survives was hand-edited or written by a state file older than
  that rule, and it renders as live ownership of work that has ended.

Zero here because the capability is new and this repository holds no claims. That is not a
vacuous zero: the check RAN, which is the distinction this whole document exists to preserve.
The reason it is an `integrity` check at all is that `owners` only answers when someone thinks to
ask, and a stale claim is by construction left behind by a session that is no longer there to
ask.
