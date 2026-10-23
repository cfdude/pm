// scripts/lib/list.mjs
// `list` -- the READ-ONLY listing of the epics in the record.
//
// WHY A VERB AT ALL (#204). Three emitted procedures need "the set of existing epics": the tracker-sync
// dedup, intake's "check what already exists before registering", and a disposition's `--deferral
// "<epicId>:<section>"`, which needs the ids of the epics a change defers to. The engine had no verb
// that answered, so each procedure told the agent to read `.conductor/state.json` -- the file the rules
// forbid hand-editing -- and to guess its shape. Reading it was the only thing that worked.
//
// It filters and projects; it decides nothing. No filter combination narrows a result to a verdict.
//
// `--linked-to <id>` means INCOMING: the epics carrying a link whose target is <id>. "Show me the epics
// that link to X" is the question the deferral list asks. The inverse question (what does X link to) is
// X's own `links[]`, which `--json` carries.

import { KNOWN_LANES, KNOWN_STATUSES, escapeControls, jsonText, isOpenspecLane } from "./constants.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { outcomeOf } from "./disposition.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, outStream } from "./invocation.mjs";

/** A string field as the row reports it: the string itself (an empty one stays ""), else null. Never a
 *  guess -- `createdAt` in particular is absent on epics older than epic-registration-clock. */
const strOrNull = v => (typeof v === "string" ? v : null);

/** One epic as the listing reports it. Pure. `release`, `createdAt`, `description` and `outcome` are
 *  copies of fields the epic already holds (backlog-grooming-pass); filtering on them is the reader's. */
export function listRow(e) {
  return {
    id: e.id,
    title: e.title || e.id,
    status: e.status || null,
    lane: isOpenspecLane(e) ? "openspec" : e.lane,
    priority: e.priority || null,
    links: (Array.isArray(e.links) ? e.links : []).map(l => ({ type: l.type, epic: l.epic })),
    release: strOrNull(e.release),
    createdAt: strOrNull(e.createdAt),
    description: strOrNull(e.description),
    outcome: e.disposition ? outcomeOf(e) : null,  // the one reader of an outcome; null = no disposition recorded
  };
}

/** The epics matching every given filter, in record order. Pure over an epics array. A filter that is
 *  `undefined` does not narrow. */
export function filterEpics(epics, { status, lane, linkedTo } = {}) {
  return epics.filter(e => {
    if (status !== undefined && e.status !== status) return false;
    if (lane !== undefined && (isOpenspecLane(e) ? "openspec" : e.lane) !== lane) return false;
    if (linkedTo !== undefined && !(Array.isArray(e.links) ? e.links : []).some(l => l && l.epic === linkedTo)) return false;
    return true;
  });
}

/** READ-ONLY. */
export function list() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("list", f);
  if (f.status !== undefined && !KNOWN_STATUSES.includes(f.status)) {
    die(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")} (got ${escapeControls(JSON.stringify(f.status))})\n`);
  }
  if (f.lane !== undefined && !KNOWN_LANES.includes(f.lane)) {
    die(`conductor: --lane must be one of ${KNOWN_LANES.join("|")} (got ${escapeControls(JSON.stringify(f.lane))})\n`);
  }
  const state = loadState();
  const rows = filterEpics(state.epics || [], { status: f.status, lane: f.lane, linkedTo: f["linked-to"] }).map(listRow);
  if (f.json === true) {
    outStream().write(jsonText({ count: rows.length, epics: rows }, null, 2) + "\n");
    return;
  }
  if (!rows.length) { outStream().write("No epics match.\n"); return; }
  outStream().write(listText(rows));
}

/** The one-line-per-epic form. Each WHOLE line goes through escapeControls: an id or a title is
 *  workspace-authored text, and a newline in one must not start a line the engine never wrote. */
export function listText(rows) {
  const idW = Math.max(...rows.map(r => String(r.id).length));
  return rows.map(r => escapeControls(
    [String(r.id).padEnd(idW), String(r.status).padEnd(9), String(r.lane).padEnd(11), String(r.priority).padEnd(3), r.title].join(" "),
  )).join("\n") + "\n";
}
