// scripts/test/autonomy-revocation.test.mjs
// `epic-autonomy` — the inverse `--preauthorize` never shipped, and the two rules that come with
// it: a grant names something, and re-arming autonomy says what it restores.
//
// WHERE THE SPEC PUTS THEM. Every test below is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/epic-autonomy/spec.md, named for it, so a
// reader can go from the requirement to the assertion without a search. The measured instance the
// capability exists for: on 0.45.0, `set-autonomy a1 --preauthorize "rm -rf build/:it is
// regenerated"` then `--level off` exits 0 with the grant intact and nothing able to take it back,
// so turning autonomy back on silently restores every prior grant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, runCombined, readState, tmpRepo, expectFail } from "../fixtures/assert-harness.mjs";
import fs from "node:fs";
import path from "node:path";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const autonomyOf = (cwd, id) => (readState(cwd).epics.find(e => e.id === id) || {}).autonomy;

function repoWithEpic(id = "a") {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd });
  return cwd;
}

// ───────── A pre-authorization is revocable, and revoking it is recorded ─────────

test("Scenario: A granted action is revoked and no longer authorises", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"], { cwd });
  run(["set-autonomy", "a", "--revoke", "rm -rf build/",
    "--revoke-reason", "build/ now holds a checked-in vendor tree"], { cwd });

  const a = autonomyOf(cwd, "a");
  assert.equal(a.preAuthorized.length, 1, "the grant is RECORDED as revoked, never spliced out");
  const g = a.preAuthorized[0];
  assert.equal(g.action, "rm -rf build/");
  assert.equal(g.reason, "it is regenerated", "the grant's own reason survives its revocation");
  assert.ok(g.revoked && typeof g.revoked === "object", "the entry carries a revocation stamp");
  assert.equal(g.revoked.reason, "build/ now holds a checked-in vendor tree");
  assert.ok(g.revoked.revokedAt, "the revocation records when it happened");
});

test("Scenario: A category grant is revoked by naming the category", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "category:filesystem:scratch only"], { cwd });
  run(["set-autonomy", "a", "--revoke", "category:filesystem",
    "--revoke-reason", "the scratch dir moved under the repo"], { cwd });

  const a = autonomyOf(cwd, "a");
  assert.equal(a.preAuthorized.length, 1);
  const g = a.preAuthorized[0];
  assert.equal(g.category, "filesystem");
  assert.equal(g.action, undefined, "a category grant still carries no action");
  assert.ok(g.revoked, "a category grant is revocable by the SAME operation, not a second one");
  assert.equal(g.revoked.reason, "the scratch dir moved under the repo");
});

test("Scenario: A revoke names the stored value, however the grant spelled it", () => {
  // The grant splits on its FIRST colon, so a stored action never contains one. `--revoke` runs
  // the identical split, which is what makes BOTH spellings name the same grant: the bare stored
  // action, and the whole original `--preauthorize` value pasted back. Design Decision 1 — "whatever
  // --preauthorize stored is exactly what --revoke names".
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"], { cwd });
  run(["set-autonomy", "a", "--revoke", "rm -rf build/:it is regenerated",
    "--revoke-reason", "no longer regenerated"], { cwd });
  assert.ok(autonomyOf(cwd, "a").preAuthorized[0].revoked, "the full grant string names the grant too");
});

test("Scenario: A revoke over a mixed match leaves the earlier revocation untouched", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed, safe"], { cwd });
  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "first reason"], { cwd });
  // Re-granting is the documented un-revoke, so a live entry and a revoked one for the SAME action
  // legitimately coexist and a revoke naming that action matches both.
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:re-reviewed"], { cwd });
  const before = autonomyOf(cwd, "a").preAuthorized[0].revoked;

  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "second reason"], { cwd });

  const a = autonomyOf(cwd, "a");
  assert.equal(a.preAuthorized.length, 2);
  assert.deepEqual(a.preAuthorized[0].revoked, before,
    "the earlier revocation's reason and date describe a DIFFERENT event and are never re-stamped");
  assert.equal(a.preAuthorized[1].revoked.reason, "second reason");
});

// ───────── The three refusals (1.3) ─────────

test("Scenario: Revoking a grant the epic does not hold is refused", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["set-autonomy", "a", "--revoke", "rename-field",
    "--revoke-reason", "typo"], { cwd }));
  assert.ok(err, "a revoke that matched nothing exits non-zero");
  assert.match(String(err.stderr || err.message), /rename-field/, "the refusal names the value it could not match");
  assert.deepEqual(stateBytes(cwd), before, "the state of record is byte-identical");
});

test("Scenario: Revoking an already-revoked grant is refused", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"], { cwd });
  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "first"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["set-autonomy", "a", "--revoke", "drop-scratch-table",
    "--revoke-reason", "second"], { cwd }));
  assert.ok(err, "every match already revoked exits non-zero");
  assert.deepEqual(stateBytes(cwd), before,
    "a second revocation would overwrite the first one's reason and date with one describing nothing");
});

test("Scenario: Revoking without a reason is refused", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"], { cwd });
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["set-autonomy", "a", "--revoke", "drop-scratch-table"], { cwd })),
    "no --revoke-reason at all exits non-zero");
  assert.ok(expectFail(() => run(["set-autonomy", "a", "--revoke", "drop-scratch-table",
    "--revoke-reason", "   "], { cwd })), "an empty reason exits non-zero");
  assert.deepEqual(stateBytes(cwd), before, "the state of record is byte-identical after both");
});

test("A --revoke-reason with no --revoke is refused rather than dropped", () => {
  // every-verb-refuses-what-it-does-not-read: a reason for a revocation nobody asked for is a value
  // this verb would parse and discard while reporting success.
  const cwd = repoWithEpic();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["set-autonomy", "a", "--revoke-reason", "orphaned"], { cwd }));
  assert.ok(err, "a reason with nothing to attach to exits non-zero");
  assert.deepEqual(stateBytes(cwd), before, "nothing was written");
});

// ───────── Turning off does not revoke; turning on says what it restores (1.5) ─────────

test("Scenario: Turning autonomy off leaves the grants intact", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated",
    "--preauthorize", "category:filesystem:scratch only"], { cwd });
  run(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  run(["set-autonomy", "a", "--level", "off"], { cwd });
  const a = autonomyOf(cwd, "a");
  assert.equal(a.level, "off");
  assert.equal(a.preAuthorized.length, 2, "deletion is not the inverse of granting");
  assert.ok(a.preAuthorized.every(g => !g.revoked), "and turning off is not revoking either");
});

test("Scenario: Turning autonomy on enumerates the grants it arms", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a",
    "--preauthorize", "rm -rf build/:it is regenerated",
    "--preauthorize", "category:filesystem:scratch only",
    "--preauthorize", "drop-scratch-table:reviewed"], { cwd });
  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "no longer safe"], { cwd });

  const out = runCombined(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(out, /2/, "the count of live grants is reported");
  assert.match(out, /rm -rf build\//, "each live grant's action is named");
  assert.match(out, /category:filesystem/, "a category grant is named by its category");
  assert.ok(!/drop-scratch-table/.test(out), "a revoked grant is not presented as restored");
});

test("Scenario: Arming an already-autonomous epic reports the same set", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"], { cwd });
  run(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  // The SECOND call changes nothing, so it takes reportSave()'s `unchanged` branch.
  const out = runCombined(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(out, /rm -rf build\//,
    "the report states what is LIVE and is not conditional on the write having changed anything");
});

test("Scenario: Arming an epic with no grants says so", () => {
  const cwd = repoWithEpic();
  const out = runCombined(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(out, /no pre-authoriz/i,
    "silence here is indistinguishable from a report that was not produced");
});

test("Scenario: A revoked grant is not restored by re-arming autonomy", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"], { cwd });
  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "no longer safe"], { cwd });
  run(["set-autonomy", "a", "--level", "off"], { cwd });
  const out = runCombined(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.ok(autonomyOf(cwd, "a").preAuthorized[0].revoked, "still revoked");
  // The precondition for the negative below: a report that was never produced satisfies
  // "does not name it" for free (docs/lessons/git-rewinds-restore-tracked-conductor-state's
  // vacuous half). Assert the report EXISTS before asserting what it omits.
  assert.match(out, /arming no pre-authoriz/i, "the re-arm report was produced and names none");
  assert.ok(!/drop-scratch-table/.test(out), "and not restored by re-arming");
});

// ───────── A pre-authorization names something (1.7) ─────────

test("Scenario: A grant with an empty action is refused", () => {
  const cwd = repoWithEpic();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["set-autonomy", "a", "--preauthorize", ":no action"], { cwd }));
  assert.ok(err, "an empty action half exits non-zero");
  assert.deepEqual(stateBytes(cwd), before, "the epic gains no autonomy block it did not already have");
  assert.equal(autonomyOf(cwd, "a"), undefined);
});

test("Scenario: A grant with an action and no reason is still accepted", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table"], { cwd });
  const g = autonomyOf(cwd, "a").preAuthorized[0];
  assert.equal(g.action, "drop-scratch-table");
  assert.equal(g.reason, undefined,
    "this requirement constrains the half that decides what is authorised, not the half that explains it");
});

test("Scenario: A grant already on disk that names nothing authorises nothing", () => {
  // The refusal above binds writes that have not happened. A grant a previous release stored cannot
  // be revoked either — a revoke names a stored value and an empty one is not expressible as a flag
  // value — so the re-arm report is one of the three surfaces that must pass over it.
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed"], { cwd });
  const s = readState(cwd);
  s.epics.find(e => e.id === "a").autonomy.preAuthorized.push({ action: "", grantedAt: "2026-01-01T00:00:00.000Z", reason: "no action" });
  fs.writeFileSync(stateFile(cwd), JSON.stringify(s, null, 2) + "\n");

  const out = runCombined(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(out, /drop-scratch-table/, "the live grant is named");
  assert.match(out, /\b1\b/, "and counted as one, not two");
});

// ───────── 1.9 REGRESSION GUARD — what this change KEEPS ─────────

test("REGRESSION GUARD: a state file written before this change reads back with every grant live", () => {
  // The revocation stamp is read-time-defaulted — `isRevoked()` asks whether the field is there —
  // so a 0.45.0 record needs no migration. Exercised rather than assumed: the grants below carry no
  // `revoked` key at all, which is the shape every state file on disk today has.
  const cwd = repoWithEpic();
  const s = readState(cwd);
  s.epics.find(e => e.id === "a").autonomy = {
    level: "off", context: [], notifications: [],
    preAuthorized: [
      { action: "drop-scratch-table", grantedAt: "2026-01-01T00:00:00.000Z", reason: "reviewed" },
      { category: "filesystem", grantedAt: "2026-01-02T00:00:00.000Z", reason: "scratch only" },
    ],
  };
  fs.writeFileSync(stateFile(cwd), JSON.stringify(s, null, 2) + "\n");

  const out = runCombined(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(out, /arming 2 pre-authorizations/, "both legacy grants read as live");
  assert.match(out, /drop-scratch-table/);
  assert.match(out, /category:filesystem/);
  // And each is still revocable, which is what "live" has to mean.
  run(["set-autonomy", "a", "--revoke", "category:filesystem", "--revoke-reason", "no longer"], { cwd });
  assert.ok(autonomyOf(cwd, "a").preAuthorized[1].revoked);
});

test("REGRESSION GUARD: the pre-existing empty-CATEGORY refusal still fires and still names the vocabulary", () => {
  // Behaviour this change KEEPS, not behaviour it adds: `KNOWN_PREAUTHORIZE_CATEGORIES` already
  // refused an empty category on 0.45.0, which is why the empty-category case was deliberately not
  // in 1.7's RED list — a test that goes green before the fix is written proves nothing.
  const cwd = repoWithEpic();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["set-autonomy", "a", "--preauthorize", "category::no name"], { cwd }));
  assert.ok(err, "an empty category half exits non-zero");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /filesystem\|network\|schema\|external-api/, "and still names the known vocabulary");
  assert.deepEqual(stateBytes(cwd), before, "the state of record is byte-identical");
  // An unknown non-empty category is refused by the same arm, unchanged.
  assert.ok(expectFail(() => run(["set-autonomy", "a", "--preauthorize", "category:bogus:why"], { cwd })));
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

const REPO_ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const shippedText = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
/** The four surfaces that carry the item: the RENDERED block, plus the three shipped mirrors. */
const MIRRORS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];

test("1.10: the emitted inverse item states the grants instance as PAST measured evidence", () => {
  const cwd = repoWithEpic();
  const surfaces = [["rules block", run(["rules"], { cwd })], ...MIRRORS.map(m => [m, shippedText(m)])];
  for (const [name, text] of surfaces) {
    const flat = text.replace(/\s+/g, " ");
    assert.ok(!/grants accumulate with no revoke/.test(flat),
      `${name} still states the falsified claim in the present tense — pm ships --revoke now`);
    assert.ok(!/turning it back on silently restores all of them/.test(flat),
      `${name} still claims the restore is silent — --level autonomous reports what it arms`);
    assert.match(flat, /accumulated with no revoke/,
      `${name} must KEEP the instance as past measured evidence — deleting it removes what makes ` +
      "the required item stick, and a practice recorded without its evidence reads as a preference");
    assert.match(flat, /safety surface/, `${name} must keep the finding's classification`);
    assert.match(flat, /--revoke/, `${name} must name the inverse that closed it`);
  }
});

test("1.10: the emitted decision rule says a revoked grant and a grant naming nothing cover nothing", () => {
  const cwd = repoWithEpic();
  // THE RULES BLOCK ONLY, and that scope is derived rather than assumed: `rg "Already
  // pre-authorized"` finds the decision rule on exactly one emitted surface plus this repo's own
  // managed CLAUDE.md, which the block generates. SKILL.md carries the PREFLIGHT scan and defers
  // the rule to the block ("this section defines the scan; the decision rule …"). The other actor
  // that applies a grant — agents/hierarchy-child-executor.md's step (a), the only reader of
  // `preAuthorized` outside the engine — carries its own wording and is task 5.4, after Gate 2.
  const surfaces = [["rules block", run(["rules"], { cwd })]];
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
