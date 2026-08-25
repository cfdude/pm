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

**10 checks, 11 findings.**

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

## The six checks with zero findings — and why each zero is real

A check that reports nothing is still a check that ran. Each of these has a *reason* it cannot fire
on today's record, and each reason is checkable rather than asserted.

| Check | Why zero |
|---|---|
| `verdict-range-omits-cited-commits` | **No verdict in this repository carries structured `baseSha`/`headSha` fields.** This release introduces them and forbids rewriting the three legacy verdicts, so the live instance the spec cites — `platform-parity-mechanism`'s Gate 2 note citing `c63efc1` and `3cba2e9`, both descendants of the `d168b1e..04c54c8` it records — exists only as prose in a note, and the check never mines a range out of prose. It is reproduced as a fixture and evaluated against this repository's real git history, where those two hashes are verifiably not ancestors of `04c54c8`. |
| `gate-recorded-as-bookkeeping` | **Arm 1 cannot apply**: no epic has attributed a commit, so there is no merge commit for a verdict to post-date. (One epic, `gh-132-lessons-advisor-hook`, carries an *empty* array because it was created under this release; empty names no merge commit.) **Arm 2 finds nothing**: exactly one epic holds two gate verdicts, and it recorded them **22 minutes apart** — a spec review and an implementation review, which is what the arm's 60-second bound is calibrated to distinguish from bookkeeping. |
| `heal-archived-epic-passed-gate-2` | **No epic carries the `archive-drift-heal` stamp.** After the migration every pre-existing archived epic will be stamped `recordedBy: "migration"` instead, so this check is aimed at epics archived *from here on*, where the heal flips a status after a real Gate 2 was recorded. |
| `delivered-epic-attributed-no-commits` | **No archived epic carries an attribution array at all** — the migration is forbidden from adding one, so every pre-existing epic reads *absent* (unverifiable) rather than *present and empty* (asserts nothing was attributed). The one epic with `[]` is `queued`, not delivered. |
| `archive-directory-has-no-epic` | This repository holds exactly **one** directory under `openspec/changes/archive/` — `2026-07-19-multi-tracker-primary-secondary-support` — and it is registered. The zero comes from the directory being held, not from there being none to check. |
| `dangling-epic-reference` | **Every epic id this record names resolves to an epic it holds.** The check reads its holders from `epicReferences()` — `links[]`, `parent`, `disposition.carriedTo`, `deferralAssertion.deferrals[]`, a release's `deferred[]`, `state.active` and both epic ids on every detour-stack frame — so the zero is measured across all of them, not across the one that was reported. It was added after the day-one measurement, alongside the `remove-epic` sweep that stopped leaving them behind; the count is a live re-measurement, not a copy. |
| `archived-with-no-gate-2-review` | **No epic carries an `ungated` Gate 2.** Only the archive-drift heal writes that verdict, and it writes it only where an openspec-lane epic reaches `archived` with no `gate2` at all; the three epics that have a `gate2` all carry `pass`. The backfill and the two archived-at-creation paths are forbidden from writing a `gate2` entry, which is what keeps this from becoming a permanent, unclearable condition against every historical change. |

---

## Differences from the enumeration recorded in `tasks.md` on 2026-08-23

Both are explained rather than silently absorbed.

0. **Ten checks, not nine.** `dangling-epic-reference` was added during task 16.3, when
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

Every finding count — 5, 4, 2, and seven zeros — matches the 2026-08-23 measurement, the
seventh zero being the check added after it.
