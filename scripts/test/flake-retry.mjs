// scripts/test/flake-retry.mjs
// FLAKE QUARANTINE AND TARGETED RE-RUN (epic flaky-test-quarantine-and-targeted-rerun, 0.51.0).
// Dev-only, plain Node, no dependency, in the test tree — not part of what the plugin ships.
//
// WHAT IT DOES. A suite run that failed is not re-run whole. The failed test FILES are read out of
// the runner's own spec output (`test at <file>:<line>:<col>` under `✖ failing tests:`) and ONLY those
// files run once more, with the same environment:
//   * pass on the retry and the test is listed in `scripts/test/known-flakes.json`  → a pass, printed as
//     "known flake";
//   * pass on the retry and the test is NOT listed → still a pass, printed LOUDLY as
//     "UNLISTED flake: <file> <test>" so nobody gets a second chance silently;
//   * fail on the retry → a real failure, exactly as before.
// Each retried test appends ONE JSON line to the gitignored ledger `.test-flakes.log` at the repository
// root: `{at, file, test, load1, outcome}` — `load1` is `os.loadavg()[0]`, because these flakes are
// load-bound (a 2000 ms bound, a SIGTERM race), and the ledger is how that gets shown rather than guessed.
//
// WHAT IT NEVER DOES. It never retries a run it cannot read: a status other than 1 (a timer kill or a
// signal), an unreadable or zero fail count, or ANY failure whose file is not one the runner was given
// (a test declared through a helper reports the helper's path — `unitTest()` in the unit rung does) is a
// real failure. A retry that could mask a crash is worse than none.
//
// ONE IMPLEMENTATION, TWO CALLERS: certify.mjs (the functional and sweeps buckets, async over the run
// directory) and `.githooks/pre-commit` (the assertion half, through the CLI at the bottom). IO is
// injected (`io`), so the unit rung exercises every branch with no filesystem work. IMPORT-SAFE:
// importing this module runs nothing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const FLAKE_LEDGER = ".test-flakes.log";
export const KNOWN_FLAKES_FILE = "scripts/test/known-flakes.json";

const posix = (p) => p.split(path.sep).join("/");

/** One count from the runner's spec summary, or null: `ℹ <label> N` at the start of a line. ONE FORMAT (0.49.0,
 *  design D4): the runner is started with `--test-reporter=spec` and `FORCE_COLOR=0`, so the summary is these
 *  bytes on every supported Node major. A TAP summary (`# tests N`) or a coloured one is NOT read. The single
 *  definition: certify.mjs imports and re-exports it. */
export function summaryCount(output, label) {
  const m = new RegExp(`^ℹ ${label} (\\d+)$`, "m").exec(output);
  return m ? Number(m[1]) : null;
}

export const countsOf = (output) => ({
  tests: summaryCount(output, "tests"), pass: summaryCount(output, "pass"), fail: summaryCount(output, "fail"),
});

/** The failures a spec-reporter run lists: `[{ file, test }]` plus how many could NOT be mapped to a file
 *  the runner was given. `file` is root-relative and posix. `cwd` is the directory the runner ran in (the
 *  `test at` path is relative to it), `files` the absolute paths it was handed. Both sides go through
 *  `realpath`, because Node reports the REAL path and a macOS temp directory is a symlink. */
export function failuresOf(output, { cwd, files, realpath = (p) => p }) {
  const real = (p) => { try { return realpath(p); } catch { return p; } };
  const base = real(cwd);
  const given = new Set(files.map((f) => posix(path.relative(base, real(f)))));
  const lines = String(output).split("\n");
  const start = lines.findIndex((l) => l.trim() === "✖ failing tests:");
  const failures = [];
  let unmapped = 0;
  if (start < 0) return { failures, unmapped: 1 };   // a failed run that lists nothing is unreadable
  // EVERY top-level `✖ <name>` entry is a failure; the `test at` line before it, when the runner printed
  // one, is its location. Node prints that line only for a test with a file, so an entry WITHOUT one (a
  // file-level failure such as `process.exitCode = 1`) is UNMAPPED — never silently dropped, or a retry
  // of some other file's flake would be recorded as a recovery that masked it. Error bodies are indented,
  // so a `✖` at column 0 is always an entry. A `test at` with no entry after it is unmapped too.
  let pending = null;
  for (let i = start + 1; i < lines.length; i++) {
    const at = /^test at (.+):(\d+):(\d+)\s*$/.exec(lines[i]);
    if (at) { if (pending) unmapped++; pending = at; continue; }
    const named = /^✖ (.*?)(?: \([\d.]+m?s\))?\s*$/.exec(lines[i]);
    if (!named) continue;
    const loc = pending; pending = null;
    const rel = loc ? posix(path.relative(base, path.resolve(base, loc[1]))) : null;
    if (rel === null || !given.has(rel)) { unmapped++; continue; }
    failures.push({ file: rel, test: named[1] });
  }
  if (pending) unmapped++;
  return { failures, unmapped };
}

/** `known-flakes.json` as `{ entries, error }`. Absent reads as no entries; malformed reads as no entries
 *  PLUS an error the caller prints, so a typo can never quietly turn a flake into "known". */
export function loadKnownFlakes(file, io = fs) {
  let text;
  try { text = io.readFileSync(file, "utf8"); } catch { return { entries: [], error: null }; }
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) throw new Error("not an array");
    const entries = v.filter((e) => e && typeof e.file === "string" && typeof e.test === "string");
    return { entries, error: entries.length === v.length ? null : "an entry lacks a string `file` or `test`" };
  } catch (e) {
    return { entries: [], error: `${file} is unreadable (${e.message})` };
  }
}

/** Is `test` in `file` listed? `entry.test` is matched as a SUBSTRING of the failing test's name, so a
 *  listing survives a rename of its trailing words but never matches another file. */
export const isKnownFlake = (entries, file, test) =>
  entries.some((e) => e.file === file && test.includes(e.test));

/** One ledger line. Pure; `at` is an ISO time. */
export function ledgerLine({ at, file, test, load1, outcome }) {
  return `${JSON.stringify({ at, file, test, load1, outcome })}\n`;
}

/** After a failed run: retry only the failed files once and classify. Returns
 *    `{ recovered, reason, messages, counts, retried, retryOutput }`
 *  `recovered` true means every failure passed on the retry (the run counts as a pass). `rerun(absFiles)`
 *  is async and returns `{ status, output }`; `files` are the absolute paths the failed run was given. */
export async function recoverFlakes({
  output, status, counts = countsOf(output), cwd, files, ledgerRoot, knownFile, rerun,
  io = fs, now = () => new Date(), load = () => os.loadavg()[0], realpath = fs.realpathSync,
}) {
  const none = (reason) => ({ recovered: false, reason, messages: [], counts, retried: [], retryOutput: "" });
  if (status !== 1) return none(`exit status ${status} is not a test failure (a kill or a signal is never retried)`);
  if (counts.tests === null || counts.fail === null) return none("the failed run's count could not be read");
  if (!(counts.fail > 0)) return none("the failed run reports no failing test");
  const { failures, unmapped } = failuresOf(output, { cwd, files, realpath });
  if (failures.length + unmapped !== counts.fail) {
    return none(`the listing holds ${failures.length + unmapped} failure(s) but the runner's summary counts ${counts.fail}`);
  }
  if (unmapped > 0 || failures.length === 0) {
    return none(`${unmapped} failure(s) could not be mapped to a test file the runner was given`);
  }
  const retried = [...new Set(failures.map((f) => f.file))];
  const retry = await rerun(retried.map((rel) => path.join(path.resolve(cwd), rel)));
  const stillFailing = retry.status === 0 ? [] : failuresOf(retry.output, { cwd, files, realpath }).failures;
  const known = loadKnownFlakes(knownFile, io);
  const messages = [];
  if (known.error) messages.push(`flake-retry: WARNING — ${known.error}; every flake below is treated as UNLISTED`);
  const ledger = [];
  let allPassed = retry.status === 0;
  for (const f of failures) {
    const failedAgain = retry.status !== 0 && (stillFailing.length === 0 || stillFailing.some((s) => s.file === f.file && s.test === f.test));
    const outcome = failedAgain ? "failed-on-retry" : "passed-on-retry";
    ledger.push(ledgerLine({ at: now().toISOString(), file: f.file, test: f.test, load1: load(), outcome }));
    if (outcome === "passed-on-retry") {
      messages.push(isKnownFlake(known.entries, f.file, f.test)
        ? `known flake (passed on retry, not to be diagnosed): ${f.file} — ${f.test}`
        : `UNLISTED flake: ${f.file} ${f.test}  <<< passed on retry but is NOT in ${KNOWN_FLAKES_FILE} — it needs an owning epic or a fix`);
    } else {
      messages.push(`failed twice: ${f.file} — ${f.test}`);
    }
  }
  try { io.appendFileSync(path.join(ledgerRoot, FLAKE_LEDGER), ledger.join("")); }
  catch (e) { messages.push(`flake-retry: could not append to ${FLAKE_LEDGER} (${e.message})`); }
  if (!allPassed) return { recovered: false, reason: "a retried test failed again", messages, counts, retried, retryOutput: retry.output };
  // Every failed test passed on the retry: the first run's passes plus its failures, all passing.
  const merged = { tests: counts.tests, pass: counts.pass + counts.fail, fail: 0 };
  return { recovered: true, reason: null, messages, counts: merged, retried, retryOutput: retry.output };
}

// ───────────────────────────── the CLI, for .githooks/pre-commit ─────────────────────────────
//   node flake-retry.mjs hook --root <repo> --cwd <snapshot> --output <file> --status <n> --dirs a,b
// Exit 0 and one stdout line `recovered <tests> <pass>` when every failure passed on the retry; exit 1
// otherwise, with the reason on stderr. The messages always go to stderr, where the hook's output is read.

// argv[2] FIRST, so merely importing this module (the unit rung's guard counts a realpath read) does no fs work.
const invokedDirectly = process.argv[2] === "hook" && (() => {
  try { return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

if (invokedDirectly) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : undefined; };
  const cwd = path.resolve(arg("--cwd"));
  const dirs = String(arg("--dirs") || "").split(",").filter(Boolean);
  const files = dirs.flatMap((d) => {
    let names = [];
    try { names = fs.readdirSync(path.join(cwd, d)); } catch { names = []; }
    return names.filter((n) => n.endsWith(".test.mjs") && !n.startsWith(".")).sort().map((n) => path.join(cwd, d, n));
  });
  const output = fs.readFileSync(arg("--output"), "utf8");
  const result = await recoverFlakes({
    output, status: Number(arg("--status")), cwd, files, ledgerRoot: path.resolve(arg("--root")),
    knownFile: path.join(cwd, KNOWN_FLAKES_FILE),
    rerun: (abs) => {
      const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...abs],
        { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0" } });
      return { status: r.status, output: `${r.stdout || ""}${r.stderr || ""}` };
    },
  });
  for (const m of result.messages) process.stderr.write(`pre-commit: ${m}\n`);
  if (!result.recovered) {
    process.stderr.write(`pre-commit: no retry recovered the failure — ${result.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`recovered ${result.counts.tests} ${result.counts.pass}\n`);
}
