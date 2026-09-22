// scripts/test/unit/autonomy-revocation.test.mjs
// 4.1's migration of `assert/autonomy-revocation.test.mjs` — 19 of its 20 tests, moved from the file
// rung to the unit rung with every assertion unchanged.
//
// `epic-autonomy` — the inverse `--preauthorize` never shipped, and the two rules that come with it:
// a grant names something, and re-arming autonomy says what it restores.
//
// WHERE THE SPEC PUTS THEM. Every test below is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/epic-autonomy/spec.md, named for it, so a
// reader can go from the requirement to the assertion without a search. The measured instance the
// capability exists for: on 0.45.0, `set-autonomy a1 --preauthorize "rm -rf build/:it is
// regenerated"` then `--level off` exits 0 with the grant intact and nothing able to take it back,
// so turning autonomy back on silently restores every prior grant.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// NINETEEN of the twenty: every observable is a VALUE — a grant's shape on the record, a refusal's
// text, or what `set-autonomy` PRINTED. ONE STAYS: `1.10`'s first test, which reads the three
// SHIPPED mirrors (`skills/conductor/SKILL.md`, `commands/epic.md`, `commands/status.md`) with
// `readFileSync` alongside the rendered block. Its sibling — the decision-rule test — asserts on the
// RENDERED block alone and moved with the rest.
//
// The one shape worth naming: two tests MANUFACTURE a record by reading it, editing it and writing it
// back. On the file rung that write is `fs.writeFileSync(stateFile(cwd), …)`; here the store hands
// back the record it holds, so the edit alone IS the write and the `writeFileSync` line is GONE rather
// than translated — `writeRecord()` would refuse a revision no verb produced, which is the guard, not
// the fixture.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(stateFile(cwd))`       →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;
const autonomyOf = (engine, id) => (readState(engine).epics.find(e => e.id === id) || {}).autonomy;

function repoWithEpic(id = "a") {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", id, "--lane", "claude-code"]);
  return engine;
}

unitTest("Scenario: A granted action is revoked and no longer authorises", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"]);
  engine(["set-autonomy", "a", "--revoke", "rm -rf build/",
    "--revoke-reason", "build/ now holds a checked-in vendor tree"]);

  const a = autonomyOf(engine, "a");
  assert.equal(a.preAuthorized.length, 1, "the grant is RECORDED as revoked, never spliced out");
  const g = a.preAuthorized[0];
  assert.equal(g.action, "rm -rf build/");
  assert.equal(g.reason, "it is regenerated", "the grant's own reason survives its revocation");
  assert.ok(g.revoked && typeof g.revoked === "object", "the entry carries a revocation stamp");
  assert.equal(g.revoked.reason, "build/ now holds a checked-in vendor tree");
  assert.ok(g.revoked.revokedAt, "the revocation records when it happened");
});
unitTest("Scenario: A category grant is revoked by naming the category", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "category:filesystem:scratch only"]);
  engine(["set-autonomy", "a", "--revoke", "category:filesystem",
    "--revoke-reason", "the scratch dir moved under the repo"]);

  const a = autonomyOf(engine, "a");
  assert.equal(a.preAuthorized.length, 1);
  const g = a.preAuthorized[0];
  assert.equal(g.category, "filesystem");
  assert.equal(g.action, undefined, "a category grant still carries no action");
  assert.ok(g.revoked, "a category grant is revocable by the SAME operation, not a second one");
  assert.equal(g.revoked.reason, "the scratch dir moved under the repo");
});
unitTest("Scenario: A revoke names the stored value, however the grant spelled it", () => {
  // The grant splits on its FIRST colon, so a stored action never contains one. `--revoke` runs
  // the identical split, which is what makes BOTH spellings name the same grant: the bare stored
  // action, and the whole original `--preauthorize` value pasted back. Design Decision 1 — "whatever
  // --preauthorize stored is exactly what --revoke names".
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"]);
  engine(["set-autonomy", "a", "--revoke", "rm -rf build/:it is regenerated",
    "--revoke-reason", "no longer regenerated"]);
  assert.ok(autonomyOf(engine, "a").preAuthorized[0].revoked, "the full grant string names the grant too");
});
unitTest("Scenario: A revoke over a mixed match leaves the earlier revocation untouched", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed, safe"]);
  engine(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "first reason"]);
  // Re-granting is the documented un-revoke, so a live entry and a revoked one for the SAME action
  // legitimately coexist and a revoke naming that action matches both.
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:re-reviewed"]);
  const before = autonomyOf(engine, "a").preAuthorized[0].revoked;

  engine(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "second reason"]);

  const a = autonomyOf(engine, "a");
  assert.equal(a.preAuthorized.length, 2);
  assert.deepEqual(a.preAuthorized[0].revoked, before,
    "the earlier revocation's reason and date describe a DIFFERENT event and are never re-stamped");
  assert.equal(a.preAuthorized[1].revoked.reason, "second reason");
});

// ───────── The three refusals (1.3) ─────────
unitTest("Scenario: Revoking a grant the epic does not hold is refused", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"]);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["set-autonomy", "a", "--revoke", "rename-field",
    "--revoke-reason", "typo"]));
  assert.ok(err, "a revoke that matched nothing exits non-zero");
  assert.match(String(err.stderr || err.message), /rename-field/, "the refusal names the value it could not match");
  assert.deepEqual(stateBytes(engine), before, "the state of record is byte-identical");
});
unitTest("Scenario: Revoking an already-revoked grant is refused", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"]);
  engine(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "first"]);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["set-autonomy", "a", "--revoke", "drop-scratch-table",
    "--revoke-reason", "second"]));
  assert.ok(err, "every match already revoked exits non-zero");
  assert.deepEqual(stateBytes(engine), before,
    "a second revocation would overwrite the first one's reason and date with one describing nothing");
});
unitTest("Scenario: Revoking without a reason is refused", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"]);
  const before = stateBytes(engine);
  assert.ok(expectFail(() => engine(["set-autonomy", "a", "--revoke", "drop-scratch-table"])),
    "no --revoke-reason at all exits non-zero");
  assert.ok(expectFail(() => engine(["set-autonomy", "a", "--revoke", "drop-scratch-table",
    "--revoke-reason", "   "])), "an empty reason exits non-zero");
  assert.deepEqual(stateBytes(engine), before, "the state of record is byte-identical after both");
});
unitTest("A --revoke-reason with no --revoke is refused rather than dropped", () => {
  // every-verb-refuses-what-it-does-not-read: a reason for a revocation nobody asked for is a value
  // this verb would parse and discard while reporting success.
  const engine = repoWithEpic();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["set-autonomy", "a", "--revoke-reason", "orphaned"]));
  assert.ok(err, "a reason with nothing to attach to exits non-zero");
  assert.deepEqual(stateBytes(engine), before, "nothing was written");
});

// ───────── Turning off does not revoke; turning on says what it restores (1.5) ─────────
unitTest("Scenario: Turning autonomy off leaves the grants intact", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated",
    "--preauthorize", "category:filesystem:scratch only"]);
  engine(["set-autonomy", "a", "--level", "autonomous"]);
  engine(["set-autonomy", "a", "--level", "off"]);
  const a = autonomyOf(engine, "a");
  assert.equal(a.level, "off");
  assert.equal(a.preAuthorized.length, 2, "deletion is not the inverse of granting");
  assert.ok(a.preAuthorized.every(g => !g.revoked), "and turning off is not revoking either");
});
unitTest("Scenario: Turning autonomy on enumerates the grants it arms", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a",
    "--preauthorize", "rm -rf build/:it is regenerated",
    "--preauthorize", "category:filesystem:scratch only",
    "--preauthorize", "drop-scratch-table:reviewed"]);
  engine(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "no longer safe"]);

  const out = engine.combined(["set-autonomy", "a", "--level", "autonomous"]);
  assert.match(out, /2/, "the count of live grants is reported");
  assert.match(out, /rm -rf build\//, "each live grant's action is named");
  assert.match(out, /category:filesystem/, "a category grant is named by its category");
  assert.ok(!/drop-scratch-table/.test(out), "a revoked grant is not presented as restored");
});
unitTest("Scenario: Arming an already-autonomous epic reports the same set", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"]);
  engine(["set-autonomy", "a", "--level", "autonomous"]);
  // The SECOND call changes nothing, so it takes reportSave()'s `unchanged` branch.
  const out = engine.combined(["set-autonomy", "a", "--level", "autonomous"]);
  assert.match(out, /rm -rf build\//,
    "the report states what is LIVE and is not conditional on the write having changed anything");
});
unitTest("Scenario: Arming an epic with no grants says so", () => {
  const engine = repoWithEpic();
  const out = engine.combined(["set-autonomy", "a", "--level", "autonomous"]);
  assert.match(out, /no pre-authoriz/i,
    "silence here is indistinguishable from a report that was not produced");
});
unitTest("Scenario: A revoked grant is not restored by re-arming autonomy", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"]);
  engine(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "no longer safe"]);
  engine(["set-autonomy", "a", "--level", "off"]);
  const out = engine.combined(["set-autonomy", "a", "--level", "autonomous"]);
  assert.ok(autonomyOf(engine, "a").preAuthorized[0].revoked, "still revoked");
  // The precondition for the negative below: a report that was never produced satisfies
  // "does not name it" for free (docs/lessons/git-rewinds-restore-tracked-conductor-state's
  // vacuous half). Assert the report EXISTS before asserting what it omits.
  assert.match(out, /arming no pre-authoriz/i, "the re-arm report was produced and names none");
  assert.ok(!/drop-scratch-table/.test(out), "and not restored by re-arming");
});

// ───────── A pre-authorization names something (1.7) ─────────
unitTest("Scenario: A grant with an empty action is refused", () => {
  const engine = repoWithEpic();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["set-autonomy", "a", "--preauthorize", ":no action"]));
  assert.ok(err, "an empty action half exits non-zero");
  assert.deepEqual(stateBytes(engine), before, "the epic gains no autonomy block it did not already have");
  assert.equal(autonomyOf(engine, "a"), undefined);
});
unitTest("Scenario: A grant with an action and no reason is still accepted", () => {
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table"]);
  const g = autonomyOf(engine, "a").preAuthorized[0];
  assert.equal(g.action, "drop-scratch-table");
  assert.equal(g.reason, undefined,
    "this requirement constrains the half that decides what is authorised, not the half that explains it");
});
unitTest("Scenario: A grant already on disk that names nothing authorises nothing", () => {
  // The refusal above binds writes that have not happened. A grant a previous release stored cannot
  // be revoked either — a revoke names a stored value and an empty one is not expressible as a flag
  // value — so the re-arm report is one of the three surfaces that must pass over it.
  const engine = repoWithEpic();
  engine(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"]);
  const s = readState(engine);
  s.epics.find(e => e.id === "a").autonomy.preAuthorized.push({ action: "", grantedAt: "2026-01-01T00:00:00.000Z", reason: "no action" });

  const out = engine.combined(["set-autonomy", "a", "--level", "autonomous"]);
  assert.match(out, /drop-scratch-table/, "the live grant is named");
  assert.match(out, /\b1\b/, "and counted as one, not two");
});

// ───────── 1.9 REGRESSION GUARD — what this change KEEPS ─────────
unitTest("REGRESSION GUARD: a state file written before this change reads back with every grant live", () => {
  // The revocation stamp is read-time-defaulted — `isRevoked()` asks whether the field is there —
  // so a 0.45.0 record needs no migration. Exercised rather than assumed: the grants below carry no
  // `revoked` key at all, which is the shape every state file on disk today has.
  const engine = repoWithEpic();
  const s = readState(engine);
  s.epics.find(e => e.id === "a").autonomy = {
    level: "off", context: [], notifications: [],
    preAuthorized: [
      { action: "drop-scratch-table", grantedAt: "2026-01-01T00:00:00.000Z", reason: "reviewed" },
      { category: "filesystem", grantedAt: "2026-01-02T00:00:00.000Z", reason: "scratch only" },
    ],
  };

  const out = engine.combined(["set-autonomy", "a", "--level", "autonomous"]);
  assert.match(out, /arming 2 pre-authorizations/, "both legacy grants read as live");
  assert.match(out, /drop-scratch-table/);
  assert.match(out, /category:filesystem/);
  // And each is still revocable, which is what "live" has to mean.
  engine(["set-autonomy", "a", "--revoke", "category:filesystem", "--revoke-reason", "no longer"]);
  assert.ok(autonomyOf(engine, "a").preAuthorized[1].revoked);
});
unitTest("REGRESSION GUARD: the pre-existing empty-CATEGORY refusal still fires and still names the vocabulary", () => {
  // Behaviour this change KEEPS, not behaviour it adds: `KNOWN_PREAUTHORIZE_CATEGORIES` already
  // refused an empty category on 0.45.0, which is why the empty-category case was deliberately not
  // in 1.7's RED list — a test that goes green before the fix is written proves nothing.
  const engine = repoWithEpic();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["set-autonomy", "a", "--preauthorize", "category::no name"]));
  assert.ok(err, "an empty category half exits non-zero");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /filesystem\|network\|schema\|external-api/, "and still names the known vocabulary");
  assert.deepEqual(stateBytes(engine), before, "the state of record is byte-identical");
  // An unknown non-empty category is refused by the same arm, unchanged.
  assert.ok(expectFail(() => engine(["set-autonomy", "a", "--preauthorize", "category:bogus:why"])));
});

// ───────── 1.10 The emitted instruction text: the third surface, and the falsified claim ─────────
//
// `epic-autonomy` names exactly three surfaces that discharge "a grant already on disk that names
// nothing authorises nothing": the re-arm report (above), the integrity check
// (stored-value-integrity.test.mjs), and THE EXECUTION-TIME DECISION RULE THIS PROJECT EMITS — the
// one an agent, not the engine, applies. No engine code path evaluates a grant against a candidate
// action, so there is no fourth reader to bind.
//
// The rules block also carried the very claim this change falsifies, as a live present-tense
// statement of how pm behaves. REWORD, NEVER DELETE: the measured evidence is what makes the
// required task item stick, and `gate-integrity`'s sweep requirement cites the same instance as a
// PAST measurement, which stays true. What stops being true is the present tense.

unitTest("1.10: the emitted decision rule says a revoked grant and a grant naming nothing cover nothing", () => {
  const engine = repoWithEpic();
  // THE RULES BLOCK ONLY, and that scope is derived rather than assumed: `rg "Already
  // pre-authorized"` finds the decision rule on exactly one emitted surface plus this repo's own
  // managed CLAUDE.md, which the block generates. SKILL.md carries the PREFLIGHT scan and defers
  // the rule to the block ("this section defines the scan; the decision rule …"). The other actor
  // that applies a grant — agents/hierarchy-child-executor.md's step (a), the only reader of
  // `preAuthorized` outside the engine — carries its own wording and is task 5.4, after Gate 2.
  const surfaces = [["rules block", engine(["rules"])]];
  for (const [name, text] of surfaces) {
    const flat = text.replace(/\s+/g, " ");
    const at = flat.indexOf("a. Already pre-authorized");
    assert.notEqual(at, -1, `${name} carries the execution-time decision rule (a)`);
    const ruleA = flat.slice(at, flat.indexOf("b. No backup", at));
    assert.match(ruleA, /revoked/i,
      `${name}'s rule (a) must say a REVOKED grant does not cover an action — the engine honours the ` +
      "revocation and the agent reader must too, or the revoke is honoured by every reader but one");
    assert.match(ruleA, /names nothing|naming nothing/i,
      `${name}'s rule (a) must say a grant naming nothing covers nothing — this is the THIRD surface ` +
      "epic-autonomy names for an on-disk empty grant, and no revoke can reach one");
  }
});
