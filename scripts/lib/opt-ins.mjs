// scripts/lib/opt-ins.mjs
// "Which opt-in capabilities has THIS repo never adopted?" — the half of the upgrade review the
// changelog delta cannot cover (gh#210). `upgrade` step 2 reviews only the opt-ins a release ADDED,
// so one a repo skipped at an earlier release is invisible forever. Measured on the repo that filed
// it: 175 epics, upgraded at every release 0.16 -> 0.45, `laneRouting` still null — every
// `suggest-lane` and `triage` in ~14 hours returned null and the agent hand-picked each lane.
//
// THE REGISTRY BELOW IS THE LIST. `upgrade` prints from it and nothing else; a new opt-in is one
// row here, and `scripts/test/unit/opt-ins.test.mjs` fails if a row names a verb or command doc
// that does not exist. Imports constants.mjs, and spend-guard.mjs for the one "is a limit configured" predicate
// the spendGuard row asks (it was a constants-only leaf until that row; spend-guard.mjs reaches only constants.mjs and
// execution-profile.mjs, so no cycle runs back through here).
//
// ARCHITECTURAL LAW: this is a READ of `state.json` that EMITS INSTRUCTIONS. It enables nothing,
// opens no connection, calls no tracker. A repo that declines an opt-in loses nothing — the lines
// are information, printed every run, never a refusal and never a gate.

import { escapeControls } from "./constants.mjs";
import { guardConfigured } from "./spend-guard.mjs";

/** One row per opt-in. `isSet(state)` is the adoption test; `describe(state)` renders the adopted
 *  value; `missing` is what an unadopted repo is losing, in a clause; `command` is the adopting
 *  invocation as PRINTED and `example` the same invocation as a runnable argv (placeholders filled),
 *  which `assert/opt-ins.test.mjs` runs against the engine so a printed command cannot drift from
 *  the flags the verb reads (0.51: two rows printed bare positionals the engine refused). The claim
 *  row is deliberately NOT here: a claim is an epic's temporary advisory hold, not a repo setting,
 *  so "NOT SET" was true of every repo on every upgrade and told it nothing.
 *  `verb`/`doc` name the engine verb and `commands/<doc>.md` the test pins to reality. */
export const OPT_INS = [
  {
    id: "reviewMode", verb: "set-review-mode", doc: "review-mode",
    isSet: (s) => typeof s.reviewMode === "string" && s.reviewMode !== "",
    describe: (s) => `reviewMode: ${escapeControls(s.reviewMode)}`,
    missing: "reviewMode — every gate reviews at the default (standard), never tuned to this repo's risk",
    command: "set-review-mode --mode off|standard|thorough",
    example: ["set-review-mode", "--mode", "standard"],
  },
  {
    id: "laneRouting", verb: "set-lane-routing", doc: "lane-routing",
    isSet: (s) => ((s.laneRouting || {}).overrides || []).length > 0,
    describe: (s) => `laneRouting: ${s.laneRouting.overrides.length} override(s)`,
    missing: "laneRouting (0 overrides) — suggest-lane and triage return null for every ask",
    command: "set-lane-routing --add \"<match>:<lane>\"  e.g. --add \"migration:openspec\"",
    example: ["set-lane-routing", "--add", "migration:openspec"],
  },
  {
    id: "activityLog", verb: "set-activity-log", doc: "activity",
    isSet: (s) => !!(s.activityLog && s.activityLog.enabled === true),
    describe: () => "activityLog: on",
    missing: "activityLog — nothing records how the project got to its present state",
    command: "set-activity-log on",
    example: ["set-activity-log", "on"],
  },
  {
    id: "tracker", verb: "set-tracker", doc: "tracker",
    isSet: (s) => !!(s.tracker && s.tracker.system),
    describe: (s) => `tracker: ${escapeControls(s.tracker.system)}`,
    missing: "tracker — no external issue tracker is mirrored (only worth it if work is managed in one)",
    command: "set-tracker --system <system> (see /pm:tracker)",
    example: ["set-tracker", "--system", "github-issues"],
  },
  {
    id: "spendTracking", verb: "set-spend-tracking", doc: "spend",
    isSet: (s) => !!(s.spendTracking && s.spendTracking.enabled === true),
    describe: () => "spendTracking: on",
    missing: "spendTracking — no record of which epic, phase, role or model spent tokens",
    command: "set-spend-tracking on",
    example: ["set-spend-tracking", "on"],
  },
  {
    // spend-budget-and-stuck-loop-guard. A limit is `maxFailedRounds` or `tokenCeiling` at the project, at any
    // lane, or on any epic that is not archived (a `warnAt` alone is not one). No default ships, so a repo that
    // never configures one sees nothing but the always-on round counter.
    id: "spendGuard", verb: "set-spend-guard", doc: "set-spend-guard",
    isSet: (s) => guardConfigured(s),
    describe: () => "spendGuard: configured",
    missing: "spendGuard — a review loop that cannot converge runs until a person notices (no round limit, no stop, no one named to hand the failure to)",
    command: "set-spend-guard --max-failed-rounds <n>",
    example: ["set-spend-guard", "--max-failed-rounds", "2"],
  },
];

/** The lines `upgrade` prints, from `state` alone. One summary line of what IS adopted, then one
 *  line per opt-in that is NOT, each naming the command. Never empty: a repo with everything
 *  adopted still gets one line saying so, because silence and "reviewed, all adopted" must not
 *  look the same. */
export function optInLines(state) {
  const s = state || {};
  const set = OPT_INS.filter(o => o.isSet(s));
  const unset = OPT_INS.filter(o => !o.isSet(s));
  const summary = set.length ? set.map(o => o.describe(s)).join(" · ") : "none adopted";
  const lines = [`conductor: opt-ins — ${summary}`];
  for (const o of unset) lines.push(`conductor:   NOT SET: ${o.missing} → ${o.command}`);
  return lines;
}
