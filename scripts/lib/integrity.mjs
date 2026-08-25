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
import { epicProgress } from "./epic-progress.mjs";
import { isArchiveBackfilled, outcomeOf } from "./disposition.mjs";

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
