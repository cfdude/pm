// scripts/test/assert/spec-sync-surfaces.test.mjs
// The ASSERTION TWIN of scripts/test/functional/spec-sync-surfaces.test.mjs — same id, same subject:
// the `delivered-epic-spec-deltas-absent` check (handoff-demand-blind-spots 5.1, design D5/D6).
//
// THE FILE RUNG: every fixture writes an archived change directory for the engine to read.
// specSyncFindings() is called DIRECTLY with a stub index reader returning a NON-EMPTY map — without
// the injection the half's double answers "no repository", the check reports nothing, and a test
// comparing two surfaces would compare two empty sets.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, withAssertInvocation } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";
// The harness's own entry point, NOT the half's bound `invokeEngine` (which always substitutes the
// no-repository double): these cases hand in a double whose index read fails another way.
import { invokeEngine as invokeWithGit } from "../fixtures/harness.mjs";
import { specSyncFindings, specSyncDetail } from "../../lib/spec-sync.mjs";
import { CHECKS } from "../../lib/integrity.mjs";
import { DELIVERED_OBLIGATIONS } from "../../lib/archive-gate.mjs";
import { buildBrief } from "../../lib/briefing.mjs";

const CHECK = "delivered-epic-spec-deltas-absent";
const req = (n) => `### Requirement: ${n}\nThe system SHALL ${n}.\n`;
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const delivered = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
  disposition: { outcome: "delivered", recordedAt: "2026-09-25T00:00:00.000Z" }, ...extra });
const main = (...names) => `# m\n\n## Requirements\n\n${names.map(req).join("\n")}`;

/** A stub index reader: answers `specs` (capability → text | null) and records every call. */
function stubReader(specs) {
  const calls = [];
  const read = (paths) => {
    calls.push(paths);
    return new Map(paths.map(p => [p, specs[/openspec\/specs\/([^/]+)\/spec\.md$/.exec(p)[1]] ?? null]));
  };
  return { read, calls };
}

function archiveFixture() {
  const cwd = tmpRepo();
  write(cwd, "openspec/changes/archive/2026-09-20-lost/specs/engine-invocation/spec.md",
    `## ADDED Requirements\n\n${req("Store seam")}${req("Parity")}\n## REMOVED Requirements\n\n${req("Old")}`);
  write(cwd, "openspec/changes/archive/2026-09-20-lost/specs/other/spec.md", `## RENAMED Requirements\n\n- FROM: \`### Requirement: Half\`\n`);
  write(cwd, "openspec/changes/archive/2026-09-21-killed/specs/engine-invocation/spec.md", `## ADDED Requirements\n\n${req("Never")}`);
  return cwd;
}

test("5.1 twin: each finding names the epic, the change directory, the capability, the headers and the direction", async () => {
  const cwd = archiveFixture();
  const { read, calls } = stubReader({ "engine-invocation": main("Old", "Other"), other: main("X") });
  const epics = [delivered("lost"), delivered("killed", { disposition: { outcome: "killed", reason: "r", recordedAt: "2026-09-25T00:00:00.000Z" } })];
  const got = await withAssertInvocation(cwd, () => specSyncFindings(epics, { readIndex: read }));
  assert.deepEqual(got, [
    { epic: "lost", dir: "2026-09-20-lost", capability: "engine-invocation", direction: "absent", headers: ["Store seam", "Parity"] },
    { epic: "lost", dir: "2026-09-20-lost", capability: "engine-invocation", direction: "present", headers: ["Old"] },
    { epic: "lost", dir: "2026-09-20-lost", capability: "other", direction: "unpaired", headers: ["FROM: Half"] },
  ], "a killed epic is out of scope; the delivered one is reported in every direction");
  assert.equal(calls.length, 1, "ONE index read for every capability, not one per capability");
  assert.deepEqual(calls[0], ["openspec/specs/engine-invocation/spec.md", "openspec/specs/other/spec.md"]);
});

test("5.1 twin: a reader returning null (git cannot answer) → no presence or absence finding; unpaired still reported", async () => {
  const cwd = archiveFixture();
  const got = await withAssertInvocation(cwd, () => specSyncFindings([delivered("lost")], { readIndex: () => null }));
  assert.deepEqual(got.map(f => f.direction), ["unpaired"]);
});

test("5.1 twin: nothing in scope → the index is never read", async () => {
  const cwd = archiveFixture();
  const got = await withAssertInvocation(cwd, () =>
    specSyncFindings([delivered("lost", { lane: "claude-code" }), delivered("unarchived")], { readIndex: () => { throw new Error("read"); } }));
  assert.deepEqual(got, []);
});

test("5.1 twin: the stored status does not decide scope — the one resolver's directory does", async () => {
  const cwd = archiveFixture();
  const { read } = stubReader({ "engine-invocation": main("Old"), other: main() });
  const got = await withAssertInvocation(cwd, () => specSyncFindings([delivered("lost", { status: "active", createdAt: "2026-09-01T00:00:00.000Z" })], { readIndex: read }));
  assert.ok(got.some(f => f.direction === "absent"), "archived on disk is archived here, whatever state.json says");
});

test("5.1 twin: the remedy names the delta, the ## Requirements edit and `git -C <root> add openspec/`, shell-quoted", () => {
  const detail = specSyncDetail({ epic: "lost", dir: "2026-09-20-lost", capability: "engine-invocation", direction: "absent", headers: ["Store seam"] }, "/repo/sub dir");
  assert.ok(detail.includes("`openspec/changes/archive/2026-09-20-lost/specs/engine-invocation/spec.md`"));
  assert.ok(detail.includes("## Requirements"));
  assert.ok(detail.includes("`git -C '/repo/sub dir' add openspec/`"), detail);
  assert.ok(detail.indexOf("(1)") < detail.indexOf("(2)"), "the edit comes before the staging");
  const unpaired = specSyncDetail({ epic: "lost", dir: "d", capability: "c", direction: "unpaired", headers: ["FROM: X"] }, "/r");
  assert.ok(unpaired.indexOf("(0)") !== -1 && unpaired.indexOf("(0)") < unpaired.indexOf("(1)"), "an unpaired line adds step 0");
});

test("5.1 twin: the check is registered in integrity, and is NOT a delivered obligation (a standing condition)", () => {
  assert.ok(CHECKS.some(c => c.id === CHECK), `integrity carries ${CHECK}`);
  assert.ok(!DELIVERED_OBLIGATIONS.some(o => /spec/i.test(o.variant)), "no archive path refuses on it (design D3)");
});

test("5.1 twin: under the half's double (no repository) integrity reports no presence/absence finding for it", () => {
  const cwd = archiveFixture();
  run(["init"], { cwd });
  const st = readState(cwd);
  st.epics.push(delivered("lost"));
  writeState(cwd, st);
  const out = run(["integrity"], { cwd });
  const line = out.split("\n").find(l => l.startsWith(`${CHECK} — `));
  assert.ok(line, "the check is listed, at zero or more");
  const bullets = out.split("\n").filter(l => l.includes("`lost`") && !l.includes("unpaired RENAMED"));
  assert.deepEqual(bullets.filter(l => /ABSENT|PRESENT/.test(l)), [], "no presence or absence finding where git cannot answer");
});

// ───────────── 5.2 twin — the briefing block, fed by the same function ─────────────

const SS_HEADING = "SPEC DELTAS ABSENT FROM THE MAIN SPECS";

test("5.2 twin: buildBrief carries the block only when asked, and names the SAME epic set as specSyncFindings", async () => {
  const cwd = archiveFixture();
  run(["init"], { cwd });
  const st = readState(cwd);
  st.epics.push(delivered("lost"));
  writeState(cwd, st);
  const { read } = stubReader({ "engine-invocation": main("Old"), other: main() });
  const state = readState(cwd);
  const [findings, withBlock, embedded] = await withAssertInvocation(cwd, () => [
    specSyncFindings(state.epics, { readIndex: read }),
    buildBrief(state, { specSync: { readIndex: read } }),
    buildBrief(state),
  ]);
  assert.ok(findings.length > 0, "a NON-EMPTY set, so the comparison is not two empty sets");
  const lines = withBlock.split("\n");
  const at = lines.findIndex(l => l.startsWith(SS_HEADING));
  assert.notEqual(at, -1, `the block has its own heading:\n${withBlock}`);
  const block = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith("  "); i++) block.push(lines[i]);
  const named = [...new Set(block.map(l => (/`([^`]+)`/.exec(l) || [])[1]).filter(Boolean))].sort();
  assert.deepEqual(named, [...new Set(findings.map(f => f.epic))].sort(), "the briefing reads specSyncFindings(), nothing else");
  assert.ok(block.some(l => l.includes("integrity")) || withBlock.includes("`integrity`"), "it points at integrity for the remedy");
  assert.ok(!embedded.includes(SS_HEADING), "render()'s embedding (no option) never carries it");
});

// ───────────── Gate 2 C1 / I3 twin — a check that cannot run degrades every surface ─────────────

/** The half's double ("no repository here") with the index read failing for another reason. */
const failingIndex = () => ({ ...fakeGit({ noRepository: true }),
  indexBlobs: () => { const e = new Error("Command failed: cat-file --batch"); e.status = 1; throw e; } });
function inScopeRepo() {
  const cwd = archiveFixture();
  run(["init"], { cwd });
  const st = readState(cwd);
  st.epics.push(delivered("lost"));
  writeState(cwd, st);
  return cwd;
}
const UNAVAILABLE = /^spec-sync check unavailable: exit 1 — Command failed: cat-file --batch$/;

test("C1 twin: brief degrades to ONE line and exits 0", () => {
  const cwd = inScopeRepo();
  const r = invokeWithGit(["brief"], { cwd, git: failingIndex() });
  assert.equal(r.status, 0, r.stderr);
  const lines = JSON.parse(r.stdout).hookSpecificOutput.additionalContext.split("\n");
  assert.equal(lines.filter(l => UNAVAILABLE.test(l)).length, 1, lines.join("\n"));
});

test("C1 twin: the render verb degrades to ONE line on stdout and still renders", () => {
  const cwd = inScopeRepo();
  const r = invokeWithGit(["render"], { cwd, git: failingIndex() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split("\n").filter(l => UNAVAILABLE.test(l)).length, 1, r.stdout);
  assert.ok(fs.existsSync(path.join(cwd, "PROJECT.md")));
});

test("C1 twin: integrity names the check UNAVAILABLE with its reason, runs the rest, no stack, exits non-zero", () => {
  const cwd = inScopeRepo();
  const r = invokeWithGit(["integrity"], { cwd, git: failingIndex() });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, new RegExp(`^${CHECK} — UNAVAILABLE \\(the check could not run: exit 1 — Command failed: cat-file --batch\\)`, "m"));
  assert.match(r.stdout, /^advisory-claim-shape — \d+ finding\(s\)/m, "every other check still reports");
  assert.ok(!/\n\s+at .+:\d+:\d+/.test(r.stdout + r.stderr), "no raw stack");
});

test("I3 twin: snapshot's brief.txt never carries the block, even when the reader has a finding", async () => {
  const cwd = inScopeRepo();
  const { read } = stubReader({ "engine-invocation": main("Old"), other: main() });
  const state = readState(cwd);
  const withReader = await withAssertInvocation(cwd, () => buildBrief(state, { specSync: { readIndex: read } }));
  assert.ok(withReader.includes(SS_HEADING), "a finding exists");
  run(["snapshot"], { cwd, input: "{}" });
  assert.ok(!fs.readFileSync(path.join(cwd, ".conductor", "brief.txt"), "utf8").includes(SS_HEADING));
  const src = fs.readFileSync(new URL("../../lib/subcommands.mjs", import.meta.url), "utf8");
  const snap = src.slice(src.indexOf("export function snapshot()"), src.indexOf("export function snapshot()") + 2500);
  assert.ok(!/specSync/.test(snap.replace(/\/\/.*$/gm, "")), "snapshot() passes no specSync option");
});

test("5.2 twin: more than five findings end in an overflow line pointing at `integrity`, never PROJECT.md", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const st = readState(cwd);
  for (let i = 1; i <= 6; i++) {
    write(cwd, `openspec/changes/archive/2026-09-0${i}-e${i}/specs/cap/spec.md`, `## ADDED Requirements\n\n${req(`Lost ${i}`)}`);
    st.epics.push(delivered(`e${i}`));
  }
  writeState(cwd, st);
  const { read } = stubReader({ cap: main("Other") });
  const state = readState(cwd);
  const text = await withAssertInvocation(cwd, () => buildBrief(state, { specSync: { readIndex: read } }));
  const lines = text.split("\n");
  const from = lines.findIndex(l => l.startsWith(SS_HEADING));
  assert.notEqual(from, -1, "the block is there");
  const over = lines.slice(from).find(l => /^\s+\(\+\d+ more/.test(l));
  assert.ok(over, `an overflow line after the cap:\n${text}`);
  assert.match(over, /\(\+1 more — see `integrity`\)/);
  assert.ok(!over.includes("PROJECT.md"));
});
