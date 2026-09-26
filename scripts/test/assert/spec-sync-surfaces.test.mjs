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
  const got = await withAssertInvocation(cwd, () => specSyncFindings([delivered("lost", { status: "active" })], { readIndex: read }));
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
