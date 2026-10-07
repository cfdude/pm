// scripts/test/unit/attribution-set-integrity.test.mjs
// The assertion twin of scripts/test/functional/attribution-set-integrity.test.mjs — same id, same
// subject (Theme B batch B1, 0.51.0: the attribution array is a set read against a Gate 2 head, and what
// is written into it is recorded once). This half carries the pieces that NEVER REACH GIT and need no
// file: update-epic's write-time refusals (gh#233, gh#232's trailing-slash half), the position-free
// wording of the stale-Gate-2 remedy (gh#216), and the legacy reading of a Gate 1 verdict (gh#198).
// The real-commit behaviour (duplicates, catch-up, the post-gate advisory) lives in the functional file;
// a directory on disk (gh#232) and a digest of a file (gh#198) live in
// scripts/test/assert/gate1-artifact-digests.test.mjs, because they need bytes.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, recordWithEpic, unitTest } from "../fixtures/unit-harness.mjs";
import { DELIVERED_OBLIGATIONS, gateStaleness } from "../../lib/archive-gate.mjs";
import { artifactStaleness } from "../../lib/gate-artifact-evidence.mjs";

const stateBytes = (engine) => engine.store.read("state.json").text;

// ═══════════════ gh#233 — contradictory deferral assertions ═══════════════

unitTest("233.1 --deferral together with --no-deferrals is refused by name, before any write", () => {
  const engine = memoryEngine(recordWithEpic());
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "x", "--deferral", "other-epic:none", "--no-deferrals"]));
  assert.ok(err, "the pair must be refused");
  assert.match(err.stderr, /--no-deferrals/);
  assert.match(err.stderr, /--deferral/);
  assert.match(err.stderr, /contradictory/);
  assert.equal(stateBytes(engine), before, "nothing was written");
  assert.equal(engine.store.record().epics[0].deferralAssertion, undefined);
});

unitTest("233.2 --declined-deferral together with --no-deferrals is refused too: a declined deferral is a deferral", () => {
  const engine = memoryEngine(recordWithEpic());
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "x", "--declined-deferral", "polish::not worth it", "--no-deferrals"]));
  assert.ok(err);
  assert.match(err.stderr, /--declined-deferral/);
  assert.equal(stateBytes(engine), before);
});

unitTest("233.3 each assertion alone is still accepted", () => {
  for (const flags of [["--no-deferrals"], ["--declined-deferral", "polish::not worth it"]]) {
    const engine = memoryEngine(recordWithEpic());
    engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed", "--reason", "x", ...flags]);
    assert.ok(engine.store.record().epics[0].deferralAssertion, `${flags[0]} alone records an assertion`);
  }
});

// ═══════════════ gh#232 — --plan / --spec must be able to be a file ═══════════════

unitTest("232.1 update-epic refuses a trailing-slash --plan and --spec, naming the value; nothing written", () => {
  for (const flag of ["--plan", "--spec"]) {
    const engine = memoryEngine(recordWithEpic());
    const before = stateBytes(engine);
    const err = expectFail(() => engine(["update-epic", "e1", flag, "docs/superpowers/plans/"]));
    assert.ok(err, `${flag} with a trailing slash must be refused`);
    assert.match(err.stderr, /docs\/superpowers\/plans\//);
    assert.match(err.stderr, /directory/);
    assert.equal(stateBytes(engine), before);
  }
});

unitTest("232.2 add-epic refuses the same value on both flags (the sibling write path)", () => {
  for (const flag of ["--plan", "--spec"]) {
    const engine = memoryEngine(emptyRecord());
    const before = stateBytes(engine);
    const err = expectFail(() => engine(["add-epic", "--id", "p1", "--lane", "superpowers", flag, "docs/plans/"]));
    assert.ok(err, `add-epic ${flag} with a trailing slash must be refused`);
    assert.equal(stateBytes(engine), before);
    assert.equal(engine.store.record().epics.length, 0, "no epic was registered");
  }
});

unitTest("232.3 a path that does not exist yet is still accepted: a plan may be attached before it is written", () => {
  const engine = memoryEngine(recordWithEpic());
  engine(["update-epic", "e1", "--plan", "docs/superpowers/plans/not-written-yet.md"]);
  assert.equal(engine.store.record().epics[0].planPath, "docs/superpowers/plans/not-written-yet.md");
});

// ═══════════════ gh#216 — the stale-Gate-2 remedy carries no positional claim ═══════════════

unitTest("216.4 the gate2-stale remedy names the tip as 'the commit every other one is an ancestor of', never 'the last'", () => {
  const stale = DELIVERED_OBLIGATIONS.find(o => o.variant === "gate2-stale");
  const lines = stale.remedy({ id: "e1" });
  const text = lines.join("\n");
  assert.match(text, /--head-sha <the attributed commit every other one is an ancestor of>/);
  assert.match(text, /--base-sha <parent of the earliest attributed commit>/);
  assert.doesNotMatch(text, /last attributed|first attributed/);
});

// ═══════════════ gh#198 — the legacy reading of a Gate 1 verdict ═══════════════

unitTest("198.1 a Gate 1 verdict recorded before digests existed reads UNVERIFIABLE, never stale", () => {
  const entry = { verdict: "pass", reviewedAt: "2026-01-01T00:00:00Z", artifacts: ["openspec/changes/x/proposal.md"] };
  assert.equal(artifactStaleness(entry).state, "unverifiable");
  assert.equal(gateStaleness({ id: "x", attributedCommits: [] }, entry).state, "none-attributed",
    "a legacy entry takes the commit logic exactly as before");
});
