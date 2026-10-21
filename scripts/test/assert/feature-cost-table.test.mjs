// scripts/test/assert/feature-cost-table.test.mjs
// feature-switches-audit 1.2 -- the README table "What each feature costs" is held to the overhead map (design D5).
// FILE rung: it reads the README. A surface the map holds with no row, or a row naming a surface the map does not
// hold, fails the test and names the id. The numbers in the table are NOT compared here (they move with every rules
// edit); the audit document records them with their date.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "../fixtures/assert-harness.mjs";
import {
  SURFACE_FEATURES, collectSurfaces, hookVerbs, hypotheticalState, readListings, featureOf,
} from "../../lib/overhead.mjs";

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const README = fs.readFileSync(path.join(PLUGIN, "README.md"), "utf8");

/** The section of `readme` under `## What each feature costs`, up to the next `## `. */
export function costSection(readme) {
  const at = readme.indexOf("\n## What each feature costs");
  if (at < 0) return "";
  const rest = readme.slice(at + 1);
  const next = rest.indexOf("\n## ", 5);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The table's rows as `{id, text}`, keyed by the backticked surface id in the first column. */
export function tableRows(readme) {
  return costSection(readme).split("\n")
    .map((l) => /^\|\s*`([^`]+)`\s*\|/.exec(l) && { id: /^\|\s*`([^`]+)`\s*\|/.exec(l)[1], text: l })
    .filter(Boolean);
}

/** Every surface id the map holds, with every `listing:` file collapsed to the one `listing:*` row. */
export function mapIds() {
  const withSecondary = { version: 1, revision: 1, active: null, detourStack: [], epics: [], secondaryTrackers: [{ system: "jira", projectKey: "ABC" }] };
  const state = hypotheticalState(withSecondary);
  const live = collectSurfaces(state, { listings: readListings(PLUGIN), hooks: hookVerbs(PLUGIN), lessons: [] }).map((s) => s.id);
  return new Set([...Object.keys(SURFACE_FEATURES), ...live].map((id) => (id.startsWith("listing:") ? "listing:*" : id)));
}

/** The two disagreements, as sorted id lists. */
export function disagreements(readme, ids) {
  const table = new Set(tableRows(readme).map((r) => r.id));
  return {
    missingFromTable: [...ids].filter((id) => !table.has(id)).sort(),
    unknownInTable: [...table].filter((id) => !ids.has(id)).sort(),
  };
}

test("1.2 the README table covers exactly the surface ids the overhead map holds", () => {
  const d = disagreements(README, mapIds());
  assert.deepEqual(d.missingFromTable, [], `surfaces the map holds with no README row: ${d.missingFromTable.join(", ")}`);
  assert.deepEqual(d.unknownInTable, [], `README rows naming a surface the map does not hold: ${d.unknownInTable.join(", ")}`);
});

test("1.2 a surface missing from the table fails, naming the id", () => {
  const ids = mapIds();
  ids.add("rules:a-section-added-later");
  assert.deepEqual(disagreements(README, ids).missingFromTable, ["rules:a-section-added-later"]);
});

test("1.2 a table row for an unknown surface fails, naming the id", () => {
  const forged = README.replace("| `rules:feedback` |", "| `rules:feedback-renamed` |");
  assert.notEqual(forged, README, "the fixture edit applied");
  const d = disagreements(forged, mapIds());
  assert.deepEqual(d.unknownInTable, ["rules:feedback-renamed"]);
  assert.deepEqual(d.missingFromTable, ["rules:feedback"]);
});

test("1.2 every map feature id is assigned and every table row names its feature and a switch decision", () => {
  for (const id of mapIds()) assert.notEqual(id === "listing:*" ? "listings" : featureOf(id), null, id);
  for (const r of tableRows(README)) {
    const cells = r.text.split("|").map((c) => c.trim()).filter(Boolean);
    assert.equal(cells.length, 4, `${r.id}: surface, feature, cost, switch`);
    assert.match(cells[2], /tokens|not injected|not measured/, `${r.id}: a cost or why there is none`);
    assert.match(cells[3], /no switch|set-[a-z-]+/, `${r.id}: a switch or 'no switch'`);
  }
});

test("1.2 the listings row says `no switch` and gives the reason", () => {
  const row = tableRows(README).find((r) => r.id === "listing:*");
  assert.ok(row);
  assert.match(row.text, /no switch: the host reads the plugin's files/);
});

test("1.2 a record-integrity rule is never switched: the gate procedure row says `no switch` with its reason", () => {
  const row = tableRows(README).find((r) => r.id === "rules:the-gate-procedure");
  assert.match(row.text, /no switch: the required gate items are a record-integrity rule/);
});

test("1.2 the spend-tracking row names the real verb and its own cost; the table says every figure is an estimate", () => {
  const row = tableRows(README).find((r) => r.id === "rules:spend-tracking");
  assert.match(row.text, /`set-spend-tracking on`/);
  assert.match(row.text, /~\d+ tokens/);
  assert.match(costSection(README), /bytes\/4, an estimate/);
});

test("a new repo pays nothing for developer features: spend tracking, spend guard and the developer log are off at 0 bytes", () => {
  const cwd = fs.realpathSync(tmpRepo());
  run(["init"], { cwd });
  const j = JSON.parse(run(["overhead", "--json"], { cwd }));
  for (const id of ["spendTracking", "spendGuard", "devLog"]) {
    assert.equal(j.features[id].on, false, id);
    assert.equal(j.features[id].bytes, 0, id);
  }
  assert.equal(j.features.spendTracking.perDispatchBytes, 0);
  run(["upgrade"], { cwd });
  const after = JSON.parse(run(["overhead", "--json"], { cwd }));
  for (const id of ["spendTracking", "spendGuard", "devLog"]) assert.equal(after.features[id].on, false, `upgrade left ${id} off`);
});
