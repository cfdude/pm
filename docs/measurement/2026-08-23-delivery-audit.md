# Retrospective delivery audit — 2026-08-23

**49 archived OpenSpec-lane epics · 8 repositories · 3 independent auditors, read-only.**

Companion to `2026-08-23-conductor-fleet-census.md`. The census asked *what does the conductor
record?* This asks *did what shipped match what was specified?* — and, more usefully, **how does
drift happen**, so behavioral tests can be written from the taxonomy rather than from intuition.

Highway repositories excluded (trust boundary). No tests were executed anywhere; every claim below
is spec text, a diff, or HEAD source.

---

## The headline: absent-edit

**A rule applied at one call site while an identical sibling goes untouched.** It is the dominant
defect class in all three shards, found independently by three auditors who did not share notes.

| Shard | Fix commits classified | absent-edit share |
|---|---|---|
| personal-finance | 32 | 8 commit-level **+ 5 whole epics** |
| personal-finance-paper | 26 | 11 (6 caught pre-code at Gate 1) |
| six small repos | ~92 instances | ~38 — dominant in 11 of 16 epics |

Two refinements over the original framing in #115:

1. **It is under-counted at commit granularity.** Five entire epics in one repo exist only to
   finish an earlier epic's rule. Absent-edit is not a review miss; it is a recurring *unit of work*.
2. **The gates find the first of a pair and stop.** Every auditor reported this independently —
   *"a reviewer who then stopped at the one call site in front of them."* In `agent-dm`, two
   independent reviewers hit the same function, the same class, the same day: round 1 closed a
   fail-open on the literal branch, round 2 reopened it on the glob branch.

The most vivid case is `virtual-mic/push-to-talk-keypress`: the same seam was missed **three
times**. The receiver wiring and the state sink were both attached to `activate(role:)` and both
absent from `handleIncomingConnection`, which builds a new session. On hardware the peer decoded
all three toggles and synthesized **zero** key events. The third fix commit names the class itself:
*"same seam-drift class as the RD wiring and the state sink above."*

---

## The most actionable finding: prose rules do not propagate

Measured in `personal-finance-paper`, same config file, same author, same period:

| Rule form | Adoption in subsequent changes |
|---|---|
| Added to `openspec/config.yaml` **with a mandatory `tasks.md` section** | **14 / 14** |
| Added to the same config as a **prose bullet**, no task | **3 / 15** |

**A prose instruction is ~20% effective. A task-bearing one was 100% in this sample.**

This is the concrete answer to "how do we make the instruction layer better." It is not better
wording. It is whether the rule creates a task. Every remedy proposed from this audit must ship as
a task, not a sentence — including #115's own completeness step, which was originally drafted as
prose and has been corrected on that basis.

---

## Gate effectiveness — and why the 14% number was unsound

The census reported **7 of 49 archived openspec epics carry a passing Gate 2 (14%)**. The audit
invalidated that metric **in both directions**:

- **Recorded, but not what it implies.** `virtual-mic/push-to-talk`'s recorded Gate 2 is the
  *re-review after the feature broke on hardware*, not the pass that preceded shipping.
  `job-search-agent/matching-pipeline`'s two gate records were written **83 seconds after the
  squash-merge, 47 ms apart, no notes**.
- **Unrecorded, but real.** `knowledge-store` has `gateReview: null` throughout, yet gates ran, are
  legible in commits, and Gate 1 caught a scope inversion that would have shipped a no-op epic.
- **Recorded over the wrong range — in this repo.** `platform-parity-mechanism`'s Gate 2 note
  records `d168b1e..04c54c8` and cites fixes `c63efc1` and `3cba2e9`. Both are **descendants** of
  that range (`git merge-base --is-ancestor` → false for both). The verdict does not cover the code
  its own note cites.

Filed as #122. The honest reading of the field: **`gateReview` records an intention to have
reviewed, at an unverified time, over an unverified range.**

### What the gates actually do, when they run

- **Gate 1 is where quality is made.** 13 of 15 epics in `personal-finance-paper` carry a
  spec-amending Gate 1 commit; 4 carried a Critical. Gate 2 produced only Minors there.
  **The spec was wrong on first draft nearly every time.**
- **The most repeated Gate 1 Critical is "the proposal cites a file or consumer that cannot do the
  job"** — a design naming a report-only module as the thing that will persist a finding, or a
  consumer that calls a different method entirely. Seen three times in one repo. **Mechanically
  checkable:** assert every path a proposal names exists and contains the symbol claimed.
- **Gate 2 catches weak verification, rarely wrong behavior.** Its findings were tautological
  assertions (`assert not hasattr(client, "get_account")` over `object()` fakes — passes no matter
  what the code does) and un-swept second call sites.
- **Gates also introduce defects.** In `personal-finance`, 9 of 32 fix commits are Gate 2 output,
  and one Gate 2 commit *manufactured* the defect a later epic existed to undo: a new
  `expires_in <= 120s` threshold against an authlib leeway of 300s, appearing in no artifact of the
  epic under review. Review output is not checked against the spec.

---

## Outcomes

| Outcome | personal-finance (18) | pf-paper (15) | six repos (16) | Total |
|---|---|---|---|---|
| delivered-as-specified | 8 | 11 | 9 | **28** |
| scope-dropped | 3 | 2 | 4 | **9** |
| scope-added | 3 | 1 | 2 | **6** |
| superseded | 4 | 0 | 1 | **5** |
| killed-at-gate | 0 | 1 | 0 | **1** |
| unverifiable | 0 | 0 | 0 | **0** |

`killed-at-gate` is a class the method did not anticipate, and it produced the single best evidence
for gates in the corpus. `price-band-check-hardening` was proposed with 47 tasks and **dropped 13
hours later, no code written**, because Gate 1 found the proposed check would *invert safety* on the
autonomous exit path — a legitimate overnight gap-down reads out-of-band, the exit defers, and the
stop-loss silently never fires. Safe in production only because production exits are human-gated.

**The conductor records it byte-identically to the 14 changes that delivered** (#120).

---

## Verification inspects the wrong artifact

`orchestrator-build-at-install`: two commits each *claimed* to remove a file's code and **neither
staged it** — a `git add` with an explicit path list aborted on an already-`git rm`'d path. Tasks
ticked, gates green, tests passing, because all four layers inspected the **working tree** rather
than the diff. It then recurred *after* being written down in a commit message in the same epic.

Filed as #121. The check is one command — `git show --stat <sha>` — and needs no design decisions.

---

## Checkbox state is unreliable in both directions

In the `personal-finance` sample: **3 ticked tasks hid undone work** (one still defective at HEAD,
verified by executing the real renderer), and **all 3 unticked boxes were non-work** — two are
literally `run /opsx:archive <this change>`, a task that cannot be ticked before the thing that
ticks it.

Errors are asymmetric toward over-reporting completion. Four epics in `pm` itself are archived with
**0 of 99** and **0 of 16** boxes ticked, rendering a silent `0/99`. Filed as #118.

---

## Deferrals are documented reliably and tracked almost never

Every archived design doc carries 1–5 prose deferral notes — "out of scope here", "latent caveat",
"recorded as a known follow-up". The discipline is being followed and the prose is good.

**Zero survive into the durable main specs. Two of ~40 became registered epics.** Verified still
live months later: a `harvest_pct or` zero-fall-through at `sync_portfolio.py:598` while line 92
carries the fixed form; a stale `CheckConstraint` at `models/trades.py:69` rejecting the very values
its column was widened to hold.

Filed as #119. A deferral is a queued epic with unusually good provenance, and no verb turns one
into one.

---

## The conductor's own record is incomplete and duplicated

- **Archived changes invisible to the conductor:** 8 in `personal-finance` (24 on disk, 16 indexed),
  16 in `personal-finance-paper`, 12 more across `job-search-agent` and `virtual-mic`. #117.
- **`lane == "openspec"` undercounts by ~22%** — changes that went through the full OpenSpec
  workflow while labelled `external`, `claude-code`, `decision`, or `superpowers`.
- **Four `pm` epics are registered twice, under two lanes**, only one carrying a TOMBSTONE note.

Any effectiveness measurement computed from conductor state is therefore computed over a sample
that systematically excludes the changes nobody was tracking — unlikely to be a random subset.

---

## A mechanical cause for drift going unlinked

`cfdude-plugins/add-hierarchy-and-tracker-awareness` shipped `update-epic` as the write-back
primitive **with no `--link` flag**. Until 0.9.3 there was no CLI path to attach a backlink after
epic creation — you could only link at `add-epic` time, before you know what a later bug repairs.

Result: **all 7 related epics carry `links: []`.** Drift gets re-registered as a brand-new epic
instead of counted against the original. The cause is mechanical, not disciplinary — the epic that
introduced epic links made itself unlinkable to its own repairs.

---

## Behavioral tests this audit earns

Ranked by objectivity. Every one can fail against today's engine.

1. **Files claimed by a task appear in that task's commit** (#121) — no judgment call in scoring;
   observed recurring after being described.
2. **A rule introduced at one call site is asserted at all call sites** (#115) — must ship as a
   required task, not prose, per the 14/14-vs-3/15 measurement.
3. **A gate verdict's recorded range contains the commits its note cites** (#122, needs #113).
4. **A gate recorded after the merge commit, or seconds after the prior gate, is bookkeeping** (#122).
5. **Every path a proposal names exists and contains the symbol claimed** — the most repeated
   Gate 1 Critical.
6. **Archive is refused when the plan source has zero ticked boxes** (#118, #110).

---

## Premise corrections

The auditors corrected the brief four times; recorded because a method that never contradicts its
own framing is not being run honestly.

- **No epic was unverifiable.** The method predicted ~5; the actual count is 0. Archive-less epics
  resolved via successor artifacts.
- **"pm has 5 absent-edit instances"** — the true count is ~13 in `personal-finance` alone, and
  **0 of pm's own 5 fall inside the three audited pm ranges**, so shard 3 is corroboration of an
  existing list, not independent convergence.
- **The lane-mismatch framing was one-sided.** openspec-labelled-with-superpowers-artifacts is
  2 cases; the dominant direction is the inverse — 12 OpenSpec changes with no openspec-lane epic.
- **"agent-dm and virtual-mic are the only non-pm repos with a gateReview"** — false;
  `job-search-agent` has one, and it is the most damning in the corpus.

---

## Could not verify

- **Runtime behavior anywhere.** No suite was executed. Test-count claims ("250/250", "301/301")
  were checked against static `test(` / `def test_` counts — consistent, not reproduced.
- **Reviewer identity or rigor at any gate.** Nothing records who reviewed or what was examined.
  Two-to-four-minute gate windows are bounded only by commit timestamps.
- **Whether out-of-band reviews happened** where no commit artifact exists. Absence of a commit is
  not absence of a review.
- **Whether long-standing deferrals are deliberate backlog or forgotten.**
- **8 approval-routing fix classifications** in `personal-finance` rest on commit message plus
  `--stat`, not full diffs.
