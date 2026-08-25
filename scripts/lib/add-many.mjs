// scripts/lib/add-many.mjs
// Atomic bulk epic creation. One-directional dependency on lib/add-epic.mjs
// (parentError) and lib/render.mjs (render) -- neither calls back here.

import fs from "node:fs";
import path from "node:path";
import { activate } from "./active-pointer.mjs";
import { parentError, parseFlags } from "./add-epic.mjs";
import { isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { render } from "./render.mjs";
import { ROOT, KNOWN_LANES, KNOWN_STATUSES, epicBatchKeys } from "./constants.mjs";
import { creationStamp } from "./disposition.mjs";

/** Bulk-create epics from a JSON batch `{ parent?, epics: [...] }`.
 *  Validate EVERYTHING first (id format, uniqueness vs existing AND within the
 *  batch, lane, status, parent refs/cycles); on any failure write nothing and
 *  exit non-zero. One saveState at the end — atomic, and race-free. JSON only
 *  (zero-dep engine). `--from -` reads stdin. */
export function addMany() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const from = typeof f.from === "string" ? f.from : undefined;
  if (!from) { process.stderr.write("usage: conductor.mjs add-many --from <path|->\n"); process.exit(1); }
  let raw;
  try { raw = from === "-" ? readStdin() : fs.readFileSync(path.resolve(ROOT, from), "utf8"); }
  catch { process.stderr.write(`conductor: cannot read '${from}'\n`); process.exit(1); }
  let doc;
  try { doc = JSON.parse(raw); } catch { process.stderr.write("conductor: --from is not valid JSON\n"); process.exit(1); }

  const state = loadState();
  const parentId = doc.parent && typeof doc.parent.id === "string" ? doc.parent.id : undefined;
  const incoming = [];
  if (doc.parent) incoming.push({ ...doc.parent });
  for (const e of Array.isArray(doc.epics) ? doc.epics : []) {
    const entry = { ...e };
    if (parentId && entry.parent === undefined) entry.parent = parentId;
    incoming.push(entry);
  }
  if (!incoming.length) { process.stderr.write("conductor: add-many: nothing to add (need `parent` and/or `epics`)\n"); process.exit(1); }

  const die = (msg) => { process.stderr.write(`conductor: add-many: ${msg}\n`); process.exit(1); };

  // The keys a batch entry may carry, derived from the shared EPIC_FLAGS registry rather than
  // restated here. add-many used to copy a fixed key set and drop every other key without a
  // word — the same invisible failure as add-epic's missing allowlist (#79), at a different
  // input shape. Rejection happens in this validation pass, BEFORE any epic is constructed, so
  // a batch containing one offender creates none of its entries.
  //
  // The one flag→key mapping rule the registry carries is `--external-updated-at` ↔
  // `externalUpdatedAt`, which is why a batch document is written in STATE keys. A bulk-mirrored
  // epic that arrived without its watermark would count as never-re-read from the moment it was
  // created, so the bulk path has to carry the same field the single-epic path does.
  const allowedKeys = epicBatchKeys();
  const existingIds = new Set(state.epics.map(e => e.id));
  const batchIds = new Set();
  for (const e of incoming) {
    const id = e.id;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) die(`bad id '${id}' (format ^[a-z0-9][a-z0-9._-]*$)`);
    if (existingIds.has(id)) die(`epic '${id}' already exists`);
    if (batchIds.has(id)) die(`duplicate id '${id}' within the batch`);
    const unknownKeys = Object.keys(e).filter(k => !allowedKeys.includes(k));
    if (unknownKeys.length) {
      die(`epic '${id}': unsupported key(s) ${unknownKeys.join(", ")} ` +
        `(supported: ${allowedKeys.join(", ")})`);
    }
    if (!e.lane || !KNOWN_LANES.includes(e.lane)) die(`epic '${id}': lane must be one of ${KNOWN_LANES.join("|")}`);
    const status = e.status || "queued";
    if (!KNOWN_STATUSES.includes(status)) die(`epic '${id}': status must be one of ${KNOWN_STATUSES.join("|")}`);
    batchIds.add(id);
  }
  const projected = [...state.epics, ...incoming.map(e => ({ id: e.id, parent: e.parent }))];
  for (const e of incoming) {
    if (e.parent !== undefined && e.parent !== null) {
      const perr = parentError(projected, e.id, e.parent);
      if (perr) die(perr);
    }
  }
  for (const e of incoming) {
    // Seeded with the defaults a batch entry may omit, plus the two fields the ENGINE owns and
    // a batch never supplies (`role`, `reconcileNeeded`). Everything else is copied by the
    // registry loop below, so a key a later capability adds to `add-many` is persisted here
    // the moment it is declared — no second literal to forget.
    // `attributedCommits: []` on this creation path too, for the reason add-epic.mjs states at
    // its own construction site: absent means "predates attribution, unverifiable", empty means
    // "created under it, nothing attributed yet", and a rule applied at one of two creation
    // sites is exactly the absent-edit class this release exists to close.
    const epic = {
      id: e.id, title: e.id, priority: "P?", status: "queued",
      role: "epic", lane: e.lane, links: [], reconcileNeeded: false, attributedCommits: [],
    };
    for (const key of allowedKeys) {
      const v = e[key];
      if (v === undefined || v === null) continue;
      if (key === "links") { if (Array.isArray(v)) epic.links = v; continue; }
      if (typeof v === "string") epic[key] = v;
    }
    // The second archived-at-creation path, carrying its OWN token so a rule applied to one
    // command is visibly absent from the other. Read the RESOLVED status — `status` is an
    // add-many key, so the copy loop above may or may not have set it — exactly as the
    // validation pass resolved it.
    if ((e.status || "queued") === "archived") epic.disposition = creationStamp("add-many");
    state.epics.push(epic);
  }
  // Route every activation through the ONE door. add-many used to construct epics inline and
  // push them straight onto state.epics, so a batch entry at `active` status set neither the
  // top-level `.active` pointer nor the demotion of any other epic still at `active` — the
  // single-active invariant was silently skipped on this path alone, which is the absent-edit
  // defect class this release exists to close. Done AFTER every entry is pushed so the last
  // active entry in the batch wins and the demotion sees the whole batch.
  for (const e of incoming) {
    if ((e.status || "queued") === "active") activate(state, e.id);
  }
  saveState(state);
  render();
  process.stderr.write(`conductor: add-many added ${incoming.length} epic(s)\n`);
}
