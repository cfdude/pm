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

// `rest` is empty when the recorded path names the change DIRECTORY itself (gh#252).
const LIVE_CHANGE_FILE = /^openspec\/changes\/(?!archive\/)([^/]+)(?:\/(.*))?$/;

const normalize = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/** A change's `tasks.md` is a PROGRESS LEDGER, not reviewed content: /opsx:apply ticks it constantly, so
 *  digesting it staled every openspec epic's Gate 1 at the first ticked checkbox. It stays in the recorded
 *  artifact list (the reviewer did read it) but is exempt from the digest — never recorded, never compared,
 *  never unreadable. proposal/design/specs keep their digests. */
export const isProgressLedger = (p) => /^openspec\/changes\/(?!archive\/)[^/]+\/tasks\.md$/.test(normalize(p));

/** Local cruft that is not content and would make a directory digest differ between two machines. */
const IGNORED_NAMES = new Set([".DS_Store"]);

/** Every digestable file under `dir`, as sorted `/`-joined paths relative to `dir`. Sorted by plain code-unit
 *  comparison — never a locale collation — so two machines list one tree identically. Regular files and
 *  directories only: a symlink or special file is skipped rather than followed out of the tree. `rel` is the
 *  recorded path of `dir`, so the progress-ledger exemption is judged on the path the reviewer was shown. */
function filesUnder(dir, rel, prefix = ".") {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(d.name)) continue;
    const sub = path.posix.join(prefix, d.name);
    if (d.isDirectory()) out.push(...filesUnder(path.join(dir, d.name), rel, sub));
    else if (d.isFile() && !(rel !== null && isProgressLedger(path.posix.join(rel, sub)))) out.push(sub);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The sha-256 of what `abs` holds, or null where there is nothing digestable.
 *
 *  A FILE digests its bytes. A DIRECTORY (gh#252 — an OpenSpec Gate 1 reviews a change directory) digests the
 *  sorted list of `<relative path>\0<file sha-256>\n` over every file beneath it, so adding, removing,
 *  renaming or editing any file changes it and nothing else does. `rel`, the recorded path, lets a change's
 *  top-level `tasks.md` stay exempt (it is a progress ledger, `isProgressLedger`). A directory with no
 *  digestable file is null — the digest of nothing certifies nothing. */
export function artifactDigest(abs, rel = null) {
  try {
    const st = fs.statSync(abs);
    if (st.isFile()) return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    if (!st.isDirectory()) return null;
    const files = filesUnder(abs, rel === null ? null : normalize(rel));
    if (!files.length) return null;
    const h = createHash("sha256");
    for (const f of files) {
      h.update(f);
      h.update("\0");
      h.update(createHash("sha256").update(fs.readFileSync(path.join(abs, f))).digest("hex"));
      h.update("\n");
    }
    return h.digest("hex");
  } catch { return null; }
}

/** Does `abs` exist as something a digest could be taken of (a file or a directory)? No hashing. */
const artifactExists = (abs) => { try { const st = fs.statSync(abs); return st.isFile() || st.isDirectory(); } catch { return false; } };

/** Where a recorded artifact path sits NOW: live, else under its change's archive directory, else the
 *  live path (which then reads as unreadable). Absolute. */
export function locateArtifact(recorded, root = engineRoot()) {
  const rel = normalize(recorded);
  const live = path.resolve(root, rel);
  if (artifactExists(live)) return live;
  const m = LIVE_CHANGE_FILE.exec(rel);
  if (m) {
    const archive = path.join(root, "openspec", "changes", "archive");
    const dir = archivedChangeDir(m[1], archive);
    if (dir) {
      const moved = path.join(archive, dir, m[2] || "");
      if (artifactExists(moved)) return moved;
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
    if (isProgressLedger(p)) continue;
    const sha256 = artifactDigest(locateArtifact(p, root), p);
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
    if (!d || typeof d.path !== "string" || isProgressLedger(d.path)) continue;
    digested.add(d.path);
    const now = artifactDigest(locateArtifact(d.path, root), d.path);
    if (now === null) unreadable.push(d.path);
    else if (now !== d.sha256) changed.push(d.path);
  }
  for (const p of gateArtifacts(entry)) if (!digested.has(p) && !isProgressLedger(p)) unreadable.push(p);
  if (changed.length) return { state: "stale", changed, unreadable };
  if (unreadable.length) return { state: "unverifiable", changed, unreadable };
  return { state: "fresh", changed, unreadable };
}
