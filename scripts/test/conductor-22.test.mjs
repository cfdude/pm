import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, fixturePluginRoot } from "./helpers.mjs";

const DISPOSITION = new URL("../lib/disposition.mjs", import.meta.url).href;

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

test("#133: isArchiveBackfilled reads the EPIC's registration provenance, not the disposition", async () => {
  const { isArchiveBackfilled, agentDisposition, engineStamp } = await import(DISPOSITION);
  const corrected = {
    id: "x", status: "archived", registeredBy: "archive-backfill",
    disposition: agentDisposition({ outcome: "abandoned", reason: "dropped" }),
  };
  assert.equal(isArchiveBackfilled(corrected), true,
    "an agent's disposition must not be able to un-backfill an epic");
  // The legacy shape — provenance only on the disposition — is LIFTED by the migration rather
  // than read here forever: two fields answering one question is the second definition the
  // source-scan test exists to prevent.
  assert.equal(isArchiveBackfilled({ id: "x", disposition: engineStamp("archive-backfill") }), false);
  assert.equal(isArchiveBackfilled({ id: "x", registeredBy: "add-epic" }), false);
  assert.equal(isArchiveBackfilled({}), false);
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

test("#130: correctionError enforces its own rules, not only the CLI's", async () => {
  // MUTATION-FOUND. Neutering correctionError()'s empty-reason branch left the whole suite
  // green, because the only route to it ran through update-epic's own valueless-flag refusal
  // first. The rule is documented as enforceable "from a CLI verb and from a gate alike", so
  // each layer is held to it independently — the CLI refusal above, and this one at the library.
  const { correctionError, agentDisposition, engineStamp } = await import(DISPOSITION);
  const prior = { outcome: "delivered", recordedAt: "2026-08-28T10:00:00.000Z" };
  for (const reason of [undefined, "", "   ", true]) {
    assert.match(String(correctionError({ prior, reason })), /--correct-disposition requires a reason/,
      `a correction with reason ${JSON.stringify(reason)} must be rejected`);
    assert.throws(() => agentDisposition({ outcome: "killed", reason: "r", corrects: { prior, reason } }),
      "no record may be built for a correction the rule forbids");
  }
  assert.match(String(correctionError({ prior: undefined, reason: "why" })),
    /no agent-recorded disposition to correct/);
  assert.match(String(correctionError({ prior: engineStamp("migration"), reason: "why" })),
    /no agent-recorded disposition to correct/);
  assert.equal(correctionError({ prior, reason: "why" }), null);
});

test("#130: the ordinary archive verb still refuses to replace an agent's disposition, and names the way", () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "mistyped", "--status", "archived",
    "--outcome", "superseded", "--reason", "actually superseded", "--no-deferrals"], { cwd }));
  assert.ok(err, "the replacement rule must still refuse the ordinary path");
  assert.match(String(err.stderr), /already carries an agent-recorded outcome/);
  assert.match(String(err.stderr), /--correct-disposition/,
    "the refusal must name the correction route rather than being a dead end");
  assert.equal(stateBytes(cwd), before, "state.json must be byte-identical after a refusal");
});

test("#130: --correct-disposition corrects the record and keeps the prior one readable", () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  run(["update-epic", "mistyped", "--status", "archived", "--outcome", "superseded",
    "--reason", "folded into the 0.31.0 release", "--no-deferrals",
    "--correct-disposition", "recorded delivered by mistake — nothing shipped"], { cwd });
  const d = readState(cwd).epics[0].disposition;
  assert.equal(d.outcome, "superseded");
  assert.equal(d.reason, "folded into the 0.31.0 release");
  assert.equal(d.correction, "recorded delivered by mistake — nothing shipped");
  assert.equal(d.recordedBy, undefined, "a correction is an AGENT record and stays agent-supplied");
  assert.equal(d.superseded.outcome, "delivered", "the prior judgment must survive verbatim");
  assert.equal(d.superseded.recordedAt, "2026-08-28T10:00:00.000Z");
});

test("#130: a correction nests exactly one level, like record-gate-review's superseded entry", () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  const correct = (outcome, why) => run(["update-epic", "mistyped", "--status", "archived",
    "--outcome", outcome, "--reason", "r", "--no-deferrals", "--correct-disposition", why], { cwd });
  correct("superseded", "first correction");
  correct("killed", "second correction");
  const d = readState(cwd).epics[0].disposition;
  assert.equal(d.outcome, "killed");
  assert.equal(d.superseded.outcome, "superseded");
  assert.equal(d.superseded.superseded, undefined,
    "an unbounded nest would make the record's depth a function of how many times it was re-recorded");
  assert.equal(d.superseded.correction, "first correction",
    "the kept record keeps its own correction reason, so the narrative survives one hop");
});

test("#130: --correct-disposition is refused when there is no agent record to correct", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [], epics: [
      { id: "engine-stamped", title: "t", priority: "P1", status: "archived", role: "epic",
        lane: "claude-code", links: [],
        disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" } },
      { id: "no-disposition", title: "t", priority: "P1", status: "queued", role: "epic",
        lane: "claude-code", links: [] },
    ],
  });
  for (const id of ["engine-stamped", "no-disposition"]) {
    const before = stateBytes(cwd);
    const err = expectFail(() => run(["update-epic", id, "--status", "archived", "--outcome", "killed",
      "--reason", "r", "--no-deferrals", "--correct-disposition", "why"], { cwd }));
    assert.ok(err, `--correct-disposition must be refused on '${id}'`);
    assert.match(String(err.stderr), /no agent-recorded disposition to correct/);
    assert.equal(stateBytes(cwd), before, "state.json must be byte-identical after a refusal");
  }
});

test("#130: --correct-disposition outside the archive transition is refused, not silently dropped", () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  const before = stateBytes(cwd);
  // No --status archived: the whole disposition block is unreachable, so without an explicit
  // refusal this parses, writes nothing, exits 0 and prints "updated" — #79's exact shape.
  const err = expectFail(() => run(["update-epic", "mistyped", "--correct-disposition", "why"], { cwd }));
  assert.ok(err, "a flag that cannot reach its write must be refused, never dropped");
  assert.match(String(err.stderr), /only happens at the archive transition/,
    "the refusal must diagnose the unreachable write, not merely list the known flags");
  assert.equal(stateBytes(cwd), before);
});

test("#130: a valueless --correct-disposition is refused", () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "mistyped", "--status", "archived",
    "--outcome", "killed", "--reason", "r", "--no-deferrals", "--correct-disposition"], { cwd }));
  assert.ok(err, "the reason for the correction is the flag's value and is required");
  assert.match(String(err.stderr), /--correct-disposition requires/);
  assert.equal(stateBytes(cwd), before);
});

test("#130: a correction is distinguishable from an original on the surfaces people read", () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  run(["update-epic", "mistyped", "--status", "archived", "--outcome", "killed",
    "--reason", "the approach was wrong", "--no-deferrals",
    "--correct-disposition", "delivered was a typo"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /corrected \(was delivered\)/,
    "if the only trace is nested JSON, supersede is overwrite for every human reader");
  assert.match(md, /delivered was a typo/, "PROJECT.md must carry why the record was corrected");
  const brief = parseBrief(cwd);
  assert.match(brief, /corrected \(was delivered\)/);
});

test("#130: a superseded record's carriedTo is swept like every other epic reference", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [], epics: [
      { id: "receiver", title: "receiver", priority: "P1", status: "queued", role: "epic",
        lane: "claude-code", links: [] },
      { id: "handed-off", title: "handed-off", priority: "P1", status: "archived", role: "epic",
        lane: "claude-code", links: [],
        disposition: { outcome: "delivered", recordedAt: "2026-08-28T10:00:00.000Z" },
        deferralAssertion: { assertedAt: "2026-08-28T10:00:00.000Z", deferrals: [], declined: [] } },
    ],
  });
  run(["update-epic", "handed-off", "--status", "archived", "--outcome", "delivered",
    "--carried-to", "receiver", "--no-deferrals",
    "--correct-disposition", "the handoff was never recorded"], { cwd });
  run(["update-epic", "handed-off", "--status", "archived", "--outcome", "killed",
    "--reason", "dropped after all", "--no-deferrals",
    "--correct-disposition", "it was not delivered"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "handed-off").disposition.superseded.carriedTo,
    "receiver", "the superseded record holds a live epic id — a DATA reference like any other");
  run(["remove-epic", "receiver"], { cwd });
  const d = readState(cwd).epics.find(e => e.id === "handed-off").disposition;
  assert.equal(d.superseded.carriedTo, undefined,
    "a superseded record rendering a pointer to a deleted epic is exactly what the sweep exists to catch");
});

test("#130: the gh-110 shape — a delivered outcome recorded with no reason is correctable", () => {
  // The live case: recorded earlier the same day, noticed immediately, and uncorrectable —
  // the replacement rule refused and the only remaining route was hand-editing state.json.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [], epics: [{
      id: "gh-110-gate2-bypassed-by-archive-hook",
      title: "Gate 2 enforced at the front door, bypassed by the archive hook",
      priority: "P0", status: "archived", role: "epic", lane: "claude-code", links: [],
      reconcileNeeded: false, externalId: "110",
      externalUrl: "https://github.com/cfdude/pm/issues/110", release: "0.27.0",
      disposition: { outcome: "delivered", recordedAt: "2026-08-26T21:22:25.567Z" },
      deferralAssertion: { assertedAt: "2026-08-26T21:22:25.567Z", deferrals: [], declined: [] },
      completedAt: "2026-08-26T21:22:25.567Z",
    }],
  });
  // No --deferral flags: the epic already carries an assertion, and the gate accepts either.
  // Lane claude-code, so the Gate 2 demand does not bind.
  run(["update-epic", "gh-110-gate2-bypassed-by-archive-hook", "--status", "archived",
    "--outcome", "delivered", "--reason", "<what this epic actually delivered>",
    "--correct-disposition", "<why the original record was wrong>"], { cwd });
  const d = readState(cwd).epics[0].disposition;
  assert.equal(d.outcome, "delivered");
  assert.equal(d.reason, "<what this epic actually delivered>");
  assert.equal(d.superseded.outcome, "delivered");
  assert.equal(d.superseded.reason, undefined, "the prior record's missing reason is preserved as missing");
});

test("#130: --correct-disposition is registered on the shared epic-flag registry", async () => {
  const { EPIC_FLAGS, epicFlagsFor } = await import(new URL("../lib/constants.mjs", import.meta.url).href);
  const entry = EPIC_FLAGS.find(f => f.flag === "correct-disposition");
  assert.ok(entry, "a flag not in the registry is rejected by name at every allowlisted verb");
  assert.deepEqual(entry.commands, ["update-epic"]);
  assert.ok(epicFlagsFor("update-epic").includes("correct-disposition"));
  assert.equal(epicFlagsFor("add-epic").includes("correct-disposition"), false,
    "creation paths have no prior judgment to correct");
});

test("#130: a correction still obeys every other archive demand", async () => {
  const cwd = tmpRepo();
  withAgentDisposition(cwd);
  // The required reason is not waived by a correction: an outcome that needs one still needs one.
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "mistyped", "--status", "archived",
    "--outcome", "killed", "--no-deferrals", "--correct-disposition", "why"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr), /requires a non-empty reason/);
  assert.equal(stateBytes(cwd), before);
});
