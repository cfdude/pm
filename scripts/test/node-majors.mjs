// scripts/test/node-majors.mjs
// 0.49.0 (runtime-support, design D2) — THE SET OF NODE MAJORS CI TESTS, computed from Node's release
// schedule rather than typed. Dev-only, plain Node, no dependency, not shipped (the parity ledger walks
// commands/, agents/, skills/, hooks/ and .claude-plugin/ only), and not a test file — its test is
// `scripts/test/assert/support-floor.test.mjs`, on the file rung.
//
// A MAJOR IS SUPPORTED exactly when its schedule entry carries an `lts` date (it may still be in the
// future), its `start` is on or before today and its `end` is after today — "today" being the UTC date.
// The same set is what pm calls supported (runtime-support's first requirement), so "supported" and
// "tested" name one set, never two. Each clause is exercised on its own by a canned schedule: on the
// live schedule of 2026-09-24 dropping the start clause OR the lts clause still yields [22,24,26], so
// nothing but a canned schedule could prove either is there.
//
// EVERY DECISION IN DESIGN D2's TABLE IS `decide()`'s:
//   * the fetch failed               → the committed fallback, and a WARNING saying so;
//   * the body is not a schedule     → an ERROR (unreadable). Never the fallback: the fallback is for an
//                                      unreachable host, and a readable-looking failure silently
//                                      becoming it is the "computed from nothing" this exists to stop;
//   * computed ≠ the committed list  → an ERROR naming both (the list cannot rot unnoticed);
//   * an empty set, either way       → an ERROR.
//
// THE CLI TAIL is what CI's `node-majors` job runs, after `curl` has fetched the schedule to a file:
//   node scripts/test/node-majors.mjs --today "$(date -u +%F)" --fallback "$PM_NODE_FALLBACK" \
//     (--schedule <file> | --fetch-failed) [--output "$GITHUB_OUTPUT"]
// It prints the array, writes `majors=<array>` to --output, prints `::warning::` (and appends it to
// $GITHUB_STEP_SUMMARY when that is set) or `::error::` with exit 1. The FETCH stays in the workflow:
// this script opens no connection.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAJOR_KEY = /^v(\d+)$/;

/** The majors `schedule` supports on `today` (YYYY-MM-DD), ascending. Keys that are not `vN` (the
 *  pre-1.0 `v0.x` lines) are never majors. ISO dates compare correctly as strings. */
export function supportedMajors(schedule, today) {
  const out = [];
  for (const [key, entry] of Object.entries(schedule || {})) {
    const m = MAJOR_KEY.exec(key);
    if (!m || !entry || typeof entry !== "object") continue;
    if (!("lts" in entry)) continue;          // an LTS line — the date may be in the future
    if (!(entry.start <= today)) continue;    // it has started
    if (!(entry.end > today)) continue;       // and it has not ended
    out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

/** A schedule this script can read: a JSON object holding at least one entry with both `start` and
 *  `end`. Anything else — HTML from an error page, truncated JSON, `null`, an array, an object of
 *  entries without dates — is unreadable. */
function readSchedule(body) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const readable = Object.values(parsed).some((e) => e && typeof e === "object" && "start" in e && "end" in e);
  return readable ? parsed : null;
}

const show = (arr) => JSON.stringify(arr);

/** Every row of design D2's table. `fallback` is the committed list as the workflow holds it (a JSON
 *  array string). Returns `{ majors }`, `{ majors, warning }` or `{ error }` — never both a set and an
 *  error. */
export function decide({ fetched, body, today, fallback }) {
  let committed;
  try { committed = JSON.parse(fallback); } catch { committed = null; }
  if (!Array.isArray(committed) || !committed.every((n) => Number.isInteger(n))) {
    return { error: `the committed fallback PM_NODE_FALLBACK is not a JSON array of majors: ${fallback}` };
  }
  if (!fetched) {
    if (!committed.length) return { error: "the committed fallback PM_NODE_FALLBACK is empty — no major to test" };
    return {
      majors: committed,
      warning: `the Node release schedule could not be fetched — the matrix is the committed fallback ${show(committed)}, not a computed set`,
    };
  }
  const schedule = readSchedule(body);
  if (!schedule) {
    return { error: "the fetched Node release schedule is unreadable (not a JSON object with any start/end entry) — refusing to fall back on a schedule that answered" };
  }
  const computed = supportedMajors(schedule, today);
  if (!computed.length) return { error: `the computed set of supported Node majors is empty on ${today}` };
  if (show(computed) !== show(committed)) {
    return {
      error: `the computed set of supported Node majors ${show(computed)} differs from the committed fallback ` +
        `PM_NODE_FALLBACK ${show(committed)} — move the fallback, NODE_FLOOR_MAJOR and the documented support floor together`,
    };
  }
  return { majors: computed };
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv, { env = process.env, out = process.stdout } = {}) {
  const today = arg(argv, "--today");
  const fallback = arg(argv, "--fallback");
  const schedulePath = arg(argv, "--schedule");
  const fetchFailed = argv.includes("--fetch-failed");
  if (!today || fallback === undefined || (!schedulePath && !fetchFailed)) {
    out.write("::error::usage: node scripts/test/node-majors.mjs --today YYYY-MM-DD --fallback '<json array>' " +
      "(--schedule <file> | --fetch-failed) [--output <file>]\n");
    return 1;
  }
  const d = decide({
    fetched: !fetchFailed,
    body: fetchFailed ? "" : fs.readFileSync(schedulePath, "utf8"),
    today,
    fallback,
  });
  if (d.error) {
    out.write(`::error::${d.error}\n`);
    return 1;
  }
  if (d.warning) {
    out.write(`::warning::${d.warning}\n`);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `⚠ ${d.warning}\n`);
  }
  out.write(`${show(d.majors)}\n`);
  const output = arg(argv, "--output");
  if (output) fs.appendFileSync(output, `majors=${show(d.majors)}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
