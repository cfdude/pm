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
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { removeAtExit } from "../fixtures/temp-dir.mjs";
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

// ───────────── 5.2 — the briefing block and `render`'s output ─────────────

const briefText = (cwd) => {
  const r = invokeEngine(["brief"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
};
const briefBlock = (text) => {
  const lines = text.split("\n");
  const at = lines.findIndex(l => l.startsWith(HEADING));
  if (at === -1) return [];
  const out = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith("  "); i++) out.push(lines[i]);
  return out;
};
const epicsIn = (lines) => [...new Set(lines.map(l => (/`([^`]+)`/.exec(l) || [])[1]).filter(Boolean))].sort();

test("5.2 brief names the SAME epic set as integrity, under its own heading", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const fromIntegrity = epicsIn(integrity(cwd).split("\n"));
  const fromBrief = epicsIn(briefBlock(briefText(cwd)));
  assert.deepEqual(fromIntegrity, ["lost"], "one real finding, so the set is NON-EMPTY");
  assert.deepEqual(fromBrief, fromIntegrity, "one function feeds both surfaces");
});

test("5.2 `render` PRINTS the block on its stdout, and the PROJECT.md it writes does NOT carry it", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const r = invokeEngine(["render"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(HEADING) && r.stdout.includes("`lost`"), `render's stdout carries the block:\n${r.stdout}`);
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.ok(!md.includes(HEADING), "a tracked file never carries a condition of the index");
});

test("5.2 `render --diff-summary` prints only its epic-relevant line; commit-nudge and snapshot stdout carry no block", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const d = invokeEngine(["render", "--diff-summary"], { cwd });
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /^epic-relevant: (yes|no)\n$/, `a machine-read line and nothing else:\n${d.stdout}`);
  for (const verb of [["commit-nudge"], ["snapshot"]]) {
    const r = invokeEngine(verb, { cwd, input: "{}" });
    assert.ok(!r.stdout.includes(HEADING), `${verb[0]}'s stdout carries no spec-sync block:\n${r.stdout}`);
  }
});

test("5.2 the archive-to-`git add` window: integrity names the epic and PROJECT.md does not; after `git add openspec/` nothing", () => {
  // SIMULATED as `openspec archive` would leave it (the CLI is not a test dependency): the change moved
  // under archive/ and the main spec rewritten, both present and UNSTAGED.
  const cwd = tmpRepo();
  fixtureGit(cwd, "init", "-q", "-b", "main");
  fixtureGit(cwd, "config", "user.email", "test@example.com");
  fixtureGit(cwd, "config", "user.name", "Test");
  run(["init"], { cwd });
  write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Existing"));
  write(cwd, "openspec/changes/win/specs/engine-invocation/spec.md", `## ADDED Requirements\n\n${req("Fresh")}`);
  write(cwd, "openspec/changes/win/tasks.md", "- [x] 1 done\n");
  fixtureGit(cwd, "add", "-A");
  fixtureGit(cwd, "commit", "-q", "-m", "in flight");
  const st = readState(cwd);
  st.epics.push({ id: "win", title: "win", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
    disposition: agentDisposition({ outcome: "delivered" }) });
  writeState(cwd, st);
  fs.mkdirSync(path.join(cwd, "openspec/changes/archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec/changes/win"), path.join(cwd, "openspec/changes/archive/2026-09-25-win"));
  write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Existing", "Fresh"));
  assert.match(integrity(cwd), /`win`[^\n]*"Fresh"/, "a CORRECT archive is reported until it is staged — the stated cost of the index");
  run(["render"], { cwd });
  assert.ok(!fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8").includes(HEADING), "PROJECT.md rendered in the window does not carry it");
  fixtureGit(cwd, "add", "openspec/");
  assert.equal(integrity(cwd), "", "the window closes at staging");
});

// ───────────── 5.4 — the archive transition is not refused ─────────────

test("5.4 a delivered archive whose delta header the index lacks SUCCEEDS, and the next integrity names it", () => {
  const cwd = tmpRepo();
  fixtureGit(cwd, "init", "-q", "-b", "main");
  fixtureGit(cwd, "config", "user.email", "test@example.com");
  fixtureGit(cwd, "config", "user.name", "Test");
  run(["init"], { cwd });
  run(["add-epic", "--id", "gate", "--lane", "openspec", "--status", "active"], { cwd });
  const st = readState(cwd);
  const e = st.epics.find(x => x.id === "gate");
  e.gateReview = { gate2: { verdict: "pass", reviewer: "r", reviewedAt: "2026-09-25T00:00:00.000Z" } };
  delete e.attributedCommits;
  writeState(cwd, st);
  write(cwd, "openspec/specs/engine-invocation/spec.md", mainSpec("Existing"));
  write(cwd, "openspec/changes/archive/2026-09-25-gate/specs/engine-invocation/spec.md", `## ADDED Requirements\n\n${req("Never synced")}`);
  write(cwd, "openspec/changes/archive/2026-09-25-gate/tasks.md", "- [x] 1 done\n");
  fixtureGit(cwd, "add", "-A");
  fixtureGit(cwd, "commit", "-q", "-m", "archive move, specs never synced");
  run(["sync"], { cwd });
  const r = invokeEngine(["update-epic", "gate", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(r.status, 0, `a standing condition, never a refusal at the transition: ${r.stderr}`);
  assert.equal(readState(cwd).epics.find(x => x.id === "gate").disposition.outcome, "delivered");
  assert.match(integrity(cwd), /`gate`[^\n]*"Never synced"/, "and the next integrity names it");
});

// ───────────── Gate 2 C1 / C2 / I3 — a check that cannot run degrades every surface ─────────────

/** A directory holding a `git` that FAILS `cat-file --batch` (exit 1, not 128) and hands every other
 *  invocation to the real git. Only the index read passes the invocation's env PATH to git, so this
 *  forces exactly that failure and nothing else. */
function failingCatFileShim() {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-shim-")));
  const shim = path.join(dir, "git");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = "cat-file" ] && [ "$2" = "--batch" ]; then echo "shim: forced failure" >&2; exit 1; fi\nexec "${real}" "$@"\n`);
  fs.chmodSync(shim, 0o755);
  return { PATH: `${dir}:${process.env.PATH}` };
}
const UNAVAILABLE = /^spec-sync check unavailable: .+/;

test("C1 brief: a failing index read → exit 0, ONE `spec-sync check unavailable` line, and the rest of the briefing", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const healthy = JSON.parse(invokeEngine(["brief"], { cwd }).stdout).hookSpecificOutput.additionalContext;
  const r = invokeEngine(["brief"], { cwd, env: failingCatFileShim() });
  assert.equal(r.status, 0, `the SessionStart briefing is never lost to one check: ${r.stderr}`);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const lines = ctx.split("\n");
  assert.equal(lines.filter(l => UNAVAILABLE.test(l)).length, 1, `exactly one line:\n${ctx}`);
  assert.ok(!ctx.includes(HEADING), "no block — the check could not run");
  const without = (t) => t.split("\n").filter(l => !UNAVAILABLE.test(l) && !l.startsWith(HEADING) && !l.startsWith("  • `lost`")).join("\n").replace(/\n{2,}/g, "\n");
  assert.equal(without(ctx), without(healthy), "everything else the briefing emits is still emitted");
});

test("C1 render verb: a failing index read → exit 0, PROJECT.md written, ONE unavailable line on stdout", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const r = invokeEngine(["render"], { cwd, env: failingCatFileShim() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split("\n").filter(l => UNAVAILABLE.test(l)).length, 1, r.stdout);
  assert.ok(fs.existsSync(path.join(cwd, "PROJECT.md")), "the render itself still happened");
});

test("C1 integrity: a failing index read → the check UNAVAILABLE with its reason, every other check reported, no stack, exit non-zero", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  const r = invokeEngine(["integrity"], { cwd, env: failingCatFileShim() });
  assert.notEqual(r.status, 0, "could-not-check never reads as clean");
  assert.match(r.stdout, new RegExp(`^${CHECK} — UNAVAILABLE \\(the check could not run: .+\\)`, "m"));
  assert.match(r.stdout, /^archived-with-zero-ticked-tasks — \d+ finding\(s\)/m, "the other checks still ran");
  assert.ok(!/\n\s+at .+:\d+:\d+/.test(r.stdout + r.stderr), `no raw stack:\n${r.stderr}`);
});

test("C2 a CORRUPT index is not 'no repository': integrity reports the check unavailable and exits non-zero", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  fs.writeFileSync(path.join(cwd, ".git", "index"), "garbage");
  const r = invokeEngine(["integrity"], { cwd });
  assert.notEqual(r.status, 0, "a corrupt index must not print 0 findings and exit 0");
  assert.match(r.stdout, new RegExp(`^${CHECK} — UNAVAILABLE`, "m"));
});

test("I3 snapshot never carries the block — neither its stdout nor the brief.txt it writes", () => {
  const cwd = fixture({ delta: ADDED_TWO });
  assert.match(integrity(cwd), /"Store seam"/, "there IS a finding, so the absence below is meaningful");
  const r = invokeEngine(["snapshot"], { cwd, input: "{}" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(HEADING));
  const brief = fs.readFileSync(path.join(cwd, ".conductor", "brief.txt"), "utf8");
  assert.ok(!brief.includes(HEADING), "brief.txt is tracked in most fleet repos; a condition of the index stays out of it");
});
