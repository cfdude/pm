// scripts/lib/board.mjs
// `board` -- the READ-ONLY snapshot the project boards read (change project-boards, spec board-export).
//
// ONE export, not a family. A board-shaped snapshot computes the derived values (`delivered`, `dependsOn`,
// release status, `criticalPath`) once, so a page never reads `.conductor/state.json` and never guesses at
// release order, status, or what `archived` means (cfdude/pm #268, #269, #270).
//
// TWO HALVES, because resolveEpics() reads `openspec/changes/` off disk (design D2):
//   * boardSnapshot(state, resolved, opts) is PURE. A unit test hands it a record and the resolved list.
//   * board() is the verb wrapper: it loads the record, calls resolveEpics(), prints. It writes nothing,
//     runs no git and opens no network connection (D3), and it keeps working while boards are off.
//
// THE ORDER is the one resolveEpics() produces for PROJECT.md (effective priority, merit priority, rank,
// lane, id) -- through orderResolved(), never a copied comparator. It is NOT the brief's NEXT UP order.
//
// EVERY EMITTED STRING THAT A PAGE WILL INTERPOLATE IS CHECKED HERE FIRST (D11, D12): ids must match
// BOARD_ID_FORMAT and URLs must be http or https. A record that fails is omitted or nulled and named in
// `rejected[]`, and the verb still exits 0, because a hand-edited or legacy record is data, not a crash.
// The CALLER (the page) checks again; this is the boundary, not the only wall.

import { escapeControls, jsonText, isOpenspecLane } from "./constants.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { outcomeOf } from "./disposition.mjs";
import { resolveEpics } from "./epic-progress.mjs";
import { criticalPathOf, orderOfRelease, releaseStatus } from "./release-plan.mjs";
import { pluginVersion } from "./plugin-meta.mjs";
import { boardsEnabled } from "./boards-switch.mjs";
import { epicKey } from "./epic-number.mjs";
import { projectKeyError, projectNameError } from "./project-identity.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, outStream } from "./invocation.mjs";

/** Schema version of the snapshot. A change in an existing key's meaning increments it. */
export const BOARD_SCHEMA_VERSION = 1;

/** The ids a board will emit and a page will interpolate. WIDER than the engine's EPIC_ID_FORMAT (D11):
 *  it is the boundary for hand-edited or legacy records, and it catches every markup-bearing character.
 *  An engine-written id always passes it. */
export const BOARD_ID_FORMAT = /^[A-Za-z0-9._-]+$/;

/** The ended-epic window `board --json` includes by default (D18). */
export const DEFAULT_ARCHIVED_WINDOW = 50;

/** Every reason a `rejected` entry may carry. Closed: no other spec adds one without adding it here. */
export const REJECTED_REASONS = [
  "id format", "dangling depends-on", "url scheme", "here names no release", "milestone names no release", "project format",
];

const PRIORITY_KEYS = ["P0", "P1", "P2", "P3", "P?"];

const str = (v) => (typeof v === "string" ? v : null);
const isId = (v) => typeof v === "string" && BOARD_ID_FORMAT.test(v);
const time = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/** The time an epic ended: the disposition's `recordedAt`, else `completedAt`, else null. */
function endedAtOf(e) {
  return str(e.disposition && e.disposition.recordedAt) || str(e.completedAt) || null;
}

/** A release's progress over its members' ENTRIES (the values the epic rows carry, so the two cannot disagree): `total` counts every
 *  member whose outcome (`outcomeById`, the one outcomeOf() read per epic) is not `declined`, `done` those whose `delivered` is true. Read over every member in the record, never the
 *  ended-epic window, because the caller hands it entries built before the window is applied. */
function progressOf(entries, outcomeById) {
  const counted = entries.filter(x => outcomeById.get(x.id) !== "declined");
  return { done: counted.filter(x => x.delivered === true).length, total: counted.length };
}

/** The longest reason an `unshipped` row carries (board-export spec); a longer one ends in an ellipsis. */
export const UNSHIPPED_REASON_CAP = 300;

/** A recorded reason as an `unshipped` row carries it: null when absent or blank, control characters escaped as every other export
 *  text is, capped at UNSHIPPED_REASON_CAP code points with a trailing ellipsis. Never invents text. */
function reasonText(v) {
  if (typeof v !== "string" || v.trim() === "") return null;
  const text = escapeControls(v);
  const cps = Array.from(text);
  return cps.length > UNSHIPPED_REASON_CAP ? escapeControls(cps.slice(0, UNSHIPPED_REASON_CAP - 1).join("")) + "\u2026" : text;
}

/** A release's `unshipped` rows: one per member whose `delivered` is not true (member order), then one per deferral whose epic is not
 *  already a row. Derived once here so a second reader never guesses the outcome, the reason or the successor again. `supersededBy`
 *  comes only from a structured `supersedes` link (`superseder`: epic id -> the id of an epic that links to it), never from prose. */
function unshippedOf(members, deferred, entryById, superseder, outcomeById) {
  const rows = [];
  const have = new Set();
  const reasonOf = new Map(deferred.map(d => [d.epic, d.reason]));
  for (const id of members) {
    const x = entryById.get(id);
    if (!x || x.delivered === true) continue;
    const read = outcomeById.get(id);
    const outcome = x.status !== "archived" ? "open" : (read === null || read === undefined || read === "unknown" ? "unknown" : read);
    const recorded = outcome === "unknown" || outcome === "open" ? null : x.outcomeReason;
    rows.push({
      epic: id, title: x.title, outcome,
      reason: reasonText(recorded) || (outcome === "unknown" ? null : reasonText(reasonOf.get(id))),
      supersededBy: superseder.get(id) || null,
    });
    have.add(id);
  }
  for (const d of deferred) {
    if (have.has(d.epic)) continue;
    const x = entryById.get(d.epic);
    rows.push({ epic: d.epic, title: x ? x.title : null, outcome: "deferred", reason: reasonText(d.reason), supersededBy: null });
    have.add(d.epic);
  }
  return rows;
}

/** The snapshot. Pure over (state, resolved). `resolved` is resolveEpics(state)'s output (or any list of
 *  epics carrying `effectivePriority`, in the order to emit them). `opts`: `pmVersion`, `asOf` (an ISO
 *  time) and `archived` (a positive integer or "all"). */
export function boardSnapshot(state, resolved, opts = {}) {
  const { pmVersion = null, asOf = new Date().toISOString(), archived = DEFAULT_ARCHIVED_WINDOW } = opts;
  const rejected = [];
  const seen = new Set();
  /** One entry per (kind, id, field, value): a field yields at most one entry. */
  const reject = (kind, id, field, value, reason) => {
    const entry = {
      kind, id: id === null || id === undefined ? null : escapeControls(id), field,
      value: escapeControls(typeof value === "string" ? value : JSON.stringify(value)), reason,
    };
    const key = [kind, entry.id, field, entry.value].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    rejected.push(entry);
  };
  /** An id reference: the id itself, or null and a rejection when it fails the format. */
  const idRef = (v, kind, owner, field) => {
    if (v === null || v === undefined) return null;
    if (isId(v)) return v;
    reject(kind, owner, field, v, "id format");
    return null;
  };

  const records = Array.isArray(state && state.epics) ? state.epics : [];
  const releases = Array.isArray(state && state.releases) ? state.releases.filter(r => r && typeof r === "object") : [];
  const knownIds = new Set(records.map(e => e && e.id).filter(v => typeof v === "string"));
  const releaseIds = new Set(releases.map(r => r.id).filter(isId));
  const list = Array.isArray(resolved) ? resolved : [];

  // ── epics ──
  let unregisteredChanges = 0;
  const registered = [];
  for (const e of list) {
    if (!e || typeof e.id !== "string" || !knownIds.has(e.id)) {
      if (e && typeof e.id === "string") unregisteredChanges++;
      continue;
    }
    if (!isId(e.id)) { reject("epic", e.id, "id", e.id, "id format"); continue; }
    registered.push(e);
  }
  const statusOf = new Map(registered.map(e => [e.id, e.status]));

  // ── project: the name and key `set-project` records. Nothing is derived: unset (or invalid) is null. ──
  const projectField = (raw, field, check) => {
    if (raw === undefined || raw === null) return null;
    if (check(raw) === null) return raw;
    reject("project", null, field, raw, "project format");
    return null;
  };
  const project = {
    name: projectField(state && state.projectName, "projectName", projectNameError),
    key: projectField(state && state.projectKey, "projectKey", projectKeyError),
  };

  /** id -> the outcome entryOf() read for that epic through outcomeOf(), so progressOf() never reads an outcome off anything itself. */
  const outcomeById = new Map();
  const entryOf = (e) => {
    const archivedNow = e.status === "archived";
    const outcome = e.disposition ? outcomeOf(e) : null;
    outcomeById.set(e.id, outcome);
    const delivered = archivedNow
      ? (outcome === "delivered" ? true : (outcome === null || outcome === "unknown" ? null : false))
      : false;
    let externalUrl = null;
    if (e.externalUrl !== undefined && e.externalUrl !== null) {
      let ok = false;
      if (typeof e.externalUrl === "string") {
        try { const p = new URL(e.externalUrl).protocol; ok = p === "http:" || p === "https:"; } catch { ok = false; }
      }
      if (ok) externalUrl = e.externalUrl;
      else reject("url", e.id, "externalUrl", e.externalUrl, "url scheme");
    }
    const dependsOn = [];
    for (const l of Array.isArray(e.links) ? e.links : []) {
      if (!l || l.type !== "depends-on" || dependsOn.includes(l.epic)) continue;
      if (!isId(l.epic)) { reject("link", e.id, "dependsOn", l.epic, "id format"); continue; }
      if (!knownIds.has(l.epic)) { reject("link", e.id, "dependsOn", l.epic, "dangling depends-on"); continue; }
      dependsOn.push(l.epic);
    }
    return {
      id: e.id,
      number: Number.isSafeInteger(e.number) && e.number > 0 ? e.number : null,
      key: epicKey({ projectKey: project.key }, e),
      title: str(e.title),
      summary: str(e.summary),
      whyNow: str(e.whyNow),
      description: str(e.description),
      lane: isOpenspecLane(e) ? "openspec" : str(e.lane),
      status: str(e.status),
      priority: str(e.effectivePriority) || str(e.priority),
      meritPriority: str(e.priority),
      rank: Number.isInteger(e.rank) ? e.rank : null,
      position: null,
      release: idRef(e.release, "epic", e.id, "release"),
      externalUrl,
      dependsOn,
      delivered,
      outcome,
      outcomeReason: str(e.disposition && e.disposition.reason),
      createdAt: str(e.createdAt),
      endedAt: endedAtOf(e),
      updatedAt: str(e.touchedAt),
    };
  };

  const open = registered.filter(e => e.status !== "archived").map(entryOf);
  open.forEach((x, i) => { x.position = i; });
  const ended = registered.filter(e => e.status === "archived");
  const endedKey = (e) => time(endedAtOf(e));
  ended.sort((a, b) => {
    const ta = endedKey(a), tb = endedKey(b);
    if (ta === null && tb === null) return a.id.localeCompare(b.id);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return (tb - ta) || a.id.localeCompare(b.id);
  });
  const endedAll = ended.map(entryOf);
  const endedShown = archived === "all" ? endedAll : endedAll.slice(0, archived);

  // ── mission, milestone, plan ──
  const m = state && state.mission && typeof state.mission === "object" ? state.mission : null;
  const cur = m && m.current && typeof m.current === "object" ? m.current : null;
  const mission = cur ? { statement: str(cur.statement), setAt: str(cur.setAt), reason: str(cur.reason) } : null;

  let milestone = null;
  let milestoneRelease = null;
  if (m && m.milestoneRelease !== undefined && m.milestoneRelease !== null) {
    const rid = idRef(m.milestoneRelease, "milestone", null, "milestone.release");
    if (rid !== null) {
      if (releaseIds.has(rid)) milestoneRelease = rid;
      else reject("milestone", null, "milestone.release", rid, "milestone names no release");
    }
  }
  if (milestoneRelease !== null) {
    const crit = [];
    for (const c of Array.isArray(m.criteria) ? m.criteria : []) {
      if (!c || typeof c !== "object" || c.removedAt) continue;
      if (!isId(c.id)) { reject("milestone", null, "milestone.criteria.id", c.id, "id format"); continue; }
      crit.push({ id: c.id, text: str(c.text), check: str(c.check), needsHuman: c.needsHuman === true });
    }
    const num = (id) => { const n = /^c(\d+)$/.exec(id); return n ? Number(n[1]) : Infinity; };
    crit.sort((a, b) => (num(a.id) - num(b.id)) || a.id.localeCompare(b.id));
    milestone = { release: milestoneRelease, criteria: crit };
  }

  const rp = state && state.releasePlan && typeof state.releasePlan === "object" ? state.releasePlan : {};
  let here = idRef(rp.here, "plan", null, "plan.here");
  if (here !== null && !releaseIds.has(here)) {
    reject("plan", null, "plan.here", here, "here names no release");
    here = null;
  }
  const plan = { here, hereText: str(rp.hereText), nextText: str(rp.nextText) };

  // ── releases ──
  const entryById = new Map([...open, ...endedAll].map(x => [x.id, x]));
  /** epic id -> the first registered epic (list order) whose structured `supersedes` link names it. Prose is never read. */
  const superseder = new Map();
  for (const e of registered) {
    if (!isId(e.id)) continue;
    for (const l of Array.isArray(e.links) ? e.links : []) {
      if (l && l.type === "supersedes" && isId(l.epic) && l.epic !== e.id && !superseder.has(l.epic)) superseder.set(l.epic, e.id);
    }
  }
  const relEntries = [];
  for (const r of releases) {
    if (!isId(r.id)) { reject("release", r.id, "id", r.id, "id format"); continue; }
    const memberRecords = records.filter(e => e && e.release === r.id);
    const members = [];
    for (const e of memberRecords) {
      if (!isId(e.id)) { reject("release", r.id, "members", e.id, "id format"); continue; }
      members.push(e.id);
    }
    const deferred = [];
    for (const d of Array.isArray(r.deferred) ? r.deferred : []) {
      if (!d || typeof d !== "object") continue;
      if (!isId(d.epic)) { reject("release", r.id, "deferred", d.epic, "id format"); continue; }
      deferred.push({ epic: d.epic, reason: str(d.reason) });
    }
    const delivered = !!r.delivered;
    const memberStatuses = memberRecords.map(e => statusOf.get(e.id) || e.status);
    const status = releaseStatus(r, memberStatuses);
    const order = orderOfRelease(r);
    relEntries.push({
      id: r.id, intent: str(r.intent), target: str(r.target), theme: str(r.theme), rationale: str(r.rationale),
      exit: str(r.exit), order, size: str(r.size), status, delivered,
      criticalPath: milestoneRelease === null ? null : criticalPathOf(r, state),
      progress: progressOf(members.map(id => entryById.get(id)).filter(Boolean), outcomeById),
      members, deferred, unshipped: unshippedOf(members, deferred, entryById, superseder, outcomeById),
    });
  }
  relEntries.sort((a, b) => {
    if (a.order === null && b.order === null) return a.id.localeCompare(b.id);
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return (a.order - b.order) || a.id.localeCompare(b.id);
  });

  // ── counts: the whole record, never the window ──
  const byPriority = Object.fromEntries(PRIORITY_KEYS.map(k => [k, 0]));
  for (const x of open) byPriority[PRIORITY_KEYS.includes(x.priority) ? x.priority : "P?"]++;
  const counts = {
    open: open.length,
    unregisteredChanges,
    unassigned: open.filter(x => !x.release).length,
    byPriority,
    delivered: endedAll.filter(x => x.delivered === true).length,
    notPursued: endedAll.filter(x => x.delivered === false).length,
    unknownOutcome: endedAll.filter(x => x.delivered === null).length,
  };

  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    pmVersion: str(pmVersion),
    asOf,
    boardsEnabled: boardsEnabled(state),
    project,
    counts,
    mission,
    milestone,
    plan,
    releases: relEntries,
    epics: [...open, ...endedShown],
    rejected,
  };
}

/** The `--archived` bound: a positive integer, or "all". Returns the bound, or null when invalid. */
export function parseArchivedBound(v) {
  if (v === undefined) return DEFAULT_ARCHIVED_WINDOW;
  if (v === "all") return "all";
  if (typeof v === "string" && /^[1-9][0-9]*$/.test(v)) return Number(v);
  return null;
}

/** The short text form: counts, the "here" release and the mission statement. */
export function boardText(snap) {
  const statement = snap.mission && snap.mission.statement ? snap.mission.statement : "no mission";
  const here = snap.plan.here === null ? "none" : snap.plan.here;
  const L = [];
  L.push(`open epics: ${snap.counts.open}`);
  L.push(`here: ${here}`);
  L.push(`mission: ${statement}`);
  return L.map(escapeControls).join("\n") + "\n";
}

/** READ-ONLY. */
export function board() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("board", f);
  const bound = f.archived === undefined ? DEFAULT_ARCHIVED_WINDOW : parseArchivedBound(f.archived);
  if (bound === null) {
    die(`conductor: --archived must be a positive integer or all (got ${escapeControls(JSON.stringify(f.archived))})\n`);
  }
  const state = loadState();
  const snap = boardSnapshot(state, resolveEpics(state), {
    pmVersion: state.pmVersion || pluginVersion(), asOf: new Date().toISOString(), archived: bound,
  });
  if (f.json === true) { outStream().write(jsonText(snap, null, 2) + "\n"); return; }
  outStream().write(boardText(snap));
}
