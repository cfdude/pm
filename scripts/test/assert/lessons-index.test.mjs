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
import { ADVISED_TOOLS, classifyLessons } from "../../lib/lessons.mjs";

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

// THE REPORTER FOR REJECTED MATCHERS (#194). `classifyLessons()` is the engine's own verdict — the
// one the `lesson-advice` hook projects — so this test can never disagree with what actually
// fires. A `detect:` written down that cannot work fails HERE, on the commit that wrote it, naming
// the lesson and the rule it breaks. The hook itself stays silent: an advisor that printed on a
// malformed corpus would print on every tool call.
//
// This replaced a closed grandfather list of six inert lessons (INERT_PENDING_194). All six were
// judged against the new rules: four now carry a working matcher, two had regexes over SOURCE TEXT
// being written — which no `detect` key can see — and are retrieval-only by design.
test("every declared detect: matcher is accepted by the engine's classifier", () => {
  const { rejected } = classifyLessons(DIR);
  assert.deepEqual(rejected.map(r => `${r.file}: ${r.reason}`), [],
    "a lesson's detect: is rejected — fix it, or remove it if the trigger cannot be matched precisely");
});

// The 🔔 column claims "carries a `detect:` matcher that actually parses". Held equal to the
// classifier, so the claim cannot drift from what the hook fires on in either direction.
test("the README index's 🔔 column names exactly the lessons the hook can fire", () => {
  const src = fs.readFileSync(README, "utf8");
  const belled = [...src.matchAll(/^\| \[`([a-z0-9-]+)`\]\(\1\.md\) \|.*\| 🔔 \|\s*$/gm)].map(m => m[1]).sort();
  const matchable = classifyLessons(DIR).matchable.map(l => l.file.replace(/\.md$/, "")).sort();
  assert.deepEqual(belled, matchable);
});

// ADVISED_TOOLS is what the classifier accepts as a `tool`; the hook's subscription is what the
// shipped hooks.json sends it. A tool added to one and not the other is a matcher that validates
// and can never fire, or one that could fire and is refused.
test("ADVISED_TOOLS equals the lesson-advice matcher in hooks/hooks.json", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8"));
  const entry = hooks.hooks.PreToolUse.find(e => (e.hooks || []).some(h => String(h.command).includes("lesson-advice")));
  assert.deepEqual(entry.matcher.split("|").sort(), [...ADVISED_TOOLS].sort());
});
