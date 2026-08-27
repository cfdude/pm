// scripts/lib/cross-spec-review.mjs
// The RELEASE-scope review gate: do a release's specs agree WITH EACH OTHER?
//
// pm's gate vocabulary is per CHANGE. Gate 1 reviews one change's artifacts, Gate 2 reviews its
// implementation, and both take one change as their unit. A release is many changes, so nothing
// asked the cross-document question — and on this repository's 0.27.0, asking it of six specs
// that had each passed `openspec validate --strict` and would each have passed Gate 1 alone
// returned 5 Critical and 10 Important, including a flagship scenario that was unreachable.
//
// SEAM OWNERSHIP. This module is a READER and a RENDERER and never a writer: it enumerates the
// spec set, hashes it, classifies staleness and renders one line. The verb that WRITES a verdict
// lives in releases.mjs, which already owns release writes and already imports render.mjs.
// Putting the verb here would make render.mjs (which imports this module for the line) and this
// module import each other — the cycle archive-gate.mjs avoids by exactly the same split.
//
// Imports constants.mjs and epic-progress.mjs and nothing else; neither imports back up.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ROOT, findRelease, releaseMembers } from "./constants.mjs";
import { archivedChanges, strippedChangeId } from "./epic-progress.mjs";

/** What an AGENT may pass to `--verdict`, mirroring gate-review-writeback's KNOWN_GATE_VERDICTS.
 *  `pass` MEANS an empty BLOCKS list — see docs/lessons/review-findings-are-not-a-mandate.md: a
 *  cross-spec review always returns findings, so "no findings" is not a stopping condition and a
 *  verdict defined against one would never be reachable. */
export const KNOWN_CROSS_SPEC_VERDICTS = ["pass", "fail"];

/** The gate applies at two or more spec files IN THE RELEASE, counted FLAT.
 *
 *  Flat, and deliberately not a member count: one member change carrying six specs is exactly
 *  0.27.0's shape, and it is the case a member-count threshold silently drops. It is also the
 *  trigger the hand-written practice already documents ("any change whose `specs/` directory
 *  holds two or more spec files"), so one number covers the change scope and the release scope
 *  instead of two rules that can disagree. */
export const CROSS_SPEC_MIN_SPECS = 2;
export const crossSpecRequired = (specs) => (specs || []).length >= CROSS_SPEC_MIN_SPECS;

export const NO_CROSS_SPEC_REVIEW = "no cross-spec review";

/** Where a change's `specs/` directory actually sits — live or archived — or null.
 *
 *  Both archive namings are resolved through the SAME `strippedChangeId()`/`archivedChanges()`
 *  epic-progress.mjs resolves `tasks.md` with. A second date-prefix rule written here would be a
 *  second place for the archive move to be handled wrongly. */
export function changeSpecRoot(changeId, root = ROOT) {
  const changesDir = path.join(root, "openspec", "changes");
  const live = path.join(changesDir, changeId);
  if (fs.existsSync(path.join(live, "specs"))) return { root: live, id: strippedChangeId(changeId) };
  const hit = archivedChanges(path.join(changesDir, "archive"))
    .find(c => c.id === strippedChangeId(changeId));
  if (hit) {
    const arch = path.join(changesDir, "archive", hit.dir);
    if (fs.existsSync(path.join(arch, "specs"))) return { root: arch, id: hit.id };
  }
  return null;
}

/** Every `*.md` under `dir`, recursively, as absolute paths. */
function walkMarkdown(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(abs));
    else if (e.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

/**
 * The release's spec set, ENUMERATED FROM DISK.
 *
 * The agent never supplies it. A spec list typed by the party being reviewed goes stale the
 * moment a capability is added — which is the exact staleness this gate exists to detect, so
 * asking for the list would make the gate's evidence a restatement of its own blind spot.
 *
 * Each entry is `{key, abs}`. `key` is CHANGE-RELATIVE (`<changeId>/specs/<cap>/spec.md`) and
 * never the on-disk path, because `/opsx:archive` relocates `openspec/changes/<id>/` under
 * `archive/<date>-<id>/` — a path-keyed record would report every archived release stale
 * forever, the same trap `gateStaleness()` documents for the attributed-commit array.
 *
 * Deduplicated by key: a change registered twice under different lanes is a real shape here
 * (integrity reports four such pairs in this repository), and counting its specs twice would
 * make the threshold that decides whether the gate applies a function of a registration bug.
 *
 * Lane is deliberately NOT consulted. Disk is the evidence: an epic with no change directory
 * contributes nothing whatever its lane says, and a lane label that is wrong must not be able to
 * hide a spec from the review.
 */
export function releaseSpecFiles(state, epics, releaseId, root = ROOT) {
  const seen = new Map();
  for (const epic of releaseMembers(epics, releaseId)) {
    const r = changeSpecRoot(epic.id, root);
    if (!r) continue;
    for (const abs of walkMarkdown(path.join(r.root, "specs"))) {
      const key = `${r.id}/${path.relative(r.root, abs).split(path.sep).join("/")}`;
      if (!seen.has(key)) seen.set(key, { key, abs });
    }
  }
  return [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The content digest the engine records for a spec, or null where the file cannot be read.
 *  Computed by the ENGINE at record time — an agent-supplied hash certifies nothing. */
export function specDigest(abs) {
  try { return createHash("sha256").update(fs.readFileSync(abs)).digest("hex"); }
  catch { return null; }
}

/**
 * How well a recorded cross-spec verdict still covers the release's spec set.
 *
 * The four states are `gateStaleness()`'s vocabulary, deliberately, so a reader who knows one
 * knows the other:
 *
 *   "none"          no verdict is recorded.
 *   "unverifiable"  the record predates the evidence field, or a spec in the CURRENT set cannot
 *                   be read. Nothing is known; nothing is asserted either way.
 *   "stale"         a spec was ADDED to the release after the verdict, or a reviewed spec's
 *                   CONTENT changed. The added case is the one a change-scoped gate structurally
 *                   misses: the new spec passes Gate 1 on its own merits, and the SET it now
 *                   belongs to was never reviewed as a set again.
 *   "fresh"         everything else.
 *
 * A spec that was REMOVED from the set is not staleness. The review covered it and it is gone;
 * nothing went unreviewed. Treating removal as staleness would make deleting a spec a reason to
 * re-review, which is backwards.
 */
export function crossSpecStaleness(release, specs) {
  const entry = release && release.crossSpecReview;
  const empty = { added: [], changed: [], unreadable: [] };
  if (!entry || typeof entry.verdict !== "string") return { state: "none", ...empty };
  if (!Array.isArray(entry.specs)) return { state: "unverifiable", ...empty };
  const recorded = new Map(entry.specs.filter(s => s && s.key).map(s => [s.key, s.sha256]));
  const added = [];
  const changed = [];
  const unreadable = [];
  for (const s of specs || []) {
    const digest = specDigest(s.abs);
    if (digest === null) { unreadable.push(s.key); continue; }
    if (!recorded.has(s.key)) added.push(s.key);
    else if (recorded.get(s.key) !== digest) changed.push(s.key);
  }
  if (unreadable.length) return { state: "unverifiable", added, changed, unreadable };
  if (added.length || changed.length) return { state: "stale", added, changed, unreadable };
  return { state: "fresh", added, changed, unreadable };
}

/** The marking a rendered cross-spec verdict carries, so every surface describes the same
 *  verdict the same way — `stalenessMarking()`'s shape at release scope. */
export function crossSpecMarking(release, specs) {
  switch (crossSpecStaleness(release, specs).state) {
    case "stale": return " ⚠ stale";
    case "unverifiable": return " ⚠ unverifiable";
    default: return "";
  }
}

/**
 * THE cross-spec suffix a release line carries, on every surface.
 *
 * One function with two call sites (PROJECT.md and the briefing), never two renderings — the
 * same rule `releaseLine()` and `gateSummary()` are built on. Returns "" where the gate does not
 * apply and nothing is recorded, so a repo that does not plan in multi-spec releases sees
 * nothing at all.
 */
export function crossSpecLine(state, epics, releaseId, root = ROOT) {
  const release = findRelease(state, releaseId);
  if (!release) return "";
  const specs = releaseSpecFiles(state, epics, releaseId, root);
  const entry = release.crossSpecReview;
  if (!entry || typeof entry.verdict !== "string") {
    // Silence would be indistinguishable from "reviewed and clean". A release the gate binds and
    // nobody has reviewed says so.
    return crossSpecRequired(specs)
      ? ` · ⚠ ${NO_CROSS_SPEC_REVIEW} (${specs.length} specs)`
      : "";
  }
  const n = Array.isArray(entry.specs) ? entry.specs.length : 0;
  const who = entry.reviewer ? ` · ${entry.reviewer}` : "";
  return ` · cross-spec ${entry.verdict} (${n} spec${n === 1 ? "" : "s"})${who}` +
    crossSpecMarking(release, specs);
}
