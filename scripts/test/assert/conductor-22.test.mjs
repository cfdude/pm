import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, fixturePluginRoot } from "../fixtures/assert-harness.mjs";

// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// THIRTEEN of its eighteen tests moved to `scripts/test/unit/conductor-22.test.mjs` — both pure tests
// and the whole #130 correction family.
//
// FIVE STAY, and FOUR of them are ONE population: `withArchivedTasks()` writes
// `openspec/changes/archive/<date>-<id>/tasks.md`, and that file is what the archive BACKFILL reads, so
// the fixture has to put it on disk. The fifth is the 0.32.0 migration test, whose fixture is
// `fixturePluginRoot("0.32.0")` — a real plugin directory — and whose verb is `upgrade`, which
// back-fills `.gitignore`; its idempotence assertion compares state.json's BYTES.
//
// No assertion changed in either direction.

const DISPOSITION = new URL("../../lib/disposition.mjs", import.meta.url).href;

const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

/** An archived change on disk, with `total` tasks of which `done` are ticked. */
function withArchivedTasks(cwd, id, done, total) {
  const dir = path.join(cwd, "openspec", "changes", "archive", `2026-06-25-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const lines = Array.from({ length: total }, (_, i) => `- [${i < done ? "x" : " "}] ${i + 1}.1 task ${i + 1}`);
  fs.writeFileSync(path.join(dir, "tasks.md"), `# Tasks\n\n${lines.join("\n")}\n`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// #133 — recording an honest disposition on a backfilled epic reverted its archived counts.
//
// MECHANISM: `isArchiveBackfilled()` asked the DISPOSITION record who registered the epic
// (`recordedBy: "archive-backfill"`). The disposition is a record of how the epic ENDED, and
// the interactive verb replaces it WHOLESALE with an agent record carrying no `recordedBy` by
// design — so the epic's REGISTRATION provenance lived inside the one field whose entire
// contract is that an agent overwrites it. Two lifecycles, one field.
//
// FIX: `registeredBy` on the EPIC, written once at creation by the backfill and never touched
// by any disposition write. Orthogonal, which is why `recordedBy` was put on two host objects
// in the first place.
// ══════════════════════════════════════════════════════════════════════════════════════════

test("#133: a backfilled epic keeps its archived task counts after an honest disposition is recorded", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withArchivedTasks(cwd, "log-collector-not-applicable", 2, 3);
  run(["sync"], { cwd });
  run(["render"], { cwd });                       // sync writes state; render writes PROJECT.md
  assert.match(projectMd(cwd), /2\/3/,
    "the backfill must register the archived counts in the first place");

  run(["update-epic", "log-collector-not-applicable", "--status", "archived",
    "--outcome", "abandoned", "--reason", "the collector was never applicable", "--no-deferrals"], { cwd });

  assert.match(projectMd(cwd), /2\/3/,
    "recording the truth destroyed the evidence: the counts reverted the moment the agent's " +
    "disposition replaced the backfill stamp");
});
test("#133: the archive backfill stamps registeredBy on the epic itself", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withArchivedTasks(cwd, "historic-change", 1, 4);
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "historic-change");
  assert.equal(e.registeredBy, "archive-backfill");
  assert.equal(Object.prototype.hasOwnProperty.call(e, "attributedCommits"), false,
    "the backfill's exemption from pushEpic's attributedCommits seeding must survive the move");
});
test("#133: no flag on any epic-writing command sets registeredBy", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withArchivedTasks(cwd, "historic", 1, 2);
  run(["sync"], { cwd });
  for (const argv of [["add-epic", "--id", "z", "--lane", "claude-code", "--registered-by", "archive-backfill"],
                      ["update-epic", "historic", "--registered-by", "archive-backfill"]]) {
    const e = expectFail(() => run(argv, { cwd }));
    assert.ok(e, `${argv[0]} must reject --registered-by — registration provenance is engine-only`);
  }
  run(["add-epic", "--id", "ordinary", "--lane", "claude-code"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "ordinary").registeredBy, undefined,
    "an ordinary creation path stamps no registration provenance — only the backfill does");
});
test("#133 × #130: correcting a backfilled epic's disposition still keeps its counts", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withArchivedTasks(cwd, "twice-recorded", 3, 5);
  run(["sync"], { cwd });
  run(["update-epic", "twice-recorded", "--status", "archived", "--outcome", "abandoned",
    "--reason", "first answer", "--no-deferrals"], { cwd });
  run(["update-epic", "twice-recorded", "--status", "archived", "--outcome", "superseded",
    "--reason", "second answer", "--no-deferrals",
    "--correct-disposition", "abandoned was wrong — it was folded into another change"], { cwd });
  assert.match(projectMd(cwd), /3\/5/,
    "neither write may touch the epic's registration provenance");
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// #130 — an agent-supplied disposition was unreplaceable, so a mistyped outcome had no
// correction verb and forced a hand-edit of state.json.
//
// The replacement rule stays: the ORDINARY verb still refuses. What a correction costs is an
// explicit, value-bearing flag whose value is why the recorded record was wrong, and the prior
// record survives verbatim under `superseded` — one level, exactly as record-gate-review caps
// its own nest.
// ══════════════════════════════════════════════════════════════════════════════════════════

/** A repo holding one archived epic that already carries an AGENT-recorded disposition. */
function withAgentDisposition(cwd, extra = {}) {
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [], epics: [{
      id: "mistyped", title: "Mistyped outcome", priority: "P0", status: "archived",
      role: "epic", lane: "claude-code", links: [], reconcileNeeded: false,
      disposition: { outcome: "delivered", recordedAt: "2026-08-28T10:00:00.000Z" },
      deferralAssertion: { assertedAt: "2026-08-28T10:00:00.000Z", deferrals: [], declined: [] },
      completedAt: "2026-08-28T10:00:00.000Z",
      ...extra,
    }],
  });
}
test("#133: the 0.32.0 migration lifts archive-backfill provenance off the disposition", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.32.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  writeState(cwd, {
    version: 1, active: null, detourStack: [], pmVersion: "0.31.0",
    epics: [
      { id: "legacy-backfill", title: "legacy-backfill", priority: "P?", status: "archived",
        role: "epic", lane: "openspec", links: [],
        disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "archive-backfill" } },
      { id: "migrated", title: "migrated", priority: "P1", status: "archived", role: "epic",
        lane: "openspec", links: [],
        disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" } },
      { id: "agent-recorded", title: "agent-recorded", priority: "P1", status: "archived",
        role: "epic", lane: "claude-code", links: [],
        disposition: { outcome: "killed", reason: "wrong approach", recordedAt: "2026-08-01T00:00:00.000Z" } },
    ],
  });
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  const by = (id) => after.epics.find(e => e.id === id);
  assert.equal(by("legacy-backfill").registeredBy, "archive-backfill");
  assert.equal(by("migrated").registeredBy, undefined,
    "only the backfill's own stamp carries registration provenance — no other engine path does");
  assert.equal(by("agent-recorded").registeredBy, undefined);
  // Idempotent: a second upgrade changes nothing.
  const first = stateBytes(cwd);
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(stateBytes(cwd), first);
});
