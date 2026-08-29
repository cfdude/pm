// scripts/lib/activity-report.mjs
// #111's READER. It ships in the same change as the writer, and that is a condition rather than
// a preference: "If the reader is not in the same release, this feature should not ship."
//
// A log nothing reads is a data graveyard — it costs write-path complexity, rotation, retention
// and a purge CLI, all paid immediately, and returns a benefit that stays speculative until
// something consumes it. This repository has already used that argument to DECLINE things
// (verify-specs' design cites it; #138 fixed a warning that had inflated into unreadability), so
// shipping the collector alone would have been the same mistake with a new name.
//
// EVERY SECTION BELOW ANSWERS A QUESTION THE ISSUE ASKS BY NAME. That is the contract: a section
// with no question behind it, or a question with no section, is the graveyard starting.
//
//   "How long did an epic sit `queued` before it was picked up?"      → TIME TO PICKUP
//   "How many detours interrupted it?"                                 → DETOURS
//   "Which lane was chosen, and did the work prove it wrong?"          → LANES (and re-routes)
//   "Was a gate recorded before or after the commits it covers?"       → GATES (sequence + time)
//   "How often does an agent take the instructed path vs work around?" → OUT-OF-BAND WRITES
//
// The last one is the reason the log is worth its cost. #110 is a gate defeated silently,
// discoverable only by `jq` across 15 repos. A revision `state.json` reached that no event
// covers is a write the ENGINE did not make — a hand-edit — and it is a query here rather than
// an archaeology session.
//
// LOCAL ONLY. Reading a file is squarely inside the architectural law: no network, no external
// system, nothing but this repository's own `.conductor/`.

import fs from "node:fs";
import path from "node:path";
import { isInitialized, loadState } from "./state.mjs";
import { activityDir, activityEnabled, segments } from "./activity-log.mjs";

/** Every event, oldest first, optionally scoped. Returns `{events, malformed, segmentsRead}`.
 *
 *  A RECORD, NOT A BARE ARRAY, and that is the whole reason this signature looks heavier than it
 *  needs to. `malformed` was first written as a property hung on the returned array — which
 *  `sort()` carries but nothing reads, so the reader under-reported what it could not parse
 *  while its own comment claimed otherwise. A reader that quietly drops evidence is the
 *  graveyard failure in miniature, inside the very module written to prevent it.
 *
 *  SCOPING READS FEWER FILES, not fewer lines: a segment's name carries its start time, so
 *  `--since` skips whole files without opening them. That is the entire argument for timestamped
 *  segment names over sequence numbers, and it is why it is implemented here rather than as a
 *  filter after the fact. */
export function readEvents({ dir = activityDir(), since = null, epic = null } = {}) {
  const names = segments(dir);
  const sinceMs = since ? Date.parse(since) : null;
  const scoped = sinceMs !== null && Number.isFinite(sinceMs);
  const events = [];
  let malformed = 0;
  let segmentsRead = 0;
  for (let i = 0; i < names.length; i++) {
    if (scoped) {
      // Keep a segment when it, OR the one after it, could hold an event at/after `since`: the
      // name is the segment's START, so the segment straddling the boundary is the one BEFORE
      // the first qualifying name. Dropping it would silently truncate the window.
      //
      // An UNPARSEABLE next name keeps the segment, deliberately: `segmentStart` returning null
      // means the naming scheme was not followed, and the safe reading of "I cannot tell when
      // this window starts" is to read it. The opposite default would make `--since` silently
      // return less than it should, which is indistinguishable from a quiet period.
      const nextStart = names[i + 1] ? segmentStart(names[i + 1]) : null;
      if (nextStart !== null && nextStart < sinceMs) continue;
    }
    let text = "";
    try { text = fs.readFileSync(path.join(dir, names[i]), "utf8"); } catch { continue; }
    segmentsRead++;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e;
      // A truncated final line is normal for an append-only log whose writer was killed
      // mid-write. Skipped rather than thrown on — a reader that refuses to read is worse than
      // one that reads N-1 lines — but COUNTED, and the count is printed.
      try { e = JSON.parse(line); } catch { malformed++; continue; }
      if (scoped && Date.parse(e.at) < sinceMs) continue;
      if (epic && e.epic !== epic) continue;
      events.push(e);
    }
  }
  events.sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return { events, malformed, segmentsRead };
}

/** The ms timestamp a segment filename encodes, or null. `activity-<ISO with : and . as ->.log` */
export function segmentStart(name) {
  const m = /^activity-(.+)\.log$/.exec(name);
  if (!m) return null;
  // Undo segmentName()'s substitution: the last `-` before `Z` was the millisecond `.`, and the
  // two before the date's `T` block were the `:`s.
  const iso = m[1].replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z");
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** How many unaccounted revisions the report LISTS. The count is always exact; this bounds only
 *  the sample, in both the text report and `--json`. */
export const OUT_OF_BAND_SAMPLE = 50;

const HOUR = 3_600_000;
const hrs = (ms) => `${(ms / HOUR).toFixed(1)}h`;
function median(ns) {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The whole report as data. Pure — takes events and the current revision, touches nothing. */
export function buildReport(events, { currentRevision = null, malformed = 0 } = {}) {
  const r = {
    events: events.length, malformed,
    from: events.length ? events[0].at : null,
    to: events.length ? events[events.length - 1].at : null,
    pickup: [], detours: { push: 0, pop: 0, byEpic: {} },
    lanes: {}, reroutes: [], gates: [],
    outOfBand: { covered: 0, missing: [], missingCount: 0, afterLast: 0 },
    sessions: {},
  };

  // ── time to pickup ──────────────────────────────────────────────────────────────────────
  // The clock starts when the epic ENTERS the log (created, or first seen in any event) and
  // stops at its first transition INTO `active`. An epic that has never been picked up is
  // reported as still waiting rather than omitted: omitting it would make the median describe
  // only the work that got done, which is the flattering half.
  const firstSeen = new Map();
  const pickedUp = new Map();
  for (const e of events) {
    if (!e.epic) continue;
    if (!firstSeen.has(e.epic)) firstSeen.set(e.epic, e.at);
    if (e.kind === "epic-status" && e.to === "active" && !pickedUp.has(e.epic)) {
      pickedUp.set(e.epic, e.at);
    }
  }
  for (const [id, start] of firstSeen) {
    const at = pickedUp.get(id) || null;
    r.pickup.push({
      epic: id, firstSeen: start, activeAt: at,
      waitedMs: at ? Date.parse(at) - Date.parse(start) : null,
    });
  }
  r.pickupMedianMs = median(r.pickup.filter(p => p.waitedMs !== null).map(p => p.waitedMs));
  r.neverPickedUp = r.pickup.filter(p => p.waitedMs === null).length;

  // ── detours, lanes, re-routes, gates, sessions ──────────────────────────────────────────
  for (const e of events) {
    if (e.kind === "detour-push" || e.kind === "detour-pop") {
      r.detours[e.kind === "detour-push" ? "push" : "pop"]++;
      if (e.epic) r.detours.byEpic[e.epic] = (r.detours.byEpic[e.epic] || 0) + 1;
    }
    if (e.kind === "epic-created" && e.lane) r.lanes[e.lane] = (r.lanes[e.lane] || 0) + 1;
    // A lane CHANGE is the only mechanical evidence the log holds for "did the work later prove
    // that lane wrong". It is evidence, not a verdict — a re-route can also be a correction of a
    // typo — so it is listed rather than counted into a quality metric.
    if (e.kind === "epic-lane") r.reroutes.push({ epic: e.epic, from: e.from, to: e.to, at: e.at });
    if (e.kind === "gate-review") r.gates.push({ epic: e.epic, gate: e.gate, verdict: e.verdict, at: e.at });
    if (e.session) r.sessions[e.session] = (r.sessions[e.session] || 0) + 1;
  }

  // ── out-of-band writes ──────────────────────────────────────────────────────────────────
  // Each event covers the half-open revision range (fromRevision, revision]. A revision inside
  // the log's own window that NO event covers is a write the engine did not make.
  const covered = new Set();
  let maxRev = null, minFrom = null;
  for (const e of events) {
    if (!Number.isInteger(e.revision)) continue;
    const from = Number.isInteger(e.fromRevision) ? e.fromRevision : e.revision - 1;
    for (let v = from + 1; v <= e.revision; v++) covered.add(v);
    maxRev = maxRev === null ? e.revision : Math.max(maxRev, e.revision);
    minFrom = minFrom === null ? from : Math.min(minFrom, from);
  }
  r.outOfBand.covered = covered.size;
  if (maxRev !== null) {
    // COUNT everything, LIST a bounded sample. The span between the log's earliest `fromRevision`
    // and its latest `revision` is attacker-shaped input in the ordinary sense: a hand-edit that
    // sets `revision` to a large number makes the span large, and this is the one loop whose
    // length that number controls. `--json` would then emit the whole array, so a report about a
    // pathological record must not itself be pathological. The count stays exact.
    for (let v = minFrom + 1; v <= maxRev; v++) {
      if (covered.has(v)) continue;
      r.outOfBand.missingCount++;
      if (r.outOfBand.missing.length < OUT_OF_BAND_SAMPLE) r.outOfBand.missing.push(v);
    }
    // Revisions past the last recorded event. These are the ones that matter most in practice:
    // a hand-edit made just now, or the whole window before logging was switched on.
    if (Number.isInteger(currentRevision) && currentRevision > maxRev) {
      r.outOfBand.afterLast = currentRevision - maxRev;
    }
  }
  return r;
}

export function formatReport(r, { enabled = true, dir = activityDir() } = {}) {
  const L = ["ACTIVITY — what this conductor actually did, from .conductor/activity/.", ""];
  if (!enabled) {
    L.push("The activity log is OFF for this repo (the default).");
    L.push("Turn it on with `set-activity-log on`. It records nothing retroactively —");
    L.push("anything before that moment is answerable only by forensics, which is the gap it closes.");
    L.push("");
  }
  if (!r.events) {
    L.push(`No events recorded${enabled ? "" : " (and none will be while it is off)"}. Log directory: ${dir}`);
    return L.join("\n");
  }
  L.push(`${r.events} event(s), ${r.from} → ${r.to}`);
  // Printed whenever it is non-zero, and never rounded away. A truncated last line is ordinary;
  // a large count means a writer is producing lines this reader cannot parse, and the reader is
  // the only place that can say so.
  if (r.malformed) L.push(`${r.malformed} unparseable line(s) were skipped and are NOT counted above.`);
  L.push("");

  L.push("TIME TO PICKUP — how long an epic waited before it went `active`");
  L.push(`  median: ${r.pickupMedianMs === null ? "no epic was picked up in this window" : hrs(r.pickupMedianMs)}` +
    `   ·   still waiting: ${r.neverPickedUp}`);
  for (const p of [...r.pickup].sort((a, b) => (b.waitedMs || Infinity) - (a.waitedMs || Infinity)).slice(0, 10)) {
    L.push(`  • ${p.epic} — ${p.waitedMs === null ? "never picked up" : hrs(p.waitedMs)}`);
  }
  L.push("");

  L.push("DETOURS — how often work was interrupted");
  L.push(`  ${r.detours.push} push(es), ${r.detours.pop} pop(s)`);
  for (const [epic, n] of Object.entries(r.detours.byEpic)) L.push(`  • ${epic} — ${n}`);
  L.push("");

  L.push("LANES — which lane was chosen at registration");
  const laneRows = Object.entries(r.lanes).sort((a, b) => b[1] - a[1]);
  L.push(laneRows.length ? laneRows.map(([k, v]) => `  ${k}: ${v}`).join("\n") : "  (no epics registered in this window)");
  if (r.reroutes.length) {
    L.push(`  ${r.reroutes.length} re-route(s) — evidence the first lane was wrong, not a verdict:`);
    for (const x of r.reroutes) L.push(`  • ${x.epic}: ${x.from} → ${x.to} at ${x.at}`);
  }
  L.push("");

  L.push("GATES — verdicts in the order they were recorded");
  L.push(r.gates.length ? r.gates.map(g => `  • ${g.at}  ${g.epic}  ${g.gate}=${g.verdict}`).join("\n")
    : "  (none recorded in this window)");
  L.push("");

  L.push("OUT-OF-BAND WRITES — state.json revisions no engine verb accounts for");
  const total = r.outOfBand.missingCount + r.outOfBand.afterLast;
  if (!total) {
    L.push(`  none. ${r.outOfBand.covered} revision(s) covered by recorded events.`);
  } else {
    if (r.outOfBand.missingCount) {
      L.push(`  ${r.outOfBand.missingCount} revision(s) INSIDE the logged window are unaccounted for: ` +
        r.outOfBand.missing.join(", ") +
        (r.outOfBand.missingCount > r.outOfBand.missing.length ? ", …" : ""));
    }
    if (r.outOfBand.afterLast) {
      L.push(`  ${r.outOfBand.afterLast} revision(s) AFTER the last recorded event.`);
    }
    L.push("  A revision the log never saw is a write the engine did not make — a hand-edit, or");
    L.push("  a window during which logging was off. Both are worth knowing; neither is inferable");
    L.push("  from state.json, which only ever shows the present.");
  }
  if (Object.keys(r.sessions).length) {
    L.push("");
    L.push("SESSIONS — which identity did how much");
    for (const [s, n] of Object.entries(r.sessions).sort((a, b) => b[1] - a[1])) L.push(`  ${s}: ${n}`);
  }
  return L.join("\n");
}

/** `activity [--since <iso>] [--epic <id>] [--json]` — read-only. */
export function activity() {
  if (!isInitialized()) {
    process.stderr.write("conductor: run /pm:init first\n");
    process.exit(1);
  }
  const argv = process.argv.slice(3);
  const val = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      process.stderr.write(`conductor: --${name} requires a value\n`);
      process.exit(1);
    }
    return v;
  };
  const state = loadState();
  const { events, malformed } = readEvents({ since: val("since"), epic: val("epic") });
  const report = buildReport(events, { currentRevision: state.revision, malformed });
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ enabled: activityEnabled(state), ...report }, null, 2) + "\n");
    return;
  }
  process.stdout.write(formatReport(report, { enabled: activityEnabled(state) }) + "\n");
}
