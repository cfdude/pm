// gh-136 / gh-131 / gh-105 / gh-85 — four small, independent gaps, batched.
//
// The thread joining them is the one docs/lessons/a-guard-can-check-the-wrong-half.md names: a
// guard proves the half it ASSERTS, not the half it is named for. #136 is a flag that parsed,
// matched a registry and wrote nothing while a registration guard stayed green. #131 is a
// recovery path with no test that can fail when it is deleted. #85 is a mutation nobody
// DECLARED, so no guard could be pointed at it. Each test below asserts BEHAVIOUR — a value read
// back off disk, a heal that landed, a tree that did not move — and never a declaration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, readState, expectFail } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;

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

test("gh-136: every EPIC_FLAGS row registered on add-epic is HONOURED, not merely accepted", async () => {
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

    const cwd = tmpRepo();
    run(["init"], { cwd });
    run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
    const err = expectFail(() =>
      run(["add-epic", "--id", "subject", "--lane", "claude-code", ...spec.args], { cwd }));
    assert.equal(err, null,
      `add-epic rejected --${flag}, which its own registry says it accepts: ${err && String(err.stderr || err.message)}`);
    const epic = readState(cwd).epics.find(e => e.id === "subject");
    assert.ok(epic, `add-epic --${flag} created no epic at all`);
    spec.check(epic);
  }
});

test("gh-136: a valueless --notes is REFUSED, never accepted and dropped", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes"], { cwd }));
  assert.ok(err, "a valueless --notes must refuse rather than exit 0 having written nothing");
  assert.match(String(err.stderr || err.message), /--notes requires a value/);
  assert.equal(readState(cwd).epics.length, 0, "a refused registration must create no epic");
});
