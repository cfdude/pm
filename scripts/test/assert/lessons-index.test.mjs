// docs/lessons/README.md is this repo's index of its own lesson corpus, and it drifted: six
// lessons were absent from it while the file claimed the table "is generated from the files and
// stays honest". Nothing noticed, because a missing row is invisible from every direction — the
// engine's `lesson-advice` hook reads the DIRECTORY and never the index, so the mechanism stayed
// correct while the human-facing surface went stale.
//
// pm OWNS THE MECHANISM, NEVER THE CORPUS (see scripts/lib/lessons.mjs). This file is therefore a
// REPO test, the same shape as parity.test.mjs: it guards this repository's docs against its own
// directory, and asserts nothing about what a consumer's corpus must contain.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = path.join(ROOT, "docs", "lessons");
const README = path.join(DIR, "README.md");

const lessons = fs.readdirSync(DIR)
  .filter(f => f.endsWith(".md") && f !== "README.md")
  .map(f => f.replace(/\.md$/, ""))
  .sort();

test("every lesson file appears in the README index", () => {
  const src = fs.readFileSync(README, "utf8");
  const missing = lessons.filter(n => !src.includes(`[\`${n}\`](${n}.md)`));
  assert.deepEqual(missing, [], `lessons absent from docs/lessons/README.md: ${missing.join(", ")}`);
});

test("every lesson file appears in the enforced-in table", () => {
  const src = fs.readFileSync(README, "utf8");
  const missing = lessons.filter(n => !src.includes(`| \`${n}\` |`));
  assert.deepEqual(missing, [], `lessons absent from the enforced-in table: ${missing.join(", ")}`);
});

test("the README index links nothing that is not a lesson file", () => {
  const src = fs.readFileSync(README, "utf8");
  const linked = [...src.matchAll(/\[`([a-z0-9-]+)`\]\(\1\.md\)/g)].map(m => m[1]);
  const orphans = [...new Set(linked)].filter(n => !lessons.includes(n));
  assert.deepEqual(orphans, [], `index rows with no lesson file: ${orphans.join(", ")}`);
});

// The frontmatter contract the README states: trigger, cost, rule, enforced_in. `rule` is the one
// the engine actually reads — `adviceText()` renders `• ${h.rule}` — so a lesson missing it would
// surface as an empty bullet if its matcher ever fired. Four lessons were missing it, saved from
// that outcome only by their matchers being inert for an unrelated reason.
test("every lesson carries the four contract fields", () => {
  for (const n of lessons) {
    const txt = fs.readFileSync(path.join(DIR, `${n}.md`), "utf8");
    const fm = txt.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${n}: no frontmatter block`);
    for (const key of ["trigger", "cost", "rule", "enforced_in"]) {
      assert.match(fm[1], new RegExp(`^${key}: \\S`, "m"), `${n}: missing or empty \`${key}:\``);
    }
  }
});

// A `detect:` that does not parse is skipped by `matchableLessons()` and the lesson silently
// becomes retrieval-only — how six of them died. This test does NOT require a lesson to have a
// matcher (most correctly do not); it requires that one WRITTEN DOWN actually works. Six are
// grandfathered while #194 decides whether the fix is a lint surface, a content matcher, or both;
// the list is closed, so a seventh fails here rather than joining them.
const INERT_PENDING_194 = new Set([
  "a-fixture-reconstructed-from-live-data-dies-when-the-data-improves",
  "a-silent-noop-edit-reports-success",
  "an-unused-active-pointer-turns-a-true-check-into-noise",
  "cite-a-symbol-not-a-line-number",
  "second-resolution-timestamps-collide-on-fast-machines",
  "stacked-background-commits-collide-on-the-lock",
]);

test("a declared detect: matcher parses as a JSON object, or is a known-inert one", () => {
  for (const n of lessons) {
    const txt = fs.readFileSync(path.join(DIR, `${n}.md`), "utf8");
    const raw = txt.match(/^---\n([\s\S]*?)\n---/)[1].match(/^detect: (.+)$/m);
    if (!raw) continue;                       // no matcher is a design choice, not a defect
    if (INERT_PENDING_194.has(n)) continue;
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw[1]); },
      `${n}: \`detect:\` must be a JSON object like {"tool":"Bash","commandMatches":"…"}, not a bare regex`);
    assert.equal(typeof parsed, "object", `${n}: \`detect:\` parsed to a non-object`);
    assert.ok(parsed !== null, `${n}: \`detect:\` is null`);
  }
});

test("the grandfathered-inert list names only lessons that exist and are still inert", () => {
  for (const n of INERT_PENDING_194) {
    assert.ok(lessons.includes(n), `${n}: listed as inert but there is no such lesson`);
    const txt = fs.readFileSync(path.join(DIR, `${n}.md`), "utf8");
    const raw = txt.match(/^---\n([\s\S]*?)\n---/)[1].match(/^detect: (.+)$/m);
    assert.ok(raw, `${n}: listed as inert but declares no \`detect:\` — drop it from the list`);
    let ok = false;
    try { const d = JSON.parse(raw[1]); ok = !!d && typeof d === "object"; } catch {}
    assert.equal(ok, false, `${n}: \`detect:\` now parses — remove it from INERT_PENDING_194`);
  }
});
