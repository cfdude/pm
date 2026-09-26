// scripts/test/functional/spec-sync-surfaces.test.mjs
// handoff-demand-blind-spots 5.1, 5.2 and 5.4 — the check `delivered-epic-spec-deltas-absent` on its
// surfaces, against REAL git (gate-integrity, "A delivered epic whose archived spec deltas are absent
// from the main specs is reported until they arrive"; design D6). Every case here needs a real index:
// the assertion half's double answers "no repository", where the check reports no presence or absence
// finding at all. The direct-call cases are the assertion twin's (assert/spec-sync-surfaces.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixtureGit, tmpRepo, run, invokeEngine, readState, writeState } from "../fixtures/functional-harness.mjs";
import { agentDisposition } from "../../lib/disposition.mjs";

const CHECK = "delivered-epic-spec-deltas-absent";
const HEADING = "SPEC DELTAS ABSENT FROM THE MAIN SPECS";
const req = (n) => `### Requirement: ${n}\nThe system SHALL ${n}.\n\n#### Scenario: ${n} works\n- **WHEN** x\n- **THEN** y\n`;
const mainSpec = (...names) => `# engine-invocation\n\n## Purpose\n\nx\n\n## Requirements\n\n${names.map(req).join("\n")}`;

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** A hermetic pm repository whose record holds ONE delivered openspec epic `lost` with an archived change
 *  `2026-09-20-lost` carrying `delta` for `engine-invocation`, and a committed main spec holding `names`. */
function fixture({ delta, names = ["Existing"], outcome = "delivered" } = {}) {
  const cwd = tmpRepo();
  fixtureGit(cwd, "init", "-q", "-b", "main");
  fixtureGit(cwd, "config", "user.email", "test@example.com");
  fixtureGit(cwd, "config", "user.name", "Test");
  run(["init"], { cwd });
  const st = readState(cwd);
  st.epics.push({ id: "lost", title: "lost", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
    disposition: agentDisposition({ outcome, reason: outcome === "delivered" ? undefined : "fixture" }) });
  writeState(cwd, st);
  write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec(...names));
  write(cwd, "openspec/changes/archive/2026-09-20-lost/specs/engine-invocation/spec.md", delta);
  write(cwd, "openspec/changes/archive/2026-09-20-lost/tasks.md", "- [x] 1 done\n");
  fixtureGit(cwd, "add", "-A");
  fixtureGit(cwd, "commit", "-q", "-m", "baseline with the archive move committed");
  return cwd;
}
const ADDED_TWO = `## ADDED Requirements\n\n${req("Store seam")}\n${req("CLI-store parity")}`;
const block = (out) => {
  const lines = out.split("\n");
  const start = lines.findIndex(l => l.startsWith(`${CHECK} — `));
  assert.notEqual(start, -1, `integrity printed no ${CHECK} block:\n${out}`);
  const found = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) found.push(lines[i]);
  return found.join("\n");
};
const integrity = (cwd) => {
  const r = invokeEngine(["integrity"], { cwd });
  assert.equal(r.status, 0, `integrity exits as for every other check: ${r.stderr}`);
  return block(r.stdout);
};

// ───────────── 5.1 — the integrity check ─────────────

test("5.1 integrity names the epic, the change directory, the capability and both lost ADDED headers", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const found = integrity(cwd);
  for (const s of ["`lost`", "2026-09-20-lost", "engine-invocation", "\"Store seam\"", "\"CLI-store parity\"", "ABSENT"]) {
    assert.ok(found.includes(s), `the finding names ${s}:\n${found}`);
  }
});

test("5.1 the staged-then-reset SEQUENCE: staged rewrite → nothing; `git reset --hard` → the lost header", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Existing", "Store seam", "CLI-store parity"));
  fixtureGit(cwd, "add", "openspec/specs/engine-invocation/spec.md");
  assert.equal(integrity(cwd), "", "the index holds the rewrite, so nothing is reported while it is staged");
  fixtureGit(cwd, "reset", "-q", "--hard");
  assert.match(integrity(cwd), /"Store seam"/, "the 0.48.0 shape: the staged rewrite discarded, the loss reported");
});

/** Follow the printed remedy: step 1 as a file edit (`edit`), step 2 AS PRINTED — the `git -C … add
 *  openspec/` line run through a shell. Asserts the printed delta path and git line first. */
function followRemedy(cwd, edit) {
  const found = integrity(cwd);
  const deltaPath = "openspec/changes/archive/2026-09-20-lost/specs/engine-invocation/spec.md";
  assert.ok(found.includes(`\`${deltaPath}\``), `the remedy names the archived delta's path:\n${found}`);
  const m = /`(git -C '[^']+' add openspec\/)`/.exec(found);
  assert.ok(m, `the remedy prints \`git -C <conductor root> add openspec/\`:\n${found}`);
  assert.ok(m[1].includes(fs.realpathSync(cwd)) || m[1].includes(cwd), "…naming this conductor root");
  edit();
  const r = spawnSync("sh", ["-c", m[1]], { cwd: "/", encoding: "utf8" });
  assert.equal(r.status, 0, `the printed git line runs as printed, from anywhere: ${r.stderr}`);
  assert.equal(integrity(cwd), "", "followed in order, the finding clears");
  assert.ok(readState(cwd).epics.find(e => e.id === "lost"), "and the epic still exists");
}

test("5.1 the REMEDY clears a lost ADDED header: copy the block into ## Requirements, then the printed git line", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  followRemedy(cwd, () => write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Existing", "Store seam", "CLI-store parity")));
});

test("5.1 the REMEDY clears a REMOVED header still present: delete its block, then the printed git line", () => {
  const cwd = fixture({ delta: `## REMOVED Requirements\n\n### Requirement: Existing\n`, names: ["Existing", "Kept"] });
  assert.match(integrity(cwd), /PRESENT[^\n]*"Existing"/);
  followRemedy(cwd, () => write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Kept")));
});

test("5.1 the REMEDY clears a RENAMED pair: rename the FROM header to its TO, then the printed git line", () => {
  const cwd = fixture({ delta: "## RENAMED Requirements\n\n- FROM: `### Requirement: Existing`\n- TO: `### Requirement: Renamed`\n", names: ["Existing"] });
  const found = integrity(cwd);
  assert.match(found, /PRESENT[^\n]*"Existing"/);
  assert.match(found, /ABSENT[^\n]*"Renamed"/);
  followRemedy(cwd, () => write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Renamed")));
});

test("5.1 an outcome other than delivered is out of scope", () => {
  const cwd = fixture({ delta: ADDED_TWO, outcome: "killed" });
  assert.equal(integrity(cwd), "");
});
