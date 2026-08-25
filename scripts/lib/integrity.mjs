// scripts/lib/integrity.mjs
// READ-ONLY checks over the conductor's own record: shapes that cannot be true, reported with
// the epic they concern and enough detail to act on. May import constants.mjs,
// epic-progress.mjs, disposition.mjs and git.mjs — and nothing under those imports back up.
//
// REPORTS, NEVER REPAIRS. Nothing here writes state and nothing here blocks a command. That is
// not a stylistic preference: a check that repaired would be a second writer racing the paths
// that produce the records it reads, and a check that blocked would make an audit finding into
// an outage. The remediation for every finding below is a command a human or an agent runs.
//
// A check that finds nothing is still a check that RAN, and the report says so. A report that
// listed only its non-empty checks would be indistinguishable from a report whose empty checks
// had been quietly removed — and "the check measured nothing" is exactly the failure this
// capability exists to end.

import { isInitialized, loadState } from "./state.mjs";
import { epicProgress, strippedChangeId } from "./epic-progress.mjs";
import { gateHasEvidence } from "./constants.mjs";
import { commitDate, isAncestor } from "./git.mjs";
import { isArchiveBackfilled, outcomeOf, stampedBy } from "./disposition.mjs";

/** The outcomes that are their own explanation. Each carries a REQUIRED reason saying why the
 *  work did not complete, so an epic holding one is a record working rather than a record
 *  broken — the release's own flagship case is a change killed at Gate 1 with 47 tasks and no
 *  code written, which is zero-ticked by construction. */
const EXPLAINED_OUTCOMES = ["killed", "superseded", "abandoned"];

/** THE scope rule for the completion-shaped checks. Exactly two exclusions and nothing else.
 *
 *  `unknown` STAYS IN SCOPE, and that is the whole design. It is the value the engine stamps
 *  when nobody was asked, and its reason is a path name rather than an explanation of why the
 *  work did not complete — which is the property the two exclusions above actually rest on.
 *
 *  Scoping these checks to `delivered` instead would make them INERT, and that is measurable
 *  rather than arguable: this repository holds 69 archived epics and 3 carrying a passing
 *  Gate 2 (measured 2026-08-23), so after the migration that stamps `delivered` only where such
 *  a verdict exists, a `delivered`-only zero-ticked check has zero candidates in the very
 *  repository whose live data this rule cites as its evidence. */
export function inCompletionScope(epic) {
  if (EXPLAINED_OUTCOMES.includes(outcomeOf(epic))) return false;
  // A backfilled epic never passed through the conductor while it was in flight: it has no gate
  // verdict, no start time and — where the change was abandoned — no ticked tasks. Those are
  // properties of a record rebuilt from disk, not of a badly managed epic, and without this
  // exclusion the backfill's first run fills the report with findings against changes archived
  // long before the conductor could have guarded them.
  if (isArchiveBackfilled(epic)) return false;
  return true;
}

/** Are `a` and `b` the same commit written at different abbreviation lengths? */
const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/** The commit hashes a verdict's NOTE cites, minus the two the verdict already records as
 *  fields.
 *
 *  The range is read from `baseSha`/`headSha` and NEVER parsed out of the note — that prose
 *  dependency is exactly what the structured fields were added to remove. The note is read only
 *  for the hashes it MENTIONS, and the two field values are subtracted so a note that spells its
 *  own range out ("reviewed d168b1e..04c54c8") does not report its own base as uncontained.
 *
 *  A hex-looking token is not necessarily a commit: an 8-digit date, or an ordinary word like
 *  `defaced`, matches this pattern. Those are not filtered here — `isAncestor` answers `null`
 *  for a hash this repository has never seen, and only a definite `false` is reported. The
 *  three-valued answer is doing the filtering, deliberately, because the alternative is a
 *  cleverer regex that would still be guessing. */
function citedShas(entry) {
  const note = typeof entry.note === "string" ? entry.note : "";
  return [...new Set(note.match(/\b[0-9a-f]{7,40}\b/g) || [])]
    .filter(sha => !sameSha(sha, entry.baseSha) && !sameSha(sha, entry.headSha));
}

/** The registry. One entry per check: a stable `id` a reader can grep for, a one-line `title`
 *  saying what shape it looks for, and `run(state)` returning findings.
 *
 *  A finding is `{epic, detail}` — `epic` is the id it concerns (null where the finding is about
 *  something other than an epic, e.g. a directory), `detail` is the sentence a reader acts on.
 *  The shape is uniform so the formatter never special-cases a check, which is what keeps
 *  adding a check to one array from being a change to the reporting surface too. */
export const CHECKS = [
  {
    id: "archived-with-zero-ticked-tasks",
    title: "an archived epic whose task source exists and has nothing ticked",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (e.status !== "archived" || !inCompletionScope(e)) continue;
        const p = epicProgress(e);
        // Gated on `total > 0`, NEVER on `done === 0`. epicProgress() returns `{done: 0,
        // total: 0}` for an archived epic whose source is gone — the ordinary case for most of
        // them — so a `done === 0` test reports every source-less archived epic in the repo and
        // says nothing about any of them. `total > 0` means a real source with real checkboxes.
        if (p.total > 0 && p.done === 0) {
          out.push({ epic: e.id, detail: `archived at ${p.done}/${p.total} (source: ${p.source})` });
        }
      }
      return out;
    },
  },
  {
    id: "verdict-range-omits-cited-commits",
    title: "a gate verdict's note cites commits its recorded range does not contain",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        for (const gate of ["gate1", "gate2"]) {
          const entry = e.gateReview && e.gateReview[gate];
          if (!entry || !gateHasEvidence(entry)) continue;
          // Only a definite `false` — "git answered, and this commit is not reachable from the
          // recorded head". `null` means git could not answer at all, which is not evidence of
          // anything and must never be reported as a finding.
          const uncontained = citedShas(entry).filter(sha => isAncestor(sha, entry.headSha) === false);
          if (uncontained.length) {
            out.push({ epic: e.id, detail:
              `${gate} records ${entry.baseSha}..${entry.headSha} but its note cites commit(s) ` +
              `that range does not contain: ${uncontained.join(", ")}` });
          }
        }
      }
      return out;
    },
  },
  {
    id: "delivered-epic-attributed-no-commits",
    title: "a delivered epic with a passing Gate 2 whose attribution array is present and empty",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (outcomeOf(e) !== "delivered") continue;
        const gate2 = e.gateReview && e.gateReview.gate2;
        if (!gate2 || gate2.verdict !== "pass") continue;
        // PRESENT AND EMPTY, never absent. Absent means the epic predates the capability and
        // nothing can be concluded; empty means it was created under the capability and asserts
        // that nothing was attributed to it. This is precisely the shape of "the agent ignored
        // the --attribute-commit obligation", and without the check that unmet obligation leaves
        // no trace anywhere — the staleness gate behaves correctly on an empty array, so it
        // reports nothing either.
        if (Array.isArray(e.attributedCommits) && e.attributedCommits.length === 0) {
          out.push({ epic: e.id, detail:
            "recorded as delivered with a passing Gate 2 but attributed no commits — record " +
            `the range that shipped with: update-epic ${e.id} --attribute-commit <sha>` });
        }
      }
      return out;
    },
  },
  {
    id: "heal-archived-epic-passed-gate-2",
    title: "an epic the heal archived reads `unknown` while carrying a passing Gate 2",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (!stampedBy(e, "archive-drift-heal") || outcomeOf(e) !== "unknown") continue;
        const gate2 = e.gateReview && e.gateReview.gate2;
        if (!gate2 || gate2.verdict !== "pass") continue;
        // A `delivered`-shaped record wearing an `unknown` outcome. The heal is behaving
        // correctly — nobody supplied a disposition at the moment it flipped the status, and
        // `unknown` says exactly that — and the epic gets no `ungated` entry either, because it
        // already had a real verdict. So without this check the mismatch is visible nowhere.
        out.push({ epic: e.id, detail:
          "archived by the drift heal with a passing Gate 2 but no recorded disposition. This " +
          "is the ordinary end of the documented workflow, and the fix is the ordinary next " +
          `step: update-epic ${e.id} --status archived --outcome delivered --no-deferrals` });
      }
      return out;
    },
  },
  {
    id: "gate-recorded-as-bookkeeping",
    title: "a gate verdict recorded as bookkeeping rather than as review",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        const g1 = e.gateReview && e.gateReview.gate1;
        const g2 = e.gateReview && e.gateReview.gate2;
        // ARM 1 — the verdict is dated AFTER the work it reviewed had already merged. The merge
        // commit is defined as the LAST hash in the epic's attribution array, and where that
        // array is absent or empty this arm simply does not apply: every other reading of "the
        // merge commit" is either inert on all live epics or fires on essentially all of them,
        // and a check that fires on everything is a check nobody reads.
        const attributed = Array.isArray(e.attributedCommits) ? e.attributedCommits : [];
        const mergedAt = attributed.length ? commitDate(attributed[attributed.length - 1]) : null;
        for (const [gate, entry] of [["gate1", g1], ["gate2", g2]]) {
          if (!entry || !entry.reviewedAt || !mergedAt) continue;
          if (Date.parse(entry.reviewedAt) > Date.parse(mergedAt)) {
            out.push({ epic: e.id, detail:
              `${gate} was recorded ${entry.reviewedAt} — after the epic's merge commit ` +
              `${attributed[attributed.length - 1]} (${mergedAt}), so the verdict post-dates the ` +
              "work it claims to have reviewed" });
          }
        }
        // ARM 2 — two gates recorded within a minute of each other. A spec review and an
        // implementation review of the same change are never seconds apart; the audited instance
        // recorded both 47 ms apart, with no notes, 83 seconds after the squash-merge.
        if (g1 && g2 && g1.reviewedAt && g2.reviewedAt) {
          const apart = Math.abs(Date.parse(g1.reviewedAt) - Date.parse(g2.reviewedAt));
          if (apart <= 60_000) {
            out.push({ epic: e.id, detail:
              `gate 1 and gate 2 were recorded ${apart} ms apart — a spec review and an ` +
              "implementation review of the same change are never that close together" });
          }
        }
      }
      return out;
    },
  },
  {
    id: "change-registered-under-two-lanes",
    title: "one change id registered as two epics under different lanes",
    run(state) {
      // Identity is the DATE-PREFIX-STRIPPED id, the same normalization `isArchived()` applies.
      // Literal equality is the implementation that reads as coverage and measures nothing:
      // measured on this repository, ZERO ids collide literally while FOUR changes are
      // registered twice — so a literal check reports none of them while claiming four exist.
      const groups = new Map();
      for (const e of state.epics) {
        const key = strippedChangeId(e.id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      const out = [];
      for (const [key, members] of groups) {
        if (members.length < 2) continue;
        const lanes = new Set(members.map(e => e.lane || "openspec"));
        if (lanes.size < 2) continue;
        // The lanes are READ, never assumed uniform: of this repository's four pairs, two hold
        // `decision` rather than `openspec` on the un-prefixed side.
        out.push({ epic: key, detail:
          `registered ${members.length} times under different lanes: ` +
          members.map(e => `\`${e.id}\` (${e.lane || "openspec"})`).join(" and ") +
          // The known explanation, given alongside the pair. Every such pair in this repository
          // is the same deferred bug, and a reader who has to rediscover that for each one is
          // being handed a symptom instead of a cause. Naming it costs no new state — the
          // alternative considered was a machine-readable `deliberate` field, which would have
          // been a fifth disposition scope invented to quiet one check's output. When #64/#69
          // lands, these findings disappear on their own.
          " — likely cause: #64/#69, `sync` registering a finished plan file as a second epic" });
      }
      return out;
    },
  },
];

/** Run every check. Returns one entry PER CHECK, including the ones that found nothing. */
export function runIntegrity(state) {
  return CHECKS.map(c => ({ id: c.id, title: c.title, findings: c.run(state) || [] }));
}

/** The report, as text. One block per check, count first, then the findings. */
export function formatIntegrity(report) {
  const L = ["INTEGRITY — records that cannot be true.",
    "Findings are reported, never repaired: nothing here writes state or blocks a command.", ""];
  for (const { id, title, findings } of report) {
    L.push(`${id} — ${findings.length} finding(s): ${title}`);
    for (const f of findings) {
      L.push(`  • ${f.epic ? `\`${f.epic}\` — ` : ""}${f.detail}`);
    }
  }
  L.push("");
  L.push(`${report.reduce((n, c) => n + c.findings.length, 0)} finding(s) across ${report.length} check(s).`);
  return L.join("\n");
}

/** `integrity` — print the report. Exits 0 whatever it finds.
 *
 *  Deliberately does NOT call `render()`, which every other verb here does: render runs the
 *  archive-drift heal and SAVES, so an audit that rendered would write state on the way to
 *  telling you it writes none — and would do it against the live record of whatever repo is
 *  being audited. Read-only means the file is byte-identical afterwards. */
export function integrity() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  process.stdout.write(formatIntegrity(runIntegrity(loadState())) + "\n");
}
