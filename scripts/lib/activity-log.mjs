// scripts/lib/activity-log.mjs
// #111 — the optional activity log. OFF BY DEFAULT; on in the maintainer's repos.
//
// THE CONDITION THIS FEATURE HAD TO MEET, in the issue's own words: "If the reader is not in the
// same release, this feature should not ship." A log nothing reads is a data graveyard that
// costs write-path complexity, rotation, retention and a purge CLI, and returns nothing. So the
// reader (lib/activity-report.mjs, the `activity` verb) is not a follow-up — it ships here, and
// each thing this file records exists because a named question needs it. Nothing is recorded
// "in case it is useful later"; that phrase is the failure mode.
//
// ONE CHOKEPOINT, NOT AN INSTRUMENTATION SWEEP. Events are DERIVED by diffing state.json across
// one invocation, from conductor.mjs's dispatch — not emitted by hand from each of the ~25
// verbs that write state. That matters for a reason this repository has measured: a list of
// call sites typed from memory goes stale the moment a caller is added, and a verb added later
// that forgot to emit would be invisible in exactly the log built to find invisible things.
// The diff cannot forget.
//
// IT SURVIVES process.exit(). Verified mechanically before choosing this shape:
// `rg -n "process\.exit" scripts/lib/` finds one MUTATING verb that writes state and then exits
// non-zero (update-epic's post-write attribution read-back). process.exit() skips `finally`, so
// the handler is registered with process.on("exit") — which runs synchronously on that path too.
//
// IT NEVER BREAKS THE RUN IT OBSERVES. Same rule write-conflicts.mjs opens with, and for the
// same reason: every filesystem call here is inside a try/catch, mkdirSync included. A crash in
// the observer converts a working command into a visible failure, and it would fire precisely
// when the filesystem is already in trouble.

import fs from "node:fs";
import path from "node:path";
import {
  ACTIVITY_SEGMENT_MAX_BYTES, ACTIVITY_RETENTION_MAX_BYTES,
} from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";

/** Re-derived per call, like write-conflicts.mjs's: the tests cache-bust by moving
 *  CLAUDE_PROJECT_DIR, and a module-scope constant would freeze the first repo seen. */
export function activityDir() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(root, ".conductor", "activity");
}

/** Is the log on for this repo? Absent config means OFF — the issue's stated posture, and the
 *  only default under which a daily consumer inherits no cost at all. */
export function activityEnabled(state) {
  return !!(state && state.activityLog && state.activityLog.enabled === true);
}

/** `set-activity-log <on|off>` — the toggle. Off is the default and stays the default.
 *
 *  An ADDED OPTIONAL FIELD (`state.activityLog`), so there is deliberately NO `MIGRATIONS` entry:
 *  a state file written by the previous version loads unchanged and resolves to off, which is
 *  the same answer the field's absence already gives. A migration is for data that must be
 *  TRANSFORMED to stay valid, and nothing here is. */
export function setActivityLog() {
  if (!isInitialized()) {
    process.stderr.write("conductor: run /pm:init first\n");
    process.exit(1);
  }
  const arg = process.argv[3];
  if (arg !== "on" && arg !== "off") {
    process.stderr.write("usage: conductor.mjs set-activity-log <on|off>\n");
    process.exit(1);
  }
  const state = loadState();
  state.activityLog = { ...(state.activityLog || {}), enabled: arg === "on" };
  saveState(state);
  process.stderr.write(
    `conductor: activity log ${arg}${arg === "on"
      ? ` — writing to ${activityDir()} (git-ignored). Read it with \`activity\`.`
      : " — nothing further is recorded. What was already recorded is kept."}\n`);
}

/** Segment file names, oldest first.
 *
 *  ISO-8601 segment starts sort lexicographically in chronological order, which is the whole
 *  argument for timestamped names over sequence numbers: retention (prune oldest) and scoping
 *  (read only the window in question) are answerable FROM THE FILENAME, without opening a file.
 *  A sequence number requires reading to learn what period it covers. */
export function segments(dir = activityDir()) {
  try {
    return fs.readdirSync(dir).filter(n => /^activity-.*\.log$/.test(n)).sort();
  } catch { return []; }
}

/** A filename-safe ISO timestamp. `:` is illegal on some filesystems and awkward on all of
 *  them; `.` would make the extension ambiguous. Both become `-`, which preserves the
 *  lexicographic-equals-chronological property the naming scheme rests on. */
export function segmentName(at = new Date()) {
  return `activity-${at.toISOString().replace(/[:.]/g, "-")}.log`;
}

/** Delete oldest segments until the directory total is under the cap.
 *
 *  Called ONLY at a rotation boundary, never on the write path. That is the maintainer's own
 *  resolution of the tension the issue names: age-based pruning requires READING the log, which
 *  the write-conflict log deliberately avoids, so the read happens once per segment rather than
 *  once per event. `statSync` is O(1) and `rmSync` is O(1) — the body is never parsed.
 *
 *  1 GB is a BACKSTOP AGAINST PATHOLOGY, not an operating point: at 191 bytes per event it is
 *  ~5.5 million events, which is centuries at pm's own measured rate. It is per PROJECT and this
 *  is intended to run in ~22 of them, so the stated worst case is 22 GB and the measured real
 *  case is a few megabytes total. */
export function pruneToCap(dir = activityDir(), cap = ACTIVITY_RETENTION_MAX_BYTES) {
  const removed = [];
  try {
    const names = segments(dir);
    const sized = names.map(n => {
      let size = 0;
      try { size = fs.statSync(path.join(dir, n)).size; } catch { /* vanished mid-walk */ }
      return { name: n, size };
    });
    let total = sized.reduce((a, s) => a + s.size, 0);
    // NEVER prunes the last remaining segment, whatever the cap. A cap smaller than one segment
    // would otherwise delete the file that is about to be written to, and the log would record
    // nothing while reporting that retention was working.
    for (const s of sized) {
      if (total <= cap || sized.length - removed.length <= 1) break;
      try { fs.rmSync(path.join(dir, s.name), { force: true }); removed.push(s.name); total -= s.size; }
      catch { /* best effort */ }
    }
  } catch { /* observability only */ }
  return removed;
}

/** The segment to append to, rotating (and pruning) when the newest one is full.
 *
 *  128 KB is chosen against a stated constraint rather than by feel: a segment must be fully
 *  readable in ONE pass by an agent. 128 KB / 191 B ≈ 680 events ≈ 37k tokens, which leaves
 *  room for the actual task. Larger stops satisfying the constraint; smaller multiplies files
 *  for no gain. At the measured rate that is 1–2 segments per month for the busiest repo in the
 *  fleet, and a pathological burst produces many segments — which is the DESIRABLE behaviour:
 *  more segments means finer time-scoping, not a bigger problem. */
function currentSegment(dir) {
  const existing = segments(dir);
  const newest = existing[existing.length - 1];
  if (newest) {
    let size = 0;
    try { size = fs.statSync(path.join(dir, newest)).size; } catch { size = 0; }
    if (size < ACTIVITY_SEGMENT_MAX_BYTES) return path.join(dir, newest);
    pruneToCap(dir);
  }
  return path.join(dir, segmentName());
}

/** Append already-built event objects. One JSON object per line. */
export function appendEvents(events) {
  if (!events || !events.length) return;
  try {
    const dir = activityDir();
    fs.mkdirSync(dir, { recursive: true });
    const seg = currentSegment(dir);
    fs.appendFileSync(seg, events.map(e => JSON.stringify(e)).join("\n") + "\n");
  } catch { /* observability only — never fail the run being observed */ }
}

// ───────────────────────── the diff ─────────────────────────

const byId = (state) => new Map((state && state.epics ? state.epics : []).map(e => [e.id, e]));
const topOf = (state) => {
  const st = state && Array.isArray(state.detourStack) ? state.detourStack : [];
  return st.length ? st[st.length - 1] : null;
};
const frameEpic = (f) => (f && typeof f === "object" ? (f.epic || f.epicId || f.id || null) : null);

/** Every state transition this invocation caused, as event objects.
 *
 *  PURE — no clock, no filesystem, no argv. `meta` carries the invocation's identity so the
 *  whole thing is testable without a subprocess, and so the "what changed" logic and the "who
 *  did it" logic cannot drift into each other.
 *
 *  WHAT IS RECORDED, AND THE QUESTION EACH ONE ANSWERS. This list is the feature's contract with
 *  itself; a field with no question behind it is the graveyard starting:
 *    epic-created / epic-removed / epic-status  → how long did an epic sit `queued` before it
 *                                                 was picked up, and what is its lifecycle
 *    epic-lane                                  → which lane was chosen, and was it re-routed
 *                                                 later (i.e. did the work prove it wrong)
 *    detour-push / detour-pop                   → how many detours interrupted an epic
 *    gate-review                                → when a gate verdict was recorded, in sequence
 *    epic-claimed / epic-released               → which session did which work (#84's secondary
 *                                                 benefit, made queryable)
 *    state-write                                → the write happened and produced nothing above.
 *                                                 This is the load-bearing one: with a revision
 *                                                 on every line, a revision that state.json has
 *                                                 reached and the log never saw is a write the
 *                                                 ENGINE did not make — a hand-edit. That is
 *                                                 #110's "gate defeated silently", found by a
 *                                                 query instead of by `jq` across 15 repos. */
export function diffEvents(before, after, meta = {}) {
  const base = { at: meta.at || new Date().toISOString(), verb: meta.verb || "unknown" };
  if (meta.session) base.session = meta.session;
  // A REVISION RANGE, not a single number, and this is the detail that decides whether
  // out-of-band detection is a signal or noise. One invocation legitimately bumps `revision`
  // more than once — `update-epic` calls saveState() and then render() saves again — so an
  // event carrying only the final revision would make every intermediate one look like a write
  // the engine did not make, which is exactly the finding this log exists to produce.
  // `fromRevision` is the revision at entry, so the pair covers the half-open range
  // (fromRevision, revision] and the reader can subtract honestly.
  const from = before && Number.isInteger(before.revision) ? before.revision : 0;
  const rev = after && Number.isInteger(after.revision) ? after.revision : null;
  base.fromRevision = from;
  if (rev !== null) base.revision = rev;
  const ev = (kind, extra) => ({ ...base, kind, ...extra });

  const out = [];
  const b = byId(before);
  const a = byId(after);

  for (const [id, epic] of a) {
    const prev = b.get(id);
    if (!prev) {
      out.push(ev("epic-created", { epic: id, lane: epic.lane || null, status: epic.status || null }));
      continue;
    }
    if ((prev.status || null) !== (epic.status || null)) {
      out.push(ev("epic-status", {
        epic: id, from: prev.status || null, to: epic.status || null, lane: epic.lane || null,
      }));
    }
    if ((prev.lane || null) !== (epic.lane || null)) {
      out.push(ev("epic-lane", { epic: id, from: prev.lane || null, to: epic.lane || null }));
    }
    const pc = prev.claim ? prev.claim.session : null;
    const nc = epic.claim ? epic.claim.session : null;
    if (pc !== nc) {
      out.push(nc
        ? ev("epic-claimed", { epic: id, holder: nc, previousHolder: pc })
        : ev("epic-released", { epic: id, previousHolder: pc }));
    }
    for (const gate of ["gate1", "gate2"]) {
      const pv = prev.gateReview && prev.gateReview[gate] ? prev.gateReview[gate].verdict : null;
      const nv = epic.gateReview && epic.gateReview[gate] ? epic.gateReview[gate].verdict : null;
      if (pv !== nv && nv !== null) out.push(ev("gate-review", { epic: id, gate, verdict: nv }));
    }
  }
  for (const id of b.keys()) if (!a.has(id)) out.push(ev("epic-removed", { epic: id }));

  const beforeDepth = before && Array.isArray(before.detourStack) ? before.detourStack.length : 0;
  const afterDepth = after && Array.isArray(after.detourStack) ? after.detourStack.length : 0;
  if (afterDepth > beforeDepth) out.push(ev("detour-push", { epic: frameEpic(topOf(after)), depth: afterDepth }));
  else if (afterDepth < beforeDepth) out.push(ev("detour-pop", { epic: frameEpic(topOf(before)), depth: afterDepth }));

  const pa = before ? (before.active || null) : null;
  const na = after ? (after.active || null) : null;
  if (pa !== na) out.push(ev("active", { from: pa, to: na }));

  // The write happened and said nothing above — recorded anyway, so a revision the log never
  // saw means a write the engine did not make. Without this line an ordinary `--notes` append
  // would be indistinguishable from a hand-edit, and the out-of-band count would be noise.
  if (!out.length) out.push(ev("state-write", {}));
  return out;
}
