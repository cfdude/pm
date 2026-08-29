// scripts/lib/add-many.mjs
// Atomic bulk epic creation. One-directional dependency on lib/add-epic.mjs
// (parentError) and lib/render.mjs (render) -- neither calls back here.

import fs from "node:fs";
import path from "node:path";
import { activate } from "./active-pointer.mjs";
import { newStory, parentError, parseFlags } from "./add-epic.mjs";
import { isInitialized, loadState, pushEpic, saveState, readStdin } from "./state.mjs";
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
    // `stories` is the first ARRAY-valued batch key that is not `links`, and the copy loop below
    // takes only strings — so without this it would be accepted by the allowlist and then
    // silently dropped, which is the exit-0-write-nothing shape twice over. Validated in THIS
    // pass, before any epic is constructed, so a batch with one bad story creates nothing.
    //
    // Two accepted element shapes, because a plan being registered may already have milestones
    // behind it: a plain title string, or `{title, done?}`. Anything else is refused by name.
    if (e.stories !== undefined) {
      if (!Array.isArray(e.stories)) die(`epic '${id}': stories must be an array of titles or {title, done} objects`);
      for (const s of e.stories) {
        const title = typeof s === "string" ? s : (s && typeof s.title === "string" ? s.title : undefined);
        if (title === undefined || !title.trim()) {
          die(`epic '${id}': every entry in stories needs a non-empty title (got ${JSON.stringify(s)})`);
        }
        if (s && typeof s === "object" && s.done !== undefined && typeof s.done !== "boolean") {
          die(`epic '${id}': story '${title}' has a non-boolean done`);
        }
      }
    }
    // #149 at THIS surface. add-many takes no epic flags on argv — its flag surface is the
    // batch document's KEYS — so the valueless-flag rule arrives here as "a key present with a
    // value nothing can use". The copy loop below reads `if (typeof v === "string")` and drops
    // everything else without a word, which is byte-identical to the drop `add-epic --plan`
    // performed: `{"planPath": true}` and `{"title": "  "}` both exited 0 with the field absent
    // or unusable. Refused in THIS validation pass, before any epic is constructed, so a batch
    // with one offender creates none of its entries.
    //
    // `links` and `stories` are exempt BY NAME: they are array-valued by design and each has its
    // own validation (`stories` immediately above, `links` in the copy loop). Naming them is
    // deliberate — a future array-valued key not listed here is caught by this rule rather than
    // silently dropped, which is the direction the mistake should fail in.
    for (const k of Object.keys(e)) {
      if (!allowedKeys.includes(k) || k === "links" || k === "stories") continue;
      if (typeof e[k] !== "string" || !e[k].trim()) {
        die(`epic '${id}': ${k} must be a non-empty string (got ${JSON.stringify(e[k])})`);
      }
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
    // `attributedCommits: []` is stamped by pushEpic(), not here — see state.mjs. A rule
    // written out at each construction site is a stale enumeration waiting to happen.
    const epic = {
      id: e.id, title: e.id, priority: "P?", status: "queued",
      role: "epic", lane: e.lane, links: [], reconcileNeeded: false,
    };
    for (const key of allowedKeys) {
      const v = e[key];
      if (v === undefined || v === null) continue;
      if (key === "links") { if (Array.isArray(v)) epic.links = v; continue; }
      // Normalized through newStory() rather than copied verbatim: a batch may write a bare
      // title string, and every other writer produces `{title, done}`. One row shape, one
      // constructor — see newStory() in add-epic.mjs. Validated above, so this cannot throw.
      if (key === "stories") {
        epic.stories = v.map(s => (typeof s === "string" ? newStory(s) : newStory(s.title, s.done)));
        continue;
      }
      if (typeof v === "string") epic[key] = v;
    }
    // The second archived-at-creation path, carrying its OWN token so a rule applied to one
    // command is visibly absent from the other. Read the RESOLVED status — `status` is an
    // add-many key, so the copy loop above may or may not have set it — exactly as the
    // validation pass resolved it.
    if ((e.status || "queued") === "archived") epic.disposition = creationStamp("add-many");
    pushEpic(state, epic);
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
