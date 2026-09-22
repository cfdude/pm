// gh-136 / gh-131 / gh-105 / gh-85 — four small, independent gaps, batched.
//
// The thread joining them is the one docs/lessons/a-guard-can-check-the-wrong-half.md names: a
// guard proves the half it ASSERTS, not the half it is named for. #136 is a flag that parsed,
// matched a registry and wrote nothing while a registration guard stayed green. #131 is a
// recovery path with no test that can fail when it is deleted. #85 is a mutation nobody
// DECLARED, so no guard could be pointed at it. Each test below asserts BEHAVIOUR — a value read
// back off disk, a heal that landed, a tree that did not move — and never a declaration.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE UNIT-RUNG HALF ───────────────
//
// TWO of the four gaps are observed through a VALUE and moved here: #136's registry round-trip
// (what the created epic holds) and #131's retry POLICY (a pure function of four injected
// callbacks). The rest stay on the file rung in `assert/conductor-25.test.mjs`, and each for a
// reason rather than by default:
//
//   * #131's END-TO-END proof needs the conflict-injection seam, which bumps a revision on the
//     DISK store's first mkdir — the disk store's guard is the subject, and a memory store has no
//     lock, no rename and no second writer to race;
//   * #131's source scan and #85's dispatch reader READ ENGINE SOURCE (they are the two
//     source-shape guards 4.1 names by hand);
//   * #105's three emitted-text tests cannot have their FIXTURE built in memory — `set-tracker`
//     writes the managed rules block into CLAUDE.md as a side effect, a repository file the store
//     does not own — and its fourth test reads `commands/feedback.md`;
//   * #85's three tests hash the working tree with mtimes — a filesystem property by construction.
//
// No assertion changed in either direction. The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;
const HOOK_WRITE = new URL("../../lib/hook-write.mjs", import.meta.url).href;

// ───────────────────────────── gh-136: registered ≠ honoured ─────────────────────────────
//
// `add-epic --notes` was accepted, exited 0 and stored nothing (#136, on 0.26.0). The fix
// shipped; what did NOT ship is a guard that would catch the next flag to do it. The two
// existing round-trip checks in conductor-13 catch OPPOSITE directions and neither covers
// add-epic:
//
//   * "every add-many key the registry declares round-trips" is REGISTRY-driven — it catches
//     `registered but not honoured`, which is exactly #136's shape.
//   * "every DOCUMENTED update-epic flag …" is DOCUMENTATION-driven — it catches `documented
//     but not registered`, and its own comment explains why registry-driving would be vacuous
//     for THAT direction (an unregistered flag is simply absent from the registry).
//
// `add-epic` had neither. This is the registry-driven half for it, and it does not supersede
// the documentation-driven one — they fail on different mistakes.

/** How to exercise each `add-epic` flag, and what reading it back looks like. The ENUMERATION
 *  is the registry projection, never this table: a row added to EPIC_FLAGS for `add-epic` with
 *  no entry here is a hard failure naming the flag, not a silent skip. */
const ADD_EPIC_EXERCISE = {
  // `--id` and `--lane` are on every invocation; they are still exercised explicitly so the
  // check's enumeration can stay the whole registry projection rather than a filtered one.
  "id": { args: [], check: (e) => assert.equal(e.id, "subject") },
  "lane": { args: ["--lane", "superpowers"], check: (e) => assert.equal(e.lane, "superpowers") },
  "title": { args: ["--title", "A registered title"], check: (e) => assert.equal(e.title, "A registered title") },
  "priority": { args: ["--priority", "P1"], check: (e) => assert.equal(e.priority, "P1") },
  "status": { args: ["--status", "later"], check: (e) => assert.equal(e.status, "later") },
  "parent": { args: ["--parent", "other"], check: (e) => assert.equal(e.parent, "other") },
  "external-id": { args: ["--external-id", "JOB-7"], check: (e) => assert.equal(e.externalId, "JOB-7") },
  "external-url": { args: ["--external-url", "https://example.test/7"], check: (e) => assert.equal(e.externalUrl, "https://example.test/7") },
  "external-updated-at": { args: ["--external-updated-at", "2026-08-23T09:30:00Z"], check: (e) => assert.equal(e.externalUpdatedAt, "2026-08-23T09:30:00Z") },
  "plan": { args: ["--plan", "docs/superpowers/plans/p.md"], check: (e) => assert.equal(e.planPath, "docs/superpowers/plans/p.md") },
  "spec": { args: ["--spec", "docs/superpowers/specs/d.md"], check: (e) => assert.equal(e.specPath, "docs/superpowers/specs/d.md") },
  "link": { args: ["--link", "blocks:other:because"], check: (e) => assert.deepEqual(e.links, [{ type: "blocks", epic: "other", reason: "because" }]) },
  "description": { args: ["--description", "durable rationale"], check: (e) => assert.equal(e.description, "durable rationale") },
  // THE regression this file is named for. A note reads back as an ENTRY — {at, actor, text} —
  // so asserting on the text alone would pass against an implementation that stored the raw
  // string and lost the append-only trail.
  "notes": {
    args: ["--notes", "the evidence block that was being dropped"],
    check: (e) => {
      assert.ok(Array.isArray(e.notes), "notes must be the append-only entry array, not a string");
      assert.equal(e.notes.at(-1).text, "the evidence block that was being dropped");
      assert.equal(typeof e.notes.at(-1).at, "string");
    },
  },
  "add-story": { args: ["--add-story", "a milestone"], check: (e) => assert.equal(e.stories.at(-1).title, "a milestone") },
};

unitTest("gh-136: every EPIC_FLAGS row registered on add-epic is HONOURED, not merely accepted", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const registered = EPIC_FLAGS.filter(f => f.commands.includes("add-epic")).map(f => f.flag);
  assert.ok(registered.length >= 12,
    `the registry projection yielded only ${registered.length} add-epic flags — the projection is broken, not the command`);

  for (const flag of registered) {
    const spec = ADD_EPIC_EXERCISE[flag];
    assert.ok(spec,
      `EPIC_FLAGS registers --${flag} on add-epic but this check has no exercise entry for it — ` +
      "a registered flag must be invoked and read back, never skipped for being unknown here " +
      "(#136: --notes parsed, matched the registry, exited 0 and wrote nothing)");

    const engine = memoryEngine(emptyRecord());
    engine(["add-epic", "--id", "other", "--lane", "claude-code"]);
    const err = expectFail(() =>
      engine(["add-epic", "--id", "subject", "--lane", "claude-code", ...spec.args]));
    assert.equal(err, null,
      `add-epic rejected --${flag}, which its own registry says it accepts: ${err && String(err.stderr || err.message)}`);
    const epic = engine.store.record().epics.find(e => e.id === "subject");
    assert.ok(epic, `add-epic --${flag} created no epic at all`);
    spec.check(epic);
  }
});

unitTest("gh-136: a valueless --notes is REFUSED, never accepted and dropped", () => {
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes"]));
  assert.ok(err, "a valueless --notes must refuse rather than exit 0 having written nothing");
  assert.match(String(err.stderr || err.message), /--notes requires a value/);
  assert.equal(engine.store.record().epics.length, 0, "a refused registration must create no epic");
});

// ───────────────────────── gh-131: the retry half of retry-once-then-skip ─────────────────────
//
// 0.26.0 specified hook writes as RETRY ONCE, THEN SKIP and shipped the retry at two sites.
// Measured on 0.32.0 before this file existed: delete the retry from BOTH sites and all 856
// tests still pass. The heal is idempotent and hook-driven, so a later hook covers for the
// missing retry and the suite never notices — the same property that makes the defect benign
// most of the time is the property that hides it.
//
// Three things are asserted here, because no ONE of them is sufficient:
//   1. the POLICY, as a unit — including that the retry RE-LOADS and RE-HEALS rather than
//      re-saving the stale in-hand object, which no black-box test can observe;   ← THIS FILE
//   2. the policy END TO END at the `render` site, through a real conflict injected between
//      loadState() and saveState() inside ONE invocation;                        ← the file rung
//   3. that BOTH hook-write sites reach the policy, by source scan — because a live helper
//      called by dead code passes every test of the helper.                       ← the file rung
//
// HONEST SCOPE. The commit-nudge site cannot be covered by (2) and that is not an oversight:
// commitNudge() calls render() unconditionally two lines later, and render()'s own heal is
// idempotent, so whether commit-nudge's retry ran is invisible from outside a single
// invocation — identical final state, identical revision, identical conflict log. That cover is
// the exact mechanism that hid this defect, so (3) is what binds that site.

unitTest("gh-131: the policy retries ONCE after a conflict, and the retry re-loads and re-heals", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  const calls = [];
  // Two distinct objects: `stale` is what the caller already holds, `fresh` is what a reload
  // returns. Asserting the SECOND save receives `fresh` is the whole point — re-saving `stale`
  // would clobber the newer revision the guard exists to protect.
  const stale = { tag: "stale" };
  const fresh = { tag: "fresh" };
  const res = saveHookHeal({
    state: stale,
    verb: "render",
    load: () => { calls.push("load"); return fresh; },
    heal: (s) => { calls.push(`heal:${s.tag}`); return true; },
    save: (s) => {
      calls.push(`save:${s.tag}`);
      return { ok: s.tag === "fresh" };
    },
  });
  assert.deepEqual(calls, ["save:stale", "load", "heal:fresh", "save:fresh"],
    "after a conflicting first save the policy must reload, re-run the heal, and save the RELOADED state");
  assert.equal(res.ok, true);
  assert.equal(res.retried, true);
});

unitTest("gh-131: the policy retries at most ONCE — a second conflict skips, it does not loop", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  let saves = 0;
  const res = saveHookHeal({
    state: {}, verb: "render",
    load: () => ({}), heal: () => true,
    save: () => { saves++; return { ok: false }; },
  });
  assert.equal(saves, 2, "retry ONCE, then skip — never a loop on a permanently contended file");
  assert.equal(res.ok, false);
  assert.equal(res.retried, true);
});

unitTest("gh-131: a first save that succeeds neither reloads nor saves twice", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  let loads = 0, saves = 0;
  const res = saveHookHeal({
    state: {}, verb: "render",
    load: () => { loads++; return {}; }, heal: () => true,
    save: () => { saves++; return { ok: true }; },
  });
  assert.equal(saves, 1);
  assert.equal(loads, 0, "the uncontended path must not re-read state.json");
  assert.equal(res.retried, false);
});

unitTest("gh-131: the reloaded state having nothing left to heal is a SKIP, not a blind re-save", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  const saved = [];
  const res = saveHookHeal({
    state: { tag: "stale" }, verb: "render",
    load: () => ({ tag: "fresh" }),
    // Someone else's write already applied the heal; re-saving would write a state built on a
    // superseded revision for no gain.
    heal: () => false,
    save: (s) => { saved.push(s.tag); return { ok: false }; },
  });
  assert.deepEqual(saved, ["stale"], "a fresh state with nothing to heal must not be written");
  assert.equal(res.ok, false);
});

// ─────────────────── gh-105: the undeclared `gh` + GitHub-account dependency ───────────────────
//
// ALL FOUR gh-105 TESTS STAY ON THE FILE RUNG, and the reason was FOUND BY ATTEMPTING THE MOVE
// rather than read off a rule. Three of them assert on the text `rules` EMITS, which is a value —
// but their fixture cannot be built in memory at all: `set-tracker` refreshes the managed rules
// block as a side effect (`tracker.mjs:194` → `rules.mjs`'s `writeRules()` → `writeFileSync` on
// `CLAUDE.md`), and CLAUDE.md is a repository file design D1 deliberately does not put in the
// store. The unit rung's run-time counter refused it on the first run, with the path and the
// operation named, which is the guard working as designed rather than an inconvenience.
//
// Seeding the record's tracker fields by hand instead would have moved the tests while removing
// what they actually check: that `set-tracker` RECORDS a tracker and `rules` then emits its
// preflight. The two verbs are the subject, so both stay where they can write. The fourth test
// reads `commands/feedback.md` — a repository file.
//
// `/pm:feedback` and the emitted inward tracker-sync step both shell out to `gh`, and neither the
// README, the install instructions nor the command doc said so. It works for the maintainer — gh
// installed, logged in, tracker repo their own — and none of those hold for a general user, who
// gets a bare shell error that explains nothing.
//
// The two halves are fixed DIFFERENTLY and deliberately:
//   * feedback is OUTWARD and has credential-free fallbacks — a prefilled `issues/new` URL needs
//     no token, no CLI and no account, and attributes the issue to whoever hit the bug;
//   * inward SYNC is a READ, and anonymous listing does not exist. The only honest fix there is
//     to declare the dependency and refuse the section rather than report a sync nobody ran.
// Fixing one and leaving the other is the absent-edit class, so both are asserted on the file rung.
