// scripts/lib/spend-ledger.mjs
// token-spend-tracking-per-epic — the LEDGER'S FILES: incremental ingest, the cursor, the markers, and
// the clear / rebuild inverses. Everything that PARSES lives in spend-reader.mjs (pure); everything that
// DECIDES whose tokens they were lives in spend-attribution.mjs (pure). This module reads transcript
// files and reads and writes `.conductor/spend/` in the MAIN working tree, and does nothing else.
//
// READ-ONLY OVER THE TRANSCRIPTS, AND OFFLINE. Transcripts are opened with the read flag and never
// written, touched or locked; no network module is imported here and no model is invoked
// (scripts/test/assert/conductor-35.test.mjs scans this module like every other).
//
// WHY THESE WRITES ARE RAW `fs` AND NOT THE STORE. The store resolves its artifacts under the
// INVOCATION'S root, and this directory belongs to the MAIN working tree, which a linked worktree is
// not. The ledger also needs two things a store has no meaning for: an `O_EXCL` lock whose staleness
// is its mtime, and byte-offset reads into files that are not the engine's. Both are filesystem
// primitives, the reason commit-watch.mjs is also outside the store; scripts/test/assert/
// store-ownership.test.mjs names this module with that reason. (The TIMELINE, which only the main
// tree ever writes, does go through the store: see spend-tracking.mjs.)
//
// IDEMPOTENT BY CONSTRUCTION. Rows are appended before the cursor advances, so a crash between the
// two re-reads a few lines and appends duplicates — which the fold by message id absorbs. The cursor
// is the LAST write of an ingest for exactly that reason.

import fs from "node:fs";
import path from "node:path";
import {
  foldRows, parseEntry, sourceInfo, storedMarker, storedRow, transcriptDirs,
} from "./spend-reader.mjs";
import { spendDir } from "./spend-tree.mjs";
import { appendDevLog, feedLine, finishRead, newCollector } from "./dev-log-capture.mjs";

export const LEDGER_FILES = Object.freeze({
  rows: "rows.jsonl", cursor: "cursor.json", markers: "markers.json", timeline: "timeline.jsonl", lock: "ingest.lock",
});

/** The skip reason an unreadable transcript is counted under (the report prints it with the rest). */
export const SKIP_UNREADABLE = "unreadable-transcript";

/** A lock older than this is broken, as the state lock's stale rule does. */
export const LOCK_STALE_MS = 10 * 60 * 1000;

/** How many bytes one read takes. Transcripts reach tens of MB; a read is this size whatever the file's. */
const CHUNK_BYTES = 1024 * 1024;

/** The longest line that is parsed. A longer one is dropped and counted: without a cap, a single line
 *  with no newline (a corrupt or runaway transcript) is carried whole, and memory grows with it. */
export const MAX_LINE_BYTES = 16 * 1024 * 1024;

/** Skip reasons, printed with the rest under `skipped entries`. */
export const SKIP_OVERLONG = "over-long-line";
export const SKIP_NOT_FILE = "not-a-regular-file";

const at = (mainRoot, name) => path.join(spendDir(mainRoot), LEDGER_FILES[name]);

// ───────────────────────────── small file helpers ─────────────────────────────

function readJson(file, fallback, fsx) {
  try { return JSON.parse(fsx.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeAtomic(file, text, fsx) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fsx.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fsx.writeFileSync(tmp, text);
    fsx.renameSync(tmp, file);
  } catch (e) {
    try { fsx.rmSync(tmp, { force: true }); } catch { /* best effort: leave no half-file behind */ }
    throw e;
  }
}

/** Take the ingest lock, or return null when a live one is held. Breaks a stale one once. */
function acquireLock(lockPath, nowMs, fsx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fsx.openSync(lockPath, "wx");
      try { fsx.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(nowMs).toISOString() })); } catch { /* the file's existence is the lock */ }
      return fd;
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      let age;
      try { age = nowMs - fsx.statSync(lockPath).mtimeMs; } catch { continue; }   // vanished: retry once
      if (age > LOCK_STALE_MS) { try { fsx.unlinkSync(lockPath); } catch { /* a racer broke it */ } continue; }
      return null;
    }
  }
  return null;
}

function releaseLock(fd, lockPath, fsx) {
  try { fsx.closeSync(fd); } catch { /* already closed */ }
  try { fsx.unlinkSync(lockPath); } catch { /* already gone */ }
}

// ───────────────────────────── discovery ─────────────────────────────

/** Every transcript file for the repository, `{ abs, rel }`, plus the directory the project's own
 *  sessions live in and whether it exists. */
export function discoverFiles(mainRoot, env, home, fsx = fs) {
  const lister = (root) => { try { return fsx.readdirSync(root); } catch { return []; } };
  const found = transcriptDirs(mainRoot, env, lister, home);
  const files = [];
  // Entries that look like part of the tree but are not a plain file or directory (a symlink, a
  // directory named `x.jsonl`, a socket). They are never followed: a link could point outside the
  // transcript tree, or at a file already counted. The same rule at every level, and counted.
  let nonFiles = 0;
  let projectDirFound = false;
  for (const [i, d] of found.dirs.entries()) {
    let entries;
    try { entries = fsx.readdirSync(d.dir, { withFileTypes: true }); } catch { continue; }
    if (i === 0) projectDirFound = true;
    for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d.dir, e.name);
      if (e.isSymbolicLink()) { nonFiles++; continue; }
      if (e.name.endsWith(".jsonl")) {
        if (e.isFile()) files.push({ abs, rel: path.relative(found.root, abs) });
        else nonFiles++;
        continue;
      }
      if (!e.isDirectory()) continue;
      const subDir = path.join(abs, "subagents");
      let subs = [];
      try {
        if (fsx.lstatSync(subDir).isSymbolicLink()) { nonFiles++; continue; }
        subs = fsx.readdirSync(subDir, { withFileTypes: true });
      } catch { continue; }
      for (const s of [...subs].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (!/^agent-.+\.jsonl$/.test(s.name)) continue;
        if (!s.isFile()) { nonFiles++; continue; }
        const sub = path.join(subDir, s.name);
        files.push({ abs: sub, rel: path.relative(found.root, sub) });
      }
    }
  }
  return { files, nonFiles, projectDir: found.dirs[0].dir, projectDirFound, root: found.root };
}

// ───────────────────────────── ingest ─────────────────────────────

/** Read the complete lines of `abs` past `startOffset`, handing each to `onLine`. Returns the byte
 *  offset consumed (always on a line boundary) and the size read up to. A trailing line with no
 *  newline yet is NOT consumed: it is the partial write of a session still running. */
function readLines(abs, startOffset, onLine, fsx, { maxLineBytes = MAX_LINE_BYTES, onSkip = () => {} } = {}) {
  const fd = fsx.openSync(abs, "r");
  try {
    const size = fsx.fstatSync(fd).size;
    const buf = Buffer.alloc(CHUNK_BYTES);
    let pos = startOffset, consumed = startOffset, carry = Buffer.alloc(0), dropping = false;
    while (pos < size) {
      const n = fsx.readSync(fd, buf, 0, Math.min(CHUNK_BYTES, size - pos), pos);
      if (n <= 0) break;
      const base = pos;
      pos += n;
      const chunk = buf.subarray(0, n);
      let data;
      if (dropping) {
        // Inside a line already over the cap: discard until its newline. Not consumed until then, so an
        // unterminated one (a session still writing) is looked at again, and counted again, next run.
        const end = chunk.indexOf(0x0a);
        if (end === -1) continue;
        dropping = false;
        consumed = base + end + 1;
        data = Buffer.from(chunk.subarray(end + 1));
      } else {
        data = carry.length ? Buffer.concat([carry, chunk]) : Buffer.from(chunk);
      }
      let start = 0, nl;
      while ((nl = data.indexOf(0x0a, start)) !== -1) {
        if (nl - start > maxLineBytes) onSkip(SKIP_OVERLONG);
        else onLine(data.toString("utf8", start, nl));
        start = nl + 1;
      }
      consumed += start;
      carry = data.subarray(start);
      // The carry is the only thing that grows with a line's length, so this is what bounds memory.
      if (carry.length > maxLineBytes) { onSkip(SKIP_OVERLONG); carry = Buffer.alloc(0); dropping = true; }
    }
    return { consumed, size };
  } finally {
    try { fsx.closeSync(fd); } catch { /* best effort */ }
  }
}

/** Ingest without taking the lock: the body `ingest` and `rebuild` share once each holds it.
 *  `seed` is `rebuild`'s: the cursor, markers and rows to START from, held in memory. With a seed the
 *  three files are written ONLY here, at the end and each atomically, so a throw anywhere before then
 *  leaves the previous ledger exactly as it was. */
function ingestLocked({ mainRoot, env, home, enabledAtMs, maxLineBytes = MAX_LINE_BYTES, devLog = null }, fsx, seed = null) {
  const cursor = seed ? seed.cursor : readJson(at(mainRoot, "cursor"), {}, fsx);
  const markers = seed ? seed.markers : readJson(at(mainRoot, "markers"), {}, fsx);
  const found = discoverFiles(mainRoot, env, home, fsx);
  const result = {
    ran: true, busy: false, projectDir: found.projectDir, projectDirFound: found.projectDirFound,
    files: { seen: found.files.length, read: 0, unchanged: 0, skippedBeforeEnabled: 0 },
    rowsAdded: 0, rowsBeforeEnabled: 0, skipped: found.nonFiles ? { [SKIP_NOT_FILE]: found.nonFiles } : {}, failedRels: [],
  };
  const collected = [];
  // developer-session-log: `devLog` is `{ enabledAtMs, snapshot }` ONLY while both switches are on, handed in by
  // the caller from the MAIN tree's state. Absent, no collector exists, no line is parsed beyond today's
  // pre-filter, no file is read or written and the cursor keeps today's shape byte for byte.
  const devEntries = [];
  let markersChanged = false;
  for (const f of found.files) {
    let st;
    try { st = fsx.statSync(f.abs); } catch { continue; }
    // History before the switch was turned on is never opened: a first ingest in a long-lived repo
    // would otherwise read every transcript the machine holds.
    if (st.mtimeMs < enabledAtMs) { result.files.skippedBeforeEnabled++; continue; }
    const info = sourceInfo(f.rel);
    const c = cursor[f.rel];
    const sameFile = c && c.ino === st.ino && c.dev === st.dev;
    if (sameFile && st.size === c.size) { result.files.unchanged++; continue; }
    // A file that shrank or was replaced is read again from the start; the fold absorbs the repeat.
    const resume = sameFile && st.size >= c.offset;
    const startOffset = resume ? c.offset : 0;
    let userSeen = resume ? !!c.userSeen : false;
    if (!resume && info.kind === "subagent" && markers[info.agentId]) { delete markers[info.agentId]; markersChanged = true; }
    const fileRows = [];
    const col = devLog ? newCollector(resume ? c.devState : null, { actor: info.actor, agentId: info.agentId, sessionId: info.sessionId, enabledAtMs: devLog.enabledAtMs }) : null;
    const accept = (row) => {
      if (Date.parse(row.at) < enabledAtMs) result.rowsBeforeEnabled++;
      else fileRows.push(row);
    };
    let consumed, size;
    try {
      ({ consumed, size } = readLines(f.abs, startOffset, (line) => {
        // BEFORE the pre-filter below: composition needs the tool_result, attachment and system lines it drops.
        if (col) feedLine(col, line);
        const needsUser = info.kind === "subagent" && !userSeen;
        // Cheap pre-filter: only an assistant entry can be a row, and a sub-agent's first user entry is
        // the one other line worth parsing. Everything else (tool results, attachments) is skipped
        // unparsed — the bulk of a transcript's bytes.
        if (!needsUser && !line.includes("assistant")) return;
        const r = parseEntry(line, info);
        if (r.row) accept(r.row);
        else if (r.skip) result.skipped[r.skip] = (result.skipped[r.skip] || 0) + 1;
        else if (r.user && needsUser) {
          userSeen = true;
          if (r.marker) { markers[info.agentId] = storedMarker(r.marker); markersChanged = true; }
        }
      }, fsx, { maxLineBytes, onSkip: (reason) => { result.skipped[reason] = (result.skipped[reason] || 0) + 1; } }));
    } catch {
      // One unreadable transcript (EACCES, EISDIR, deleted since the stat) must not cost the others.
      // Its cursor entry is left exactly as it was, so the next ingest tries it again from where it was.
      result.skipped[SKIP_UNREADABLE] = (result.skipped[SKIP_UNREADABLE] || 0) + 1;
      result.failedRels.push(f.rel);
      continue;
    }
    collected.push(...fileRows);
    result.files.read++;
    let devCarry;
    if (col) { const r = finishRead(col); devEntries.push(...r.entries); devCarry = r.carry; }
    cursor[f.rel] = { offset: consumed, size, dev: st.dev, ino: st.ino, userSeen, ...(devCarry ? { devState: devCarry } : {}) };
  }
  const folded = foldRows(collected);
  result.rowsAdded = folded.length;
  fsx.mkdirSync(spendDir(mainRoot), { recursive: true });
  // The developer log is appended BEFORE the cursor write below (idempotent by message id, so a crash between the
  // two re-reads and adds nothing twice). A failure here never fails the ledger it rides on: it is reported.
  if (devLog) {
    try { result.devLog = appendDevLog(mainRoot, devEntries, devLog.snapshot, fsx); } catch { result.devLog = { failed: true }; }
  }
  const newText = folded.map((r) => JSON.stringify(storedRow(r))).join("\n") + (folded.length ? "\n" : "");
  if (seed) {
    // A transcript that could not be read keeps the rows (and the marker) the ledger already holds for
    // it: dropping them would turn "unreadable right now" into lost history.
    const failed = new Set(result.failedRels);
    const failedAgents = new Set([...failed].map((rel) => sourceInfo(rel)).filter((i) => i.kind === "subagent").map((i) => i.agentId));
    for (const id of failedAgents) if (seed.priorMarkers[id]) markers[id] = seed.priorMarkers[id];
    const carried = seed.priorRows.filter((r) => failed.has(r.source));
    const rowsText = [...seed.keptRows, ...carried].map((r) => JSON.stringify(storedRow(r))).join("\n");
    writeAtomic(at(mainRoot, "rows"), rowsText + (rowsText ? "\n" : "") + newText, fsx);
    writeAtomic(at(mainRoot, "markers"), JSON.stringify(markers) + "\n", fsx);
    writeAtomic(at(mainRoot, "cursor"), JSON.stringify(cursor) + "\n", fsx);
    return result;
  }
  if (newText) fsx.appendFileSync(at(mainRoot, "rows"), newText);
  if (markersChanged) writeAtomic(at(mainRoot, "markers"), JSON.stringify(markers) + "\n", fsx);
  // The cursor is the LAST write: a crash before it re-reads lines whose rows are already appended,
  // and the fold by message id makes that harmless.
  if (result.files.read) writeAtomic(at(mainRoot, "cursor"), JSON.stringify(cursor) + "\n", fsx);
  return result;
}

/** Incremental, idempotent ingest into the main tree's `.conductor/spend/`. `{ busy: true, ran: false }`
 *  when another ingest holds a live lock — the caller reports from the existing ledger. */
export function ingest(opts, fsx = fs) {
  const { mainRoot } = opts;
  fsx.mkdirSync(spendDir(mainRoot), { recursive: true });
  const lockPath = at(mainRoot, "lock");
  const fd = acquireLock(lockPath, Date.now(), fsx);
  if (fd === null) return { ran: false, busy: true };
  try { return ingestLocked(opts, fsx); } finally { releaseLock(fd, lockPath, fsx); }
}

/** Run `fn` while holding the ingest lock, or report `{ busy: true }` when a live ingest holds it. For the
 *  one writer outside this module that must not race an ingest: `dev-log --clear`. */
export function withLedgerLock(mainRoot, fn, fsx = fs) {
  fsx.mkdirSync(spendDir(mainRoot), { recursive: true });
  const lockPath = at(mainRoot, "lock");
  const fd = acquireLock(lockPath, Date.now(), fsx);
  if (fd === null) return { busy: true };
  try { return { busy: false, value: fn() }; } finally { releaseLock(fd, lockPath, fsx); }
}

// ───────────────────────────── reading the ledger back ─────────────────────────────

function readJsonLines(file, fsx) {
  let text;
  try { text = fsx.readFileSync(file, "utf8"); } catch { return { items: [], corrupt: 0 }; }
  const items = [];
  let corrupt = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { items.push(JSON.parse(line)); } catch { corrupt++; }
  }
  return { items, corrupt };
}

/** The ledger as the report reads it: rows FOLDED by message id, the markers, and the timeline. A
 *  missing file is an empty one. Never writes. */
export function readLedger(mainRoot, fsx = fs) {
  const rows = readJsonLines(at(mainRoot, "rows"), fsx);
  const timeline = readJsonLines(at(mainRoot, "timeline"), fsx);
  const markers = readJson(at(mainRoot, "markers"), {}, fsx);
  return {
    rawRows: rows.items, rows: foldRows(rows.items), markers: markers && typeof markers === "object" ? markers : {},
    timeline: timeline.items, corrupt: rows.corrupt + timeline.corrupt,
  };
}

/** Does any ledger file exist? Used to say "no ledger yet" rather than print zeros as if measured. */
export function ledgerExists(mainRoot, fsx = fs) {
  return ["rows", "cursor", "markers", "timeline"].some((n) => { try { return fsx.existsSync(at(mainRoot, n)); } catch { return false; } });
}

// ───────────────────────────── the inverses ─────────────────────────────

const sizeOf = (file, fsx) => { try { return fsx.statSync(file).size; } catch { return null; } };

/** What `--clear` would remove, for the plan it prints before `--yes`. */
export function clearPlan(mainRoot, { timeline = false } = {}, fsx = fs) {
  const names = ["rows", "cursor", "markers", ...(timeline ? ["timeline"] : [])];
  const remove = names.map((n) => ({ name: LEDGER_FILES[n], bytes: sizeOf(at(mainRoot, n), fsx) })).filter((x) => x.bytes !== null);
  const keep = timeline ? [] : (sizeOf(at(mainRoot, "timeline"), fsx) === null ? [] : [LEDGER_FILES.timeline]);
  return { remove, keep };
}

/** Remove the derived files (and the timeline, when asked). Returns `{ busy: true }` while an ingest
 *  holds the lock. */
export function clearLedger(mainRoot, { timeline = false } = {}, fsx = fs) {
  fsx.mkdirSync(spendDir(mainRoot), { recursive: true });
  const lockPath = at(mainRoot, "lock");
  const fd = acquireLock(lockPath, Date.now(), fsx);
  if (fd === null) return { busy: true, removed: [] };
  try {
    const removed = [];
    for (const n of ["rows", "cursor", "markers", ...(timeline ? ["timeline"] : [])]) {
      if (sizeOf(at(mainRoot, n), fsx) !== null) { fsx.rmSync(at(mainRoot, n), { force: true }); removed.push(LEDGER_FILES[n]); }
    }
    return { busy: false, removed };
  } finally { releaseLock(fd, lockPath, fsx); }
}

/** What `--rebuild` would do: the rows it re-derives and the rows it keeps because their transcript
 *  has been pruned (Claude Code prunes by `cleanupPeriodDays`; once a transcript is gone the ledger is
 *  the only copy, so a rebuild that dropped those rows would destroy history). */
export function rebuildPlan({ mainRoot, env, home }, fsx = fs) {
  const found = discoverFiles(mainRoot, env, home, fsx);
  const live = new Set(found.files.map((f) => f.rel));
  const { rawRows } = readLedger(mainRoot, fsx);
  const kept = foldRows(rawRows.filter((r) => !live.has(r.source)));
  const rederived = foldRows(rawRows.filter((r) => live.has(r.source)));
  return { live, kept: kept.length, rederived: rederived.length, filesOnDisk: found.files.length, projectDir: found.projectDir };
}

/** Re-derive the rows from the transcripts still on disk, keeping every row and marker whose source
 *  is gone, and the timeline. NOTHING is written until the ingest has finished: the new cursor, markers
 *  and rows are built in memory and swapped in at the end (rows, then markers, then cursor, each
 *  atomically), so a throw cannot lose rows for transcripts that are still on disk. A crash between the
 *  swaps leaves a stale cursor at worst, which re-reads lines the fold by message id absorbs. */
export function rebuild(opts, fsx = fs) {
  const { mainRoot } = opts;
  fsx.mkdirSync(spendDir(mainRoot), { recursive: true });
  const lockPath = at(mainRoot, "lock");
  const fd = acquireLock(lockPath, Date.now(), fsx);
  if (fd === null) return { ran: false, busy: true };
  try {
    const found = discoverFiles(mainRoot, opts.env, opts.home, fsx);
    const live = new Set(found.files.map((f) => f.rel));
    const liveAgents = new Set(found.files.map((f) => sourceInfo(f.rel)).filter((i) => i.kind === "subagent").map((i) => i.agentId));
    const { rawRows, markers } = readLedger(mainRoot, fsx);
    const keptRaw = rawRows.filter((r) => !live.has(r.source));
    const keptMarkers = Object.fromEntries(Object.entries(markers).filter(([agentId]) => !liveAgents.has(agentId)));
    const result = ingestLocked(opts, fsx, { cursor: {}, markers: keptMarkers, keptRows: keptRaw, priorRows: rawRows, priorMarkers: markers });
    return { ...result, keptRows: foldRows(keptRaw).length };
  } finally { releaseLock(fd, lockPath, fsx); }
}
