// scripts/test/fixtures/observe-reads.mjs
// THE RUN-TIME OBSERVER OF THE FUNCTIONAL CERTIFICATION (certification-record-redesign D3, task 3.2).
// Dev-only, never shipped, and loaded ONLY by `certify.mjs functional`, through `NODE_OPTIONS`:
//
//   --import <run>/tree/scripts/test/fixtures/observe-reads.mjs?dir=<run>/observe&root=<run>/tree
//
// WHY IT EXISTS. The functional subject is derived from source TEXT (`functionalSubject()`), and a test
// can reach a repository file in a way text does not show — a path assembled at run time, a file read
// through a helper. So while the half runs, every Node process it starts loads this module (NODE_OPTIONS
// is inherited), and it records which files UNDER THE RUN TREE that process:
//   * resolved as a module (ESM and CommonJS, through `module.registerHooks`),
//   * read through `fs` (readFile/readFileSync/promises.readFile, createReadStream, a read-mode open,
//     and the SOURCE of copyFile/cp — a directory source is recorded as the directory, which certify
//     expands to the tracked files under it), or
//   * handed to `child_process` as a script (a path-like command, or the first non-flag argument of
//     `node`, `sh`, `bash` or `zsh`).
// Certify then refuses any observed TRACKED path outside the derived subject (the record excluded).
//
// THE OBSERVER MUST SURVIVE INTO EVERY NODE CHILD (Gate 1 B4). It patches `node:child_process` — spawn,
// spawnSync, execFile, execFileSync, fork — and calls `module.syncBuiltinESMExports()`, so a test's
// named ESM import sees the patch (`--import` runs before the test module). When the command is Node
// (`process.execPath`, or a command whose basename is `node`) it writes a unique token into the child's
// environment under THIS instance's variable, WHATEVER environment the test passed, and records it as
// EXPECTED with the test file and argv. The child's observer records it as ARRIVED synchronously at load,
// before any test code runs, so a child that exits at once has still arrived. An expectation is
// CANCELLED when the spawn itself failed (a spawnSync result carrying `error`, a thrown spawn error, or
// the child's `error` event, seen by wrapping `emit` so a test's own error handling is unchanged). An
// argv of only --version / -v / --help / -h / --v8-options loads no code, and expects nothing.
//
// EACH PROCESS WRITES ITS OWN FILE, `<dir>/<pid>.<random>.json`, never a shared one, so the observer does
// not rebuild #226's shared-file race inside the run. The configuration comes from THIS module's own URL,
// never from fixed environment variable names, so an observer stacked on another — a certify run inside
// a functional test that is itself being certified — keeps its own directory, root and token variable,
// and each instance reports only to its own run.
//
// IT IS SILENT AND INVISIBLE TO THE TESTS: it prints nothing, and it reaches the filesystem only through
// the ORIGINAL functions it captured at load, so a test that wraps or counts `fs` calls counts none of
// the observer's own. Its own module file is never reported (m9: its load is not a read by the half).

import crypto from "node:crypto";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const params = new URL(import.meta.url).searchParams;
const DIR = params.get("dir");
const ROOT = params.get("root");

if (DIR && ROOT) install();

function install() {
  const orig = {
    writeFileSync: fs.writeFileSync.bind(fs),
    realpathSync: fs.realpathSync.bind(fs),
    statSync: fs.statSync.bind(fs),
  };
  const roots = [...new Set([path.resolve(ROOT), safeRealpath(ROOT)])].map((r) => r.endsWith(path.sep) ? r : r + path.sep);
  function safeRealpath(p) { try { return orig.realpathSync(p); } catch { return path.resolve(p); } }
  const TOKEN_VAR = `PM_OBSERVE_TOKEN_${crypto.createHash("sha256").update(DIR).digest("hex").slice(0, 12)}`;
  const ownFile = path.join(DIR, `${process.pid}.${crypto.randomBytes(6).toString("hex")}.json`);
  const state = {
    pid: process.pid,
    argv: process.argv.slice(1),
    test: relUnder(process.argv[1]) || process.argv[1] || null,
    arrived: process.env[TOKEN_VAR] ? [process.env[TOKEN_VAR]] : [],
    expected: [],
    cancelled: [],
    reads: new Set(),
  };
  const persist = () => {
    try {
      orig.writeFileSync(ownFile, JSON.stringify({ ...state, reads: [...state.reads].sort() }) + "\n");
    } catch { /* the run directory is gone: the certification is over */ }
  };
  // THE ARRIVAL IS WRITTEN NOW, synchronously, before any test code runs (m1).
  persist();
  process.on("exit", persist);
  globalThis[Symbol.for("pm.observe-reads")] = { url: import.meta.url, dir: DIR, root: ROOT, tokenVar: TOKEN_VAR };
  // STACKED OBSERVERS: every instance loaded in this process, in load order. NODE_OPTIONS is appended, so
  // an inner run's observer loads after the outer one's. Only the INNERMOST raises expectations: a child
  // spawned inside an inner certification is that run's to account for — its own certify fails closed on
  // an unobserved child, and that failure reaches the outer run as a failing test. Without this, a test
  // that deliberately drops the observer inside a fixture run is reported twice, the second time by an
  // outer run for whose tree the child reads nothing.
  const instances = (globalThis[Symbol.for("pm.observe-reads.instances")] ||= []);
  instances.push(DIR);
  const innermost = () => instances[instances.length - 1] === DIR;

  function toPath(p) {
    if (p instanceof URL) return p.protocol === "file:" ? fileURLToPath(p) : null;
    if (Buffer.isBuffer(p)) return p.toString();
    if (typeof p === "string") return p.startsWith("file:") ? safeFileUrl(p) : p;
    return null;
  }
  function safeFileUrl(u) { try { return fileURLToPath(u); } catch { return null; } }
  function relUnder(p, cwd = process.cwd()) {
    if (typeof p !== "string" || !p) return null;
    const abs = path.resolve(cwd, p);
    for (const r of roots) if (abs.startsWith(r)) return abs.slice(r.length).split(path.sep).join("/");
    return null;
  }
  function record(p, cwd) {
    const fsPath = toPath(p);
    if (!fsPath || path.resolve(fsPath) === SELF || safeRealpathQuiet(fsPath) === SELF) return;
    const rel = relUnder(fsPath, cwd);
    if (rel) state.reads.add(rel);
  }
  function safeRealpathQuiet(p) { try { return orig.realpathSync(p); } catch { return null; } }

  // ─── module resolutions ───
  if (typeof module.registerHooks !== "function") {
    throw new Error(`observe-reads: module.registerHooks is unavailable on Node ${process.version}; the functional certification cannot observe module resolutions — refusing to run unobserved`);
  }
  const emitWarning = process.emitWarning;
  process.emitWarning = function quiet(w, ...rest) {
    if (/registerHooks|module customization hooks/i.test(String(w && w.message ? w.message : w))) return;
    return emitWarning.call(process, w, ...rest);
  };
  try {
    module.registerHooks({
      resolve(specifier, context, nextResolve) {
        const r = nextResolve(specifier, context);
        if (r && typeof r.url === "string" && r.url.startsWith("file:")) record(r.url);
        return r;
      },
    });
  } finally {
    process.emitWarning = emitWarning;
  }

  // ─── fs reads ───
  const READ_FLAGS = new Set([undefined, null, "r", "rs", "sr", "r+", "rs+", "sr+", 0]);
  const wrap = (obj, name, pick) => {
    const f = obj[name];
    if (typeof f !== "function") return;
    obj[name] = function observed(...args) {
      try { pick(args); } catch { /* observing must never change what the call does */ }
      return f.apply(this, args);
    };
  };
  for (const n of ["readFileSync", "readFile", "createReadStream"]) wrap(fs, n, (a) => record(a[0]));
  for (const n of ["openSync", "open"]) wrap(fs, n, (a) => { if (READ_FLAGS.has(typeof a[1] === "function" ? undefined : a[1])) record(a[0]); });
  for (const n of ["copyFileSync", "copyFile", "cpSync", "cp"]) wrap(fs, n, (a) => record(a[0]));
  wrap(fs.promises, "readFile", (a) => record(a[0]));
  wrap(fs.promises, "open", (a) => { if (READ_FLAGS.has(a[1])) record(a[0]); });
  wrap(fs.promises, "copyFile", (a) => record(a[0]));
  wrap(fs.promises, "cp", (a) => record(a[0]));

  // ─── child processes ───
  const NO_CODE = new Set(["--version", "-v", "--help", "-h", "--v8-options"]);
  const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
  const isNode = (cmd) => typeof cmd === "string" && (cmd === process.execPath || /^node(\.exe)?$/i.test(path.basename(cmd)));
  const firstOperand = (args) => (args || []).find((a) => typeof a === "string" && !a.startsWith("-"));
  function scripts(cmd, args, opts) {
    const cwd = opts && opts.cwd ? String(toPath(opts.cwd) || opts.cwd) : process.cwd();
    if (typeof cmd === "string" && (cmd.includes("/") || cmd.includes(path.sep))) record(cmd, cwd);
    if (isNode(cmd) || (typeof cmd === "string" && SHELLS.has(path.basename(cmd)))) {
      const s = firstOperand(args);
      if (s) record(s, cwd);
    }
  }
  /** Normalise (cmd, args?, opts?) the way child_process does, so the token lands in the env it uses. */
  function split(argsIn, hasArgs = true) {
    const a = [...argsIn];
    const cmd = a[0];
    let args = [], opts, rest;
    if (hasArgs && Array.isArray(a[1])) { args = a[1]; opts = a[2]; rest = a.slice(3); }
    else if (hasArgs) { opts = a[1]; rest = a.slice(2); }
    else { opts = a[1]; rest = a.slice(2); }
    if (typeof opts === "function") { rest = [opts, ...(rest || [])]; opts = undefined; }
    return { cmd, args, opts, rest: rest || [] };
  }
  function expect(cmd, args, opts) {
    if (!isNode(cmd) || !innermost()) return { opts, token: null };
    if (args.length && args.every((x) => NO_CODE.has(x))) return { opts, token: null };
    const token = crypto.randomBytes(9).toString("hex");
    const env = { ...((opts && opts.env) || process.env), [TOKEN_VAR]: token };
    state.expected.push({ token, test: state.test, argv: [cmd, ...args] });
    persist();
    return { opts: { ...(opts || {}), env }, token };
  }
  function cancel(token) {
    if (!token) return;
    state.cancelled.push(token);
    persist();
  }
  const isSpawnError = (e) => e && typeof e.syscall === "string" && e.syscall.startsWith("spawn");
  function watchChild(child, token) {
    if (!token || !child || typeof child.emit !== "function") return child;
    const emit = child.emit;
    child.emit = function observedEmit(ev, ...rest) {
      if (ev === "error" && isSpawnError(rest[0])) cancel(token);
      return emit.call(this, ev, ...rest);
    };
    return child;
  }
  const cp = childProcess;
  for (const name of ["spawn", "execFile"]) {
    const f = cp[name];
    cp[name] = function observedSpawn(...a) {
      const { cmd, args, opts, rest } = split(a);
      scripts(cmd, args, opts);
      const x = expect(cmd, args, opts);
      const out = x.opts === undefined ? f.call(this, cmd, args, ...rest) : f.call(this, cmd, args, x.opts, ...rest);
      return watchChild(out, x.token);
    };
  }
  for (const name of ["spawnSync", "execFileSync"]) {
    const f = cp[name];
    cp[name] = function observedSync(...a) {
      const { cmd, args, opts } = split(a);
      scripts(cmd, args, opts);
      const x = expect(cmd, args, opts);
      let out;
      try {
        out = x.opts === undefined ? f.call(this, cmd, args) : f.call(this, cmd, args, x.opts);
      } catch (e) {
        if (isSpawnError(e)) cancel(x.token);
        throw e;
      }
      if (out && out.error && isSpawnError(out.error)) cancel(x.token);
      return out;
    };
  }
  {
    const f = cp.fork;
    cp.fork = function observedFork(modulePath, ...a) {
      const hasArgs = Array.isArray(a[0]);
      const args = hasArgs ? a[0] : [];
      const opts = hasArgs ? a[1] : a[0];
      scripts(process.execPath, [String(toPath(modulePath) || modulePath), ...args], opts);
      const x = expect(process.execPath, [String(modulePath), ...args], opts);
      return watchChild(f.call(this, modulePath, args, x.opts || {}), x.token);
    };
  }
  module.syncBuiltinESMExports();
}
