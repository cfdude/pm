// scripts/lib/gate-artifact-evidence.mjs
// The CONTENT evidence of a Gate 1 verdict (gh#198): a digest of each artifact the reviewer read, taken
// by the engine at record time, so amending a reviewed artifact afterwards reads STALE.
//
// Gate 1 is the SPEC review and its evidence is the artifacts by PATH. A path names no content: the
// proposal amended after the verdict was still "reviewed" on every surface. Gate 2 has the equivalent
// through `headSha` against the attributed commits, and the cross-spec review through a digest per spec
// (cross-spec-review.mjs, whose shape this follows). Gate 1 was the one gate whose evidence could not
// go stale.
//
// A READER and a computation, never a writer: gate-review-writeback.mjs stores what recordArtifactDigests
// returns, archive-gate.mjs reads staleness through artifactStaleness. Imports constants.mjs and
// epic-progress.mjs only; neither imports back up.
//
// THE DIGEST IS THE ENGINE'S. An agent-supplied hash certifies nothing, so no flag accepts one.
//
// CHANGE-RELATIVE, SO THE ARCHIVE MOVE IS NOT STALENESS. `/opsx:archive` relocates
// `openspec/changes/<id>/` under `archive/<date>-<id>/`, and a path-keyed record would read every
// archived change stale forever (the trap gateStaleness() and crossSpecStaleness() both document). A
// recorded `openspec/changes/<id>/<rest>` is therefore located live first and, when it is gone,
// through the ONE archive resolver (archivedChangeDir) — never a second date-prefix rule here.
//
// WHERE A DIGEST IS ABSENT the verdict is UNVERIFIABLE, never stale: a record that predates this field,
// or an artifact that was unreadable when the verdict was recorded, asserts nothing either way.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { engineRoot, gateArtifacts } from "./constants.mjs";
import { archivedChangeDir } from "./epic-progress.mjs";

const LIVE_CHANGE_FILE = /^openspec\/changes\/(?!archive\/)([^/]+)\/(.+)$/;

const normalize = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");

/** The sha-256 of the file at `abs`, or null where it cannot be read as a file. */
export function artifactDigest(abs) {
  try {
    if (!fs.statSync(abs).isFile()) return null;
    return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  } catch { return null; }
}

/** Where a recorded artifact path sits NOW: live, else under its change's archive directory, else the
 *  live path (which then reads as unreadable). Absolute. */
export function locateArtifact(recorded, root = engineRoot()) {
  const rel = normalize(recorded);
  const live = path.resolve(root, rel);
  if (artifactDigest(live) !== null) return live;
  const m = LIVE_CHANGE_FILE.exec(rel);
  if (m) {
    const archive = path.join(root, "openspec", "changes", "archive");
    const dir = archivedChangeDir(m[1], archive);
    if (dir) {
      const moved = path.join(archive, dir, m[2]);
      if (artifactDigest(moved) !== null) return moved;
    }
  }
  return live;
}

/** `[{path, sha256}]` for every artifact in `paths` that can be read, in the order given. An unreadable
 *  one is left out and returned in `unreadable`, so the caller can say that its edits will read
 *  unverifiable rather than record a digest of nothing. */
export function recordArtifactDigests(paths, root = engineRoot()) {
  const digests = [];
  const unreadable = [];
  for (const p of paths || []) {
    const sha256 = artifactDigest(locateArtifact(p, root));
    if (sha256 === null) unreadable.push(p); else digests.push({ path: p, sha256 });
  }
  return { digests, unreadable };
}

/**
 * How well a recorded Gate 1 verdict still covers the artifacts it read — `gateStaleness()`'s vocabulary.
 *
 *   "unverifiable"  no `artifactDigests` on the entry (legacy), an artifact the verdict names has no
 *                   digest, or a digested artifact can no longer be read.
 *   "stale"         a digested artifact's CONTENT differs from what was reviewed.
 *   "fresh"         every named artifact has a digest and every digest still matches.
 *
 * `stale` outranks `unverifiable`: one changed artifact is a fact even when another is unreadable.
 */
export function artifactStaleness(entry, root = engineRoot()) {
  const empty = { changed: [], unreadable: [] };
  if (!entry || !Array.isArray(entry.artifactDigests)) return { state: "unverifiable", ...empty };
  const changed = [];
  const unreadable = [];
  const digested = new Set();
  for (const d of entry.artifactDigests) {
    if (!d || typeof d.path !== "string") continue;
    digested.add(d.path);
    const now = artifactDigest(locateArtifact(d.path, root));
    if (now === null) unreadable.push(d.path);
    else if (now !== d.sha256) changed.push(d.path);
  }
  for (const p of gateArtifacts(entry)) if (!digested.has(p)) unreadable.push(p);
  if (changed.length) return { state: "stale", changed, unreadable };
  if (unreadable.length) return { state: "unverifiable", changed, unreadable };
  return { state: "fresh", changed, unreadable };
}
