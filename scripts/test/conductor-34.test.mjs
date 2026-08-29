import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "./helpers.mjs";
import { GATE_PROCEDURE_ITEMS } from "../lib/rules.mjs";

// gh-89 / gh-90 / gh-114 / gh-154 — four INSTRUCTION-layer issues. Nothing here changes what
// the engine computes; all four change what pm EMITS. So every assertion below is made against
// the RENDERED text (`rules`) and the SHIPPED markdown, never against the generator's source —
// a test that greps `rules.mjs` passes for a line emitted on no reachable branch.

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shipped = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const rulesText = (cwd) => run(["rules"], { cwd });

/** The three shipped markdown mirrors of the emitted procedure — the same list conductor-16's
 *  drift guards use. Named here rather than imported so this file states its own population. */
const EMITTED_DOCS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];

const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Every numbered item in a body of emitted text, as `<n>. <title>` — the FORM check. A prose
 *  bullet does not appear here, which is what makes "downgraded to a bullet" a failing test
 *  rather than a cosmetic difference. 14/14 against 3/15 is why the form is asserted at all. */
const numberedItems = (text) =>
  text.split("\n").filter(l => /^\d+\. /.test(l.trim())).map(l => l.trim());

function initRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}

// ───────────── 34.1 (#154): the openspec-validate collision is documented where the marker is ─────────────
//
// `openspec validate --archived` counts raw checkboxes and knows nothing of `<!-- pm:lifecycle -->`,
// so it fails EVERY correctly archived pm change: the archive task is unticked at archive time by
// construction. Its own help text offers it for pre-commit linting, which is exactly how a repo
// acquires a hook that can never go green. pm cannot fix someone else's lint; what it can do is
// make sure the warning sits where the marker is documented, so the person about to wire it in
// reads it first.

test("34.1 every surface that documents the lifecycle marker also names the lint it collides with", () => {
  const surfaces = [
    ["rules block", rulesText(initRepo())],
    ...EMITTED_DOCS.map(rel => [rel, shipped(rel)]),
    ["README.md", shipped("README.md")],
  ];
  // Per-surface, deliberately: asserting against the surfaces JOINED would stay green when the
  // warning is deleted from three of the four.
  for (const [name, text] of surfaces) {
    const t = norm(text);
    assert.ok(t.includes(norm("openspec validate --archived")),
      `${name} documents the pm:lifecycle marker but never names the command that collides with it`);
    assert.ok(t.includes(norm("do not wire it into a pm-managed repo")),
      `${name} must say outright not to wire that lint into a pm-managed repo`);
    // The reason, not just the prohibition: without it a reader treats the failure as a bug in
    // their own tasks.md and "fixes" it by ticking the archive task, which is a false record.
    assert.match(text, /raw checkboxes/i,
      `${name} must say WHY the lint disagrees — it counts raw checkboxes`);
  }
});

test("34.1 the collision rides item 3's mustSay, so a reworded mirror cannot drop it", () => {
  const item = GATE_PROCEDURE_ITEMS.find(i => i.title === "Declare lifecycle bookkeeping.");
  assert.ok(item, "the lifecycle-bookkeeping item must still exist under that title");
  for (const claim of ["openspec validate --archived", "do NOT wire it into a pm-managed repo"]) {
    assert.ok(item.mustSay.some(c => norm(c) === norm(claim)),
      `"${claim}" must be declared in item 3's mustSay — otherwise conductor-16's 15.5 guard ` +
      "compares titles only and a mirror can drop the warning silently");
  }
  // It stays a NUMBERED required task item, not a prose bullet appended underneath it.
  const items = numberedItems(rulesText(initRepo())).join("\n");
  assert.match(items, /\*\*Declare lifecycle bookkeeping\.\*\*/);
});
