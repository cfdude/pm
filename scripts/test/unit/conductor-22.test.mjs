// scripts/test/unit/conductor-22.test.mjs
// 4.1's migration of `assert/conductor-22.test.mjs` — 13 of its 18 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
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
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// THIRTEEN moved: both pure tests (`isArchiveBackfilled`'s reader, and the shared registry entry),
// and the whole #130 correction family — the library rule, the ordinary verb's refusal, the
// replacement and its one-level nest, the two refusals, the surfaces, the DATA sweep, the gh-110
// shape, and the archive demands a correction still obeys.
//
// FIVE STAY, and FOUR of them are one population: `withArchivedTasks()` writes
// `openspec/changes/archive/<date>-<id>/tasks.md`, which is what the backfill READS. The fifth is the
// 0.32.0 migration test, whose fixture is `fixturePluginRoot("0.32.0")` and whose verb is `upgrade` —
// a real plugin directory on disk, with `.gitignore` back-filled beside it — plus a byte comparison of
// state.json for idempotence.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the `brief` verb's stdout

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const DISPOSITION = new URL("../../lib/disposition.mjs", import.meta.url).href;

const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

/** A conductor holding one archived epic that already carries an AGENT-recorded disposition.
 *
 *  THE SHAPE CHANGED WITH THE RUNG, and this is the whole of it: the file rung's helper took a `cwd`,
 *  ran `init` and installed the record into it; here it builds the engine and RETURNS it, because there
 *  is nothing to install into — the record a memory store holds IS its seed. */
function withAgentDisposition(extra = {}) {
  return memoryEngine({
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

unitTest("#133: isArchiveBackfilled reads the EPIC's registration provenance, not the disposition", async () => {
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
unitTest("#130: correctionError enforces its own rules, not only the CLI's", async () => {
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
unitTest("#130: the ordinary archive verb still refuses to replace an agent's disposition, and names the way", () => {
  const engine = withAgentDisposition();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "mistyped", "--status", "archived",
    "--outcome", "superseded", "--reason", "actually superseded", "--no-deferrals"]));
  assert.ok(err, "the replacement rule must still refuse the ordinary path");
  assert.match(String(err.stderr), /already carries an agent-recorded outcome/);
  assert.match(String(err.stderr), /--correct-disposition/,
    "the refusal must name the correction route rather than being a dead end");
  assert.equal(stateBytes(engine), before, "state.json must be byte-identical after a refusal");
});
unitTest("#130: --correct-disposition corrects the record and keeps the prior one readable", () => {
  const engine = withAgentDisposition();
  engine(["update-epic", "mistyped", "--status", "archived", "--outcome", "superseded",
    "--reason", "folded into the 0.31.0 release", "--no-deferrals",
    "--correct-disposition", "recorded delivered by mistake — nothing shipped"]);
  const d = readState(engine).epics[0].disposition;
  assert.equal(d.outcome, "superseded");
  assert.equal(d.reason, "folded into the 0.31.0 release");
  assert.equal(d.correction, "recorded delivered by mistake — nothing shipped");
  assert.equal(d.recordedBy, undefined, "a correction is an AGENT record and stays agent-supplied");
  assert.equal(d.superseded.outcome, "delivered", "the prior judgment must survive verbatim");
  assert.equal(d.superseded.recordedAt, "2026-08-28T10:00:00.000Z");
});
unitTest("#130: a correction nests exactly one level, like record-gate-review's superseded entry", () => {
  const engine = withAgentDisposition();
  const correct = (outcome, why) => engine(["update-epic", "mistyped", "--status", "archived",
    "--outcome", outcome, "--reason", "r", "--no-deferrals", "--correct-disposition", why]);
  correct("superseded", "first correction");
  correct("killed", "second correction");
  const d = readState(engine).epics[0].disposition;
  assert.equal(d.outcome, "killed");
  assert.equal(d.superseded.outcome, "superseded");
  assert.equal(d.superseded.superseded, undefined,
    "an unbounded nest would make the record's depth a function of how many times it was re-recorded");
  assert.equal(d.superseded.correction, "first correction",
    "the kept record keeps its own correction reason, so the narrative survives one hop");
});
unitTest("#130: --correct-disposition is refused when there is no agent record to correct", () => {
    const engine = memoryEngine({
    version: 1, active: null, detourStack: [], epics: [
      { id: "engine-stamped", title: "t", priority: "P1", status: "archived", role: "epic",
        lane: "claude-code", links: [],
        disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" } },
      { id: "no-disposition", title: "t", priority: "P1", status: "queued", role: "epic",
        lane: "claude-code", links: [] },
    ],
  });
  for (const id of ["engine-stamped", "no-disposition"]) {
    const before = stateBytes(engine);
    const err = expectFail(() => engine(["update-epic", id, "--status", "archived", "--outcome", "killed",
      "--reason", "r", "--no-deferrals", "--correct-disposition", "why"]));
    assert.ok(err, `--correct-disposition must be refused on '${id}'`);
    assert.match(String(err.stderr), /no agent-recorded disposition to correct/);
    assert.equal(stateBytes(engine), before, "state.json must be byte-identical after a refusal");
  }
});
unitTest("#130: --correct-disposition outside the archive transition is refused, not silently dropped", () => {
  const engine = withAgentDisposition();
  const before = stateBytes(engine);
  // No --status archived: the whole disposition block is unreachable, so without an explicit
  // refusal this parses, writes nothing, exits 0 and prints "updated" — #79's exact shape.
  const err = expectFail(() => engine(["update-epic", "mistyped", "--correct-disposition", "why"]));
  assert.ok(err, "a flag that cannot reach its write must be refused, never dropped");
  assert.match(String(err.stderr), /only happens at the archive transition/,
    "the refusal must diagnose the unreachable write, not merely list the known flags");
  assert.equal(stateBytes(engine), before);
});
unitTest("#130: a valueless --correct-disposition is refused", () => {
  const engine = withAgentDisposition();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "mistyped", "--status", "archived",
    "--outcome", "killed", "--reason", "r", "--no-deferrals", "--correct-disposition"]));
  assert.ok(err, "the reason for the correction is the flag's value and is required");
  assert.match(String(err.stderr), /--correct-disposition requires/);
  assert.equal(stateBytes(engine), before);
});
unitTest("#130: a correction is distinguishable from an original on the surfaces people read", () => {
  const engine = withAgentDisposition();
  engine(["update-epic", "mistyped", "--status", "archived", "--outcome", "killed",
    "--reason", "the approach was wrong", "--no-deferrals",
    "--correct-disposition", "delivered was a typo"]);
  const md = projectMd(engine);
  assert.match(md, /corrected \(was delivered\)/,
    "if the only trace is nested JSON, supersede is overwrite for every human reader");
  assert.match(md, /delivered was a typo/, "PROJECT.md must carry why the record was corrected");
  const brief = parseBrief(engine);
  assert.match(brief, /corrected \(was delivered\)/);
});
unitTest("#130: a superseded record's carriedTo is swept like every other epic reference", () => {
    const engine = memoryEngine({
    version: 1, active: null, detourStack: [], epics: [
      { id: "receiver", title: "receiver", priority: "P1", status: "queued", role: "epic",
        lane: "claude-code", links: [] },
      { id: "handed-off", title: "handed-off", priority: "P1", status: "archived", role: "epic",
        lane: "claude-code", links: [],
        disposition: { outcome: "delivered", recordedAt: "2026-08-28T10:00:00.000Z" },
        deferralAssertion: { assertedAt: "2026-08-28T10:00:00.000Z", deferrals: [], declined: [] } },
    ],
  });
  engine(["update-epic", "handed-off", "--status", "archived", "--outcome", "delivered",
    "--carried-to", "receiver", "--no-deferrals",
    "--correct-disposition", "the handoff was never recorded"]);
  engine(["update-epic", "handed-off", "--status", "archived", "--outcome", "killed",
    "--reason", "dropped after all", "--no-deferrals",
    "--correct-disposition", "it was not delivered"]);
  assert.equal(readState(engine).epics.find(e => e.id === "handed-off").disposition.superseded.carriedTo,
    "receiver", "the superseded record holds a live epic id — a DATA reference like any other");
  engine(["remove-epic", "receiver"]);
  const d = readState(engine).epics.find(e => e.id === "handed-off").disposition;
  assert.equal(d.superseded.carriedTo, undefined,
    "a superseded record rendering a pointer to a deleted epic is exactly what the sweep exists to catch");
});
unitTest("#130: the gh-110 shape — a delivered outcome recorded with no reason is correctable", () => {
  // The live case: recorded earlier the same day, noticed immediately, and uncorrectable —
  // the replacement rule refused and the only remaining route was hand-editing state.json.
    const engine = memoryEngine({
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
  engine(["update-epic", "gh-110-gate2-bypassed-by-archive-hook", "--status", "archived",
    "--outcome", "delivered", "--reason", "<what this epic actually delivered>",
    "--correct-disposition", "<why the original record was wrong>"]);
  const d = readState(engine).epics[0].disposition;
  assert.equal(d.outcome, "delivered");
  assert.equal(d.reason, "<what this epic actually delivered>");
  assert.equal(d.superseded.outcome, "delivered");
  assert.equal(d.superseded.reason, undefined, "the prior record's missing reason is preserved as missing");
});
unitTest("#130: --correct-disposition is registered on the shared epic-flag registry", async () => {
  const { EPIC_FLAGS, epicFlagsFor } = await import(new URL("../../lib/constants.mjs", import.meta.url).href);
  const entry = EPIC_FLAGS.find(f => f.flag === "correct-disposition");
  assert.ok(entry, "a flag not in the registry is rejected by name at every allowlisted verb");
  assert.deepEqual(entry.commands, ["update-epic"]);
  assert.ok(epicFlagsFor("update-epic").includes("correct-disposition"));
  assert.equal(epicFlagsFor("add-epic").includes("correct-disposition"), false,
    "creation paths have no prior judgment to correct");
});
unitTest("#130: a correction still obeys every other archive demand", async () => {
  const engine = withAgentDisposition();
  // The required reason is not waived by a correction: an outcome that needs one still needs one.
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "mistyped", "--status", "archived",
    "--outcome", "killed", "--no-deferrals", "--correct-disposition", "why"]));
  assert.ok(err);
  assert.match(String(err.stderr), /requires a non-empty reason/);
  assert.equal(stateBytes(engine), before);
});
