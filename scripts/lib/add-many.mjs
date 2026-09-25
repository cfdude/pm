// scripts/lib/add-many.mjs
// Atomic bulk epic creation. One-directional dependency on lib/add-epic.mjs
// (parentError) and lib/render.mjs (render) -- neither calls back here.

import fs from "node:fs";
import path from "node:path";
import { activate, owedReconcileNotice } from "./active-pointer.mjs";
import { die } from "./command-exit.mjs";
import { newStory, parentError, parseFlags, requireFlagValues, splitLinkSpec } from "./add-epic.mjs";
import { isInitialized, loadState, pushEpic, saveState, readStdin } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { render } from "./render.mjs";
import { EPIC_ID_FORMAT, engineRoot, KNOWN_LANES, KNOWN_STATUSES, epicBatchKeys, escapeControls, priorityValueError, timestampValueError } from "./constants.mjs";
import { creationStamp } from "./disposition.mjs";
import { isKnownLinkType, KNOWN_LINK_TYPES, mergeLinks } from "./links.mjs";
import { currentArgv } from "./invocation.mjs";
import { trackerKeyHolder, trackerKeyRefusal } from "./tracker-dedup.mjs";

/** Bulk-create epics from a JSON batch `{ parent?, epics: [...] }`.
 *  Validate EVERYTHING first (id format, uniqueness vs existing AND within the
 *  batch, lane, status, parent refs/cycles); on any failure write nothing and
 *  exit non-zero. One saveState at the end — atomic, and race-free. JSON only
 *  (zero-dep engine). `--from -` reads stdin. */
export function addMany() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("add-many", f);
  const from = typeof f.from === "string" ? f.from : undefined;
  if (!from) { die("usage: conductor.mjs add-many --from <path|->\n"); }
  let raw;
  try { raw = from === "-" ? readStdin() : fs.readFileSync(path.resolve(engineRoot(), from), "utf8"); }
  catch { die(`conductor: cannot read '${escapeControls(from)}'\n`); }
  let doc;
  try { doc = JSON.parse(raw); } catch { die("conductor: --from is not valid JSON\n"); }

  // This module's own spelling of the ONE exit path (command-exit.mjs), carrying the verb name
  // add-many's refusals have always had. See the import for why it is not called `die`.
  const refuse = (msg) => die(`conductor: add-many: ${msg}\n`);

  // The DOCUMENT's own shape, before any entry is read (add-many-drops-input-silently). Its keys
  // used to be read by name and everything else ignored: `"epic": [...]` for `"epics"` created the
  // parent alone, exit 0, and a non-array `epics` silently became no children. A bulk write
  // persists what it accepts or refuses it by name, so an unknown key or a mis-shaped value refuses
  // the whole batch here — the same rule the per-entry key allowlist below applies one level down.
  const DOC_KEYS = ["parent", "epics"];
  const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObject(doc)) refuse("the batch must be a JSON object with `parent` and/or `epics`");
  const unknownDocKeys = Object.keys(doc).filter(k => !DOC_KEYS.includes(k));
  if (unknownDocKeys.length) {
    refuse(`unsupported top-level key(s) ${escapeControls(unknownDocKeys.join(", "))} (supported: ${DOC_KEYS.join(", ")})`);
  }
  if (doc.parent !== undefined && !isObject(doc.parent)) refuse("`parent` must be an object (one epic entry)");
  if (doc.epics !== undefined && !Array.isArray(doc.epics)) refuse("`epics` must be an array of epic entries");

  const state = loadState();
  const parentId = doc.parent && typeof doc.parent.id === "string" ? doc.parent.id : undefined;
  const incoming = [];
  if (doc.parent !== undefined) incoming.push({ ...doc.parent });
  for (const e of doc.epics || []) {
    const entry = { ...e };
    if (parentId && entry.parent === undefined) entry.parent = parentId;
    incoming.push(entry);
  }
  if (!incoming.length) { die("conductor: add-many: nothing to add (need `parent` and/or `epics`)\n"); }

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
    if (typeof id !== "string" || !EPIC_ID_FORMAT.test(id)) refuse(`bad id '${escapeControls(id)}' (format ${EPIC_ID_FORMAT.source})`);
    if (existingIds.has(id)) refuse(`epic '${escapeControls(id)}' already exists`);
    if (batchIds.has(id)) refuse(`duplicate id '${escapeControls(id)}' within the batch`);
    const unknownKeys = Object.keys(e).filter(k => !allowedKeys.includes(k));
    if (unknownKeys.length) {
      refuse(`epic '${escapeControls(id)}': unsupported key(s) ${escapeControls(unknownKeys.join(", "))} ` +
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
      if (!Array.isArray(e.stories)) refuse(`epic '${escapeControls(id)}': stories must be an array of titles or {title, done} objects`);
      for (const s of e.stories) {
        const title = typeof s === "string" ? s : (s && typeof s.title === "string" ? s.title : undefined);
        if (title === undefined || !title.trim()) {
          refuse(`epic '${escapeControls(id)}': every entry in stories needs a non-empty title (got ${escapeControls(JSON.stringify(s))})`);
        }
        if (s && typeof s === "object" && s.done !== undefined && typeof s.done !== "boolean") {
          refuse(`epic '${escapeControls(id)}': story '${escapeControls(title)}' has a non-boolean done`);
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
        refuse(`epic '${escapeControls(id)}': ${k} must be a non-empty string (got ${escapeControls(JSON.stringify(e[k]))})`);
      }
    }
    if (!e.lane || !KNOWN_LANES.includes(e.lane)) refuse(`epic '${escapeControls(id)}': lane must be one of ${KNOWN_LANES.join("|")}`);
    const status = e.status || "queued";
    if (!KNOWN_STATUSES.includes(status)) refuse(`epic '${escapeControls(id)}': status must be one of ${KNOWN_STATUSES.join("|")}`);
    if (e.priority !== undefined && priorityValueError(e.priority, "priority")) {
      refuse(`epic '${escapeControls(id)}': ${escapeControls(priorityValueError(e.priority, "priority"))}`);
    }
    if (e.externalUpdatedAt !== undefined && timestampValueError(e.externalUpdatedAt, "externalUpdatedAt")) {
      refuse(`epic '${escapeControls(id)}': ${escapeControls(timestampValueError(e.externalUpdatedAt, "externalUpdatedAt"))}`);
    }
    batchIds.add(id);
  }
  // LINKS — the sibling write path, validated the way `--link` is (add-many-drops-input-silently).
  // They were copied through mergeLinks(), which skips every non-object: `["depends-on:base"]` was
  // dropped, a link to `ghost` was stored dangling and `{type:"blocks"}` with no target was stored
  // unrenderable, all exit 0. Now every element either becomes a `{type, epic, reason?}` or refuses
  // the batch by name. Checked in a pass AFTER every id is known, because a batch may link to an
  // entry that appears later in it — the known set is the record's ids plus the batch's.
  const knownIds = new Set([...existingIds, ...batchIds]);
  const batchLinks = new Map();
  for (const e of incoming) {
    if (e.links === undefined) continue;
    const where = `epic '${escapeControls(e.id)}'`;
    if (!Array.isArray(e.links)) {
      refuse(`${where}: links must be an array of "<type>:<epic>[:<reason>]" strings or {type, epic, reason} ` +
        `objects (got ${escapeControls(JSON.stringify(e.links))})`);
    }
    batchLinks.set(e.id, e.links.map(l => batchLink(l, knownIds, where, refuse)));
  }
  const projected = [...state.epics, ...incoming.map(e => ({ id: e.id, parent: e.parent }))];
  for (const e of incoming) {
    if (e.parent !== undefined && e.parent !== null) {
      const perr = parentError(projected, e.id, e.parent);
      if (perr) refuse(perr);
    }
  }
  // One tracker item, one epic — the same rule add-epic and update-epic call (tracker-dedup.mjs).
  // A batch entry's `externalUrl` used to be copied verbatim, so add-many was the one writer of the
  // key that never looked (tracker-item-dedup-bypassed). Judged in batch order against the record
  // AND every earlier entry, so two entries of one batch cannot claim one item either. The values
  // were validated as non-empty strings above.
  const claimed = [];
  for (const e of incoming) {
    const candidate = { externalUrl: e.externalUrl, externalId: e.externalId };
    if (candidate.externalUrl !== undefined || candidate.externalId !== undefined) {
      const hit = trackerKeyHolder([...state.epics, ...claimed], candidate);
      if (hit) refuse(`epic '${escapeControls(e.id)}': ${trackerKeyRefusal(hit, candidate, { inBatch: claimed.includes(hit.holder) })}`);
    }
    claimed.push(e);
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
      // THE sibling write path this file's own comment names, now reading the same rule as the
      // other two: a batch listing one identity twice is one relationship, and copying the array
      // verbatim recorded it twice.
      if (key === "links") { epic.links = mergeLinks([], batchLinks.get(e.id)); continue; }
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
  const previousActive = state.active;
  for (const e of incoming) {
    if ((e.status || "queued") === "active") activate(state, e.id);
  }
  const saved = saveState(state);
  owedReconcileNotice(state, previousActive);
  render();
  reportSave(saved, {
    changed: `conductor: add-many added ${incoming.length} epic(s)`,
    unchanged: `conductor: every epic in the batch was already recorded exactly as supplied — ` +
      `${STATE_UNCHANGED}`,
  });
}

/** The keys a link OBJECT in a batch may carry — exactly what `--link` can express. Anything else
 *  is refused rather than spread onto the stored edge by mergeLinks(): a batch must not be able to
 *  write a `verdict` or an arming record onto a `may-invalidate` link that no gate produced. */
const BATCH_LINK_KEYS = ["type", "epic", "reason"];

/** One batch link element → `{type, epic, reason?}`, or a refusal naming the entry and the element.
 *  The same checks, in the same order, as parseLinkFlags(): shape, then the EPIC half (a mis-split
 *  value is best diagnosed by the half that reveals it), then the TYPE half. */
function batchLink(raw, knownIds, where, refuse) {
  const shown = escapeControls(JSON.stringify(raw));
  let type, epic, reason;
  if (typeof raw === "string") {
    ({ type, epic, reason } = splitLinkSpec(raw));
    if (!type || !epic) refuse(`${where}: bad link ${shown}: expected "<type>:<epic>[:<reason>]"`);
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const extra = Object.keys(raw).filter(k => !BATCH_LINK_KEYS.includes(k));
    if (extra.length) {
      refuse(`${where}: link ${shown}: unsupported link key(s) ${escapeControls(extra.join(", "))} ` +
        `(supported: ${BATCH_LINK_KEYS.join(", ")})`);
    }
    if (typeof raw.type !== "string" || !raw.type) refuse(`${where}: link ${shown} needs a string \`type\``);
    if (typeof raw.epic !== "string" || !raw.epic) refuse(`${where}: link ${shown} needs a string \`epic\` (the target epic's id)`);
    if (raw.reason !== undefined && typeof raw.reason !== "string") refuse(`${where}: link ${shown}: reason must be a string`);
    ({ type, epic } = raw);
    reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  } else {
    refuse(`${where}: link ${shown} must be a "<type>:<epic>[:<reason>]" string or a {type, epic, reason} object`);
  }
  if (!knownIds.has(epic)) {
    refuse(`${where}: link ${shown}: '${escapeControls(epic)}' is not a known epic id (neither in the record nor in this batch)`);
  }
  if (!isKnownLinkType(type)) {
    refuse(`${where}: link type '${escapeControls(type)}' is not one of ${KNOWN_LINK_TYPES.join("|")}`);
  }
  return reason ? { type, epic, reason } : { type, epic };
}
