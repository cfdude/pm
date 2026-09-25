// scripts/test/assert/support-floor.test.mjs
// 0.49.0 task 4.2b — THE SCHEDULE FILTER CI's MATRIX IS COMPUTED BY, and the support floor's copies.
//
// WHAT IT PROVES (runtime-support's first two requirements, design D1/D2):
//   * `supportedMajors(schedule, today)` applies ALL THREE conditions — an `lts` date present (it may
//     be in the future), `start <= today`, `end > today` — and each one, on its own, decides one entry
//     of a CANNED schedule. On the live schedule of 2026-09-24 dropping the start clause OR the lts
//     clause still yields [22,24,26], so only a canned schedule can prove each clause is there;
//   * `decide()` owns every row of design D2's table: a failed fetch falls back WITH a warning; a
//     fetched body that is not a readable schedule is an ERROR and never the fallback; a computed set
//     that differs from the committed list is an error naming both; an empty set is an error.
//
// The filter is a committed dev script rather than inline `jq` for exactly this reason: a `jq` filter
// in the workflow could not be falsified by any per-commit check (Gate 1 B5).

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as majors from "../node-majors.mjs";
import { NODE_FLOOR_MAJOR } from "../../lib/runtime-support.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const TODAY = "2026-09-24";

/** Four entries, each decided by ONE clause alone, plus one that passes all three. */
const CANNED = {
  // lts date present, end in the future — but STARTS after today: excluded by the start clause alone.
  v30: { start: "2027-04-22", lts: "2027-10-26", end: "2030-04-30" },
  // live today (started, not ended) — but NO lts key: excluded by the lts clause alone.
  v31: { start: "2025-10-15", end: "2026-12-01" },
  // lts date present and started — but its end is ON today: excluded by the end clause alone.
  v32: { start: "2023-04-18", lts: "2023-10-24", end: TODAY },
  // live today, with an lts date still in the FUTURE: included (the date may be ahead of today).
  v33: { start: "2026-05-05", lts: "2026-10-28", end: "2029-04-30" },
  // a pre-1.0 line the schedule also carries: never a major.
  "v0.12": { start: "2015-02-06", end: "2016-12-31" },
};

test("4.2b each of the three clauses decides one entry of a canned schedule on its own", () => {
  assert.deepEqual(majors.supportedMajors(CANNED, TODAY), [33],
    "only the entry that has an lts date, has started, and has not ended is supported");
});

test("4.2b the live 2026-09-24 shape yields [22,24,26] — not 18, 20 (ended), 23, 25 (no lts) or 27 (not started)", () => {
  const live = {
    v18: { start: "2022-04-19", lts: "2022-10-25", end: "2025-04-30" },
    v20: { start: "2023-04-18", lts: "2023-10-24", end: "2026-04-30" },
    v22: { start: "2024-04-24", lts: "2024-10-29", end: "2027-04-30" },
    v23: { start: "2024-10-16", end: "2025-06-01" },
    v24: { start: "2025-05-06", lts: "2025-10-28", end: "2028-04-30" },
    v25: { start: "2025-10-15", end: "2026-06-01" },
    v26: { start: "2026-05-05", lts: "2026-10-28", end: "2029-04-30" },
    v27: { start: "2027-04-22", end: "2030-04-30" },
  };
  assert.deepEqual(majors.supportedMajors(live, TODAY), [22, 24, 26]);
});

test("4.2b decide(): a failed fetch uses the committed fallback AND says so", () => {
  const d = majors.decide({ fetched: false, body: "", today: TODAY, fallback: "[22,24,26]" });
  assert.equal(d.error, undefined, `a failed fetch is not an error: ${d.error}`);
  assert.deepEqual(d.majors, [22, 24, 26], "the matrix is the committed fallback");
  assert.match(d.warning || "", /fallback/i, "and the run must carry a warning naming the fallback");
  assert.match(d.warning || "", /\[22,24,26\]/, "the warning names the list it fell back to");
});

test("4.2b decide(): a fetched body that is not a readable schedule is an ERROR, never the fallback", () => {
  for (const body of ["<html>404</html>", "{", "null", "[]", JSON.stringify({ v22: { codename: "Jod" } })]) {
    const d = majors.decide({ fetched: true, body, today: TODAY, fallback: "[22,24,26]" });
    assert.match(d.error || "", /unreadable/i, `body ${JSON.stringify(body)} must be refused as unreadable`);
    assert.equal(d.majors, undefined, `an unreadable schedule must not fall back: ${JSON.stringify(body)}`);
  }
});

test("4.2b decide(): a computed set that differs from the committed list fails, naming both", () => {
  const d = majors.decide({ fetched: true, body: JSON.stringify(CANNED), today: TODAY, fallback: "[22,24,26]" });
  assert.match(d.error || "", /\[33\]/, `the error names the computed set: ${d.error}`);
  assert.match(d.error || "", /\[22,24,26\]/, `and the committed list: ${d.error}`);
  assert.equal(d.majors, undefined);
});

test("4.2b decide(): an empty set is an error, computed or fallen back to", () => {
  const none = JSON.stringify({ v18: { start: "2022-04-19", lts: "2022-10-25", end: "2025-04-30" } });
  const computed = majors.decide({ fetched: true, body: none, today: TODAY, fallback: "[22,24,26]" });
  assert.match(computed.error || "", /empty/i, `an empty computed set must fail: ${computed.error}`);
  const fallback = majors.decide({ fetched: false, body: "", today: TODAY, fallback: "[]" });
  assert.match(fallback.error || "", /empty/i, `an empty fallback must fail too: ${fallback.error}`);
});

test("4.2b decide(): an agreeing schedule yields the computed set with no warning", () => {
  const body = JSON.stringify({
    v22: { start: "2024-04-24", lts: "2024-10-29", end: "2027-04-30" },
    v24: { start: "2025-05-06", lts: "2025-10-28", end: "2028-04-30" },
    v26: { start: "2026-05-05", lts: "2026-10-28", end: "2029-04-30" },
  });
  const d = majors.decide({ fetched: true, body, today: TODAY, fallback: "[22,24,26]" });
  assert.deepEqual(d, { majors: [22, 24, 26] });
});

// ─────────────── EVERY DOCUMENTED COPY OF THE SUPPORT FLOOR EQUALS THE CONSTANT (Gate 1 I10) ───────────────
//
// The support floor is copied into prose a user or contributor reads — "Node N+". Each copy must equal
// NODE_FLOOR_MAJOR, and a mismatch names the file and both values (runtime-support's first
// requirement: "A documented support floor that disagrees with the constant fails"). Each file is
// listed with the number of copies it must hold, so a copy that is deleted — rather than corrected —
// fails too. Added with the docs tasks that rewrote those lines (7.1 CONTRIBUTING, 7.2 README;
// 7.3 adds CLAUDE.md), as task 4.2b schedules.

/** Every `Node N+` claim in `text`, as numbers. */
export function floorClaims(text) {
  return [...text.matchAll(/\bNode (\d+)\+/g)].map((m) => Number(m[1]));
}

/** The refusals for one file: a copy count below `min`, and every copy that is not `floor`. */
export function floorCopyRefusals(file, text, min, floor = NODE_FLOOR_MAJOR) {
  const claims = floorClaims(text);
  const out = [];
  if (claims.length < min) out.push(`${file}: holds ${claims.length} 'Node N+' support-floor claim(s), expected at least ${min}`);
  for (const n of claims) {
    if (n !== floor) out.push(`${file}: states the support floor as Node ${n}+, but NODE_FLOOR_MAJOR is ${floor}`);
  }
  return out;
}

const FLOOR_COPIES = [["README.md", 2], ["CONTRIBUTING.md", 1], ["CLAUDE.md", 1]];

test("the documented support floor — every 'Node N+' copy — equals NODE_FLOOR_MAJOR", () => {
  const found = FLOOR_COPIES.flatMap(([file, min]) =>
    floorCopyRefusals(file, fs.readFileSync(path.join(REPO, file), "utf8"), min));
  assert.deepEqual(found, []);
});

test("the support-floor copy check DISCRIMINATES — a stale copy is named with both values", () => {
  assert.deepEqual(floorCopyRefusals("README.md", "Requirements: Node 18+ (…)", 1, 22),
    ["README.md: states the support floor as Node 18+, but NODE_FLOOR_MAJOR is 22"]);
  assert.match(floorCopyRefusals("README.md", "no claim here", 1, 22).join(""), /holds 0/);
  assert.deepEqual(floorCopyRefusals("README.md", "Node 22+ and Node 22+", 2, 22), []);
});
