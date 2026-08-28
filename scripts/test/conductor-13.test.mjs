import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, writeBatch, gitInitWithCommit, commitFiles } from "./helpers.mjs";

// ─────────────── the shared epic-flag registry (EPIC_FLAGS) ───────────────
//
// UPDATE_EPIC_FLAGS was a literal 11-element array in update-epic.mjs and add-epic had no
// allowlist at all, so four capabilities in this release would each have grown the flag
// surface in its own place — and whichever landed first would have rejected the others'
// flags BY NAME, because an unlisted flag exits 1. The registry is that chokepoint, grown
// once.

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;

/** The `UPDATE_EPIC_FLAGS` literal exactly as 0.26.0 shipped it, transcribed on purpose.
 *  This is the one place a transcribed list is the right instrument: it pins "seeding the
 *  registry changed no behavior", which is a claim about the PRIOR release and can only be
 *  made against a snapshot of it. Every other check in this file reads its enumeration from
 *  the live documented surface instead — see the coverage test at the bottom of the file. */
const UPDATE_EPIC_FLAGS_0_26_0 = [
  "external-id", "external-url", "parent", "status", "priority", "title",
  "link", "review-mode", "add-story", "story", "done",
];

// The registry EXISTS to be grown — four capabilities in this release add flags to these
// commands, which is the whole reason it was seeded early. So the three snapshot checks below
// assert CONTAINMENT, not equality: every flag 0.26.0 accepted is still accepted (seeding lost
// nothing), and a flag added on top is this release doing its job. Written as set-equality they
// would fail on the first capability that used the chokepoint, which is not a defect the check
// exists to catch — it is the check contradicting the design. What set-equality genuinely pinned
// (the SEEDING commit changed no behavior) is pinned by the seeding commit's own history; from
// here on the live guarantee is that no 0.26.0 flag was silently dropped.
const missingFrom = (projected, snapshot) => snapshot.filter(f => !projected.includes(f));

test("the registry's update-epic projection still accepts every 0.26.0 UPDATE_EPIC_FLAGS entry", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("update-epic")).map(f => f.flag);
  assert.deepEqual(
    missingFrom(projected, UPDATE_EPIC_FLAGS_0_26_0), [],
    "a flag update-epic accepted in 0.26.0 has been dropped from the registry");
});

test("the registry's add-epic projection still accepts every flag add-epic parsed in 0.26.0", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // add-epic had no allowlist, so its 0.26.0 surface is the set of flags its body actually
  // read out of parseFlags(): id, lane, status, title, priority, plan, parent, external-id,
  // external-url, link. Everything else parsed, exited 0 and wrote nothing (issue #79).
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("add-epic")).map(f => f.flag);
  assert.deepEqual(
    missingFrom(projected,
      ["external-id", "external-url", "id", "lane", "link", "parent", "plan", "priority", "status", "title"]),
    [],
    "a flag add-epic parsed in 0.26.0 has been dropped from the registry");
});

test("the registry's add-many keys still include every state key add-many copied in 0.26.0", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // add-many.mjs:61-70's fixed key copy, verbatim. A batch document is written in STATE keys
  // (externalId), not flag names (external-id), which is why the registry carries `key`
  // explicitly rather than deriving it from `flag`.
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("add-many") && f.key).map(f => f.key);
  assert.deepEqual(
    missingFrom(projected,
      ["externalId", "externalUrl", "id", "lane", "links", "parent", "planPath", "priority", "status", "title"]),
    [],
    "a state key add-many copied in 0.26.0 has been dropped from the registry");
});

test("every registry entry declares a flag, a key slot and at least one accepting command", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  for (const e of EPIC_FLAGS) {
    assert.equal(typeof e.flag, "string", `entry ${JSON.stringify(e)} has no flag name`);
    assert.ok(!e.flag.startsWith("--"), `entry '${e.flag}' must carry the bare flag name, no leading --`);
    assert.ok("key" in e, `entry '${e.flag}' must declare a state key (null where the command consumes it)`);
    assert.ok(Array.isArray(e.commands) && e.commands.length,
      `entry '${e.flag}' must name at least one accepting command`);
  }
  const names = EPIC_FLAGS.map(e => e.flag);
  assert.equal(new Set(names).size, names.length, "a flag must be declared exactly once");
});

test("UPDATE_EPIC_FLAGS is the registry's projection, not a literal that happens to match", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const { UPDATE_EPIC_FLAGS } = await import(new URL("../lib/update-epic.mjs", import.meta.url).href);
  // Order-sensitive on purpose. The 0.26.0 literal is set-equal to the projection (1.1 pins
  // that) but lists the flags in a different order, so ORDER is what tells "derived from the
  // registry" apart from "a second literal that currently agrees with it".
  assert.deepEqual(
    UPDATE_EPIC_FLAGS,
    EPIC_FLAGS.filter(f => f.commands.includes("update-epic")).map(f => f.flag),
    "update-epic's allowlist must BE the registry projection — registering a flag on " +
    "update-epic in EPIC_FLAGS must be the whole edit");
});

test("update-epic still names the offending flag AND the flags it does support", () => {
  // The refusal message is the whole point of the allowlist: an unrecognized flag used to
  // parse, run, and print "updated" with nothing changed. Making UPDATE_EPIC_FLAGS a
  // projection must not quietly turn that message into a bare usage dump.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--title", "Original"], { cwd });
  const before = readState(cwd);
  const err = expectFail(() => run(["update-epic", "a", "--bogus", "v"], { cwd }));
  assert.ok(err, "expected non-zero exit for an unlisted flag");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /--bogus/, "the refusal must name the flag that caused it");
  for (const flag of ["--title", "--status", "--link", "--review-mode", "--add-story"]) {
    assert.ok(msg.includes(flag), `the refusal must list the supported flag ${flag}`);
  }
  assert.deepEqual(readState(cwd).epics, before.epics, "a rejected flag must write nothing");
});

test("marking a flag `repeats: true` in the registry ALONE makes parseFlags accumulate it", async () => {
  // The union's forward half: a capability makes an epic flag repeat by editing the registry
  // and nothing else. Both imports resolve to the same module instances, so the probe pushed
  // onto EPIC_FLAGS here is the array parseFlags reads — which only holds if the repeatable
  // set is computed PER CALL rather than frozen at import.
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const { parseFlags } = await import(new URL("../lib/add-epic.mjs", import.meta.url).href);

  assert.equal(parseFlags(["--zz-probe", "a", "--zz-probe", "b"])["zz-probe"], "b",
    "an unregistered flag must still OVERWRITE — otherwise this test proves nothing");

  EPIC_FLAGS.push({ flag: "zz-probe", key: "zzProbe", commands: ["update-epic"], repeats: true });
  try {
    assert.deepEqual(parseFlags(["--zz-probe", "a", "--zz-probe", "b"])["zz-probe"], ["a", "b"],
      "a registry entry marked `repeats: true` must accumulate, with no edit to add-epic.mjs");
  } finally {
    EPIC_FLAGS.pop();
  }
});

test("set-tracker --intent still accumulates both pairs — the literal is UNIONED, not replaced", () => {
  // parseFlags is shared engine-wide. Of the seven flags in the 0.26.0 REPEATABLE_FLAGS
  // literal only `link` is an epic flag: `intent` is set-tracker's, `preauthorize`/`context`/
  // `notify` are set-autonomy's, `add`/`remove` are set-lane-routing's. A registry seeded with
  // epic flags alone would drop all six if the literal were replaced instead of unioned —
  // silently keeping the LAST occurrence of each.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "JOB",
       "--intent", "active:in-progress", "--intent", "paused:todo"], { cwd });
  assert.deepEqual(readState(cwd).tracker.statusIntent,
    { active: "in-progress", paused: "todo" },
    "both --intent pairs must survive");

  run(["set-lane-routing", "--add", "billing-*:openspec", "--add", "hotfix:claude-code"], { cwd });
  assert.equal(readState(cwd).laneRouting.overrides.length, 2,
    "both --add overrides must survive");
});

test("add-epic rejects an unsupported flag by name and writes nothing (#79)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = readState(cwd);
  const err = expectFail(() =>
    run(["add-epic", "--id", "x", "--lane", "claude-code", "--bogus", "v"], { cwd }));
  assert.ok(err, "expected non-zero exit — add-epic had no allowlist at all before this");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /--bogus/, "the refusal must name the offending flag");
  for (const flag of ["--id", "--lane", "--title", "--link"]) {
    assert.ok(msg.includes(flag), `the refusal must list the supported flag ${flag}`);
  }
  assert.deepEqual(readState(cwd).epics, before.epics, "no epic may be created");
});

test("add-epic never accepts an annotation flag it will not persist (#79's live payload)", () => {
  // The failure mode this closes is invisible: `--notes "<text>"` parsed, exited 0, and wrote
  // nothing, which destroyed the entire payload of epics registered so a later session would
  // remember why they exist. The assertion is deliberately EITHER-OR rather than "rejected",
  // so it keeps holding once epic-annotation makes --notes a real, persisted flag.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() =>
    run(["add-epic", "--id", "x", "--lane", "claude-code", "--notes", "why this exists"], { cwd }));
  if (err) {
    assert.match(String(err.stderr || err.message), /--notes/,
      "if --notes is not supported it must be rejected BY NAME");
    assert.equal(readState(cwd).epics.length, 0, "a rejected flag must create no epic");
  } else {
    const epic = readState(cwd).epics.find(e => e.id === "x");
    assert.ok(epic, "exit 0 must mean the epic was created");
    assert.match(JSON.stringify(epic), /why this exists/,
      "exit 0 must mean the text persisted — an exit code alone is not evidence");
  }
});

test("add-many rejects an unpersisted batch key by name and creates ZERO epics", () => {
  // Same defect as #79 at a different input shape: add-many copied a fixed key set and
  // dropped every other key without a word. The batch must be atomic in refusal too — the
  // two VALID entries either side of the offender must not be created.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [
    { id: "one", lane: "claude-code" },
    { id: "two", lane: "claude-code", notes: "this key is not persisted" },
    { id: "three", lane: "claude-code" },
  ] });
  const err = expectFail(() => run(["add-many", "--from", batch], { cwd }));
  assert.ok(err, "expected non-zero exit for an unpersisted batch key");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /notes/, "the refusal must name the offending key");
  assert.equal(readState(cwd).epics.length, 0,
    "a rejected batch must create none of its entries, not just skip the bad one");
});

test("every add-many key the registry declares round-trips through a batch entry", async () => {
  // Non-vacuity: the assertion is driven by the registry projection, so a key a later
  // capability adds to `add-many` fails here until the loop actually copies it.
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, {
    parent: { id: "p", lane: "claude-code" },
    epics: [{
      id: "full", lane: "claude-code", title: "T", priority: "P1", status: "queued",
      externalId: "JOB-1", externalUrl: "https://example.test/JOB-1",
      planPath: "docs/superpowers/plans/x.md", links: [], description: "why this epic exists",
      externalUpdatedAt: "2026-08-23T09:30:00Z",
      stories: ["a milestone", { title: "one already behind us", done: true }],
    }],
  });
  run(["add-many", "--from", batch], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "full");
  const batchKeys = EPIC_FLAGS.filter(f => f.commands.includes("add-many") && f.key).map(f => f.key);
  for (const key of batchKeys) {
    assert.ok(key in epic, `registry key '${key}' must round-trip through a batch entry`);
  }
  assert.equal(epic.parent, "p", "the batch's parent must still be inherited");
  assert.equal(epic.externalId, "JOB-1");
  assert.equal(epic.planPath, "docs/superpowers/plans/x.md");
});

// ─────────────── the flag-coverage check ───────────────
//
// The enumeration is read from the command's own DOCUMENTED surface at check time — its usage
// line and its `commands/` document — and never transcribed into this file. Driving it from
// EPIC_FLAGS would be circular: a flag a capability forgot to register is simply absent from
// the registry, so the check would pass vacuously on exactly the omission it exists to catch.

const REPO = new URL("../..", import.meta.url).pathname;
const FLAG_RE = /--[a-z][a-z0-9-]*/g;

/** The flags `update-epic`'s usage line names (update-epic.mjs:27). */
function flagsInUsageLine() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "update-epic.mjs"), "utf8");
  const line = src.split("\n").find(l => l.includes("usage: conductor.mjs update-epic"));
  assert.ok(line, "update-epic must still print a usage line — the check reads its flags from it");
  return new Set(line.match(FLAG_RE) || []);
}

/** The flags `commands/epic.md` names in update-epic's OWN section. Scoped to the section
 *  because that file documents add-epic, add-many, remove-epic and set-active too, and their
 *  flags are not update-epic's. */
function flagsInCommandDoc() {
  const doc = fs.readFileSync(path.join(REPO, "commands", "epic.md"), "utf8");
  const start = doc.indexOf("## Write-back — `update-epic`");
  assert.notEqual(start, -1, "commands/epic.md must still document update-epic in its own section");
  const next = doc.indexOf("\n## ", start + 1);
  const section = doc.slice(start, next === -1 ? doc.length : next);
  return new Set(section.match(FLAG_RE) || []);
}

/** How to exercise each flag, and what reading it back looks like. A VALUE table is
 *  unavoidable — `--parent` needs a real epic, `--link` a real target, `--story` an existing
 *  story — but the enumeration driving it is the documented surface, so a documented flag with
 *  no entry here is a hard failure naming the flag rather than a silent skip. */
const EXERCISE = {
  "--title": { args: ["--title", "Renamed"], check: (e) => assert.equal(e.title, "Renamed") },
  "--external-id": { args: ["--external-id", "JOB-9"], check: (e) => assert.equal(e.externalId, "JOB-9") },
  "--external-url": { args: ["--external-url", "https://example.test/9"], check: (e) => assert.equal(e.externalUrl, "https://example.test/9") },
  "--parent": { args: ["--parent", "other"], check: (e) => assert.equal(e.parent, "other") },
  "--status": { args: ["--status", "paused"], check: (e) => assert.equal(e.status, "paused") },
  "--priority": { args: ["--priority", "P1"], check: (e) => assert.equal(e.priority, "P1") },
  "--link": { args: ["--link", "blocks:other:because"], check: (e) => assert.deepEqual(e.links, [{ type: "blocks", epic: "other", reason: "because" }]) },
  // The setup link is load-bearing: a freshly created epic already has `links: []`, so without
  // it this entry would pass against an implementation that did nothing at all.
  "--clear-links": { setup: ["--link", "blocks:other:because"], args: ["--clear-links"], check: (e) => assert.deepEqual(e.links, []) },
  "--review-mode": { args: ["--review-mode", "thorough"], check: (e) => assert.equal(e.reviewMode, "thorough") },
  "--lane": { args: ["--lane", "superpowers"], check: (e) => assert.equal(e.lane, "superpowers") },
  "--plan": { args: ["--plan", "docs/superpowers/plans/p.md"], check: (e) => assert.equal(e.planPath, "docs/superpowers/plans/p.md") },
  "--external-updated-at": { args: ["--external-updated-at", "2026-08-23T09:30:00Z"], check: (e) => assert.equal(e.externalUpdatedAt, "2026-08-23T09:30:00Z") },
  "--description": { args: ["--description", "durable rationale"], check: (e) => assert.equal(e.description, "durable rationale") },
  // A note reads back as an ENTRY, not a string — {at, actor, text}. Asserting on the text
  // alone would pass against an implementation that stored the raw string and lost the trail.
  "--notes": { args: ["--notes", "an activity note"], check: (e) => assert.equal(e.notes.at(-1).text, "an activity note") },
  // --outcome/--reason are consumed at the archive transition and nowhere else, so they are
  // exercised through it; `subject` is a claude-code epic with no task source, so no Gate 2 is
  // demanded and its outstanding work is zero.
  "--outcome": { args: ["--status", "archived", "--outcome", "delivered", "--no-deferrals"], check: (e) => assert.equal(e.disposition.outcome, "delivered") },
  "--reason": { args: ["--status", "archived", "--outcome", "killed", "--reason", "Gate 1 found it unsafe", "--no-deferrals"], check: (e) => assert.equal(e.disposition.reason, "Gate 1 found it unsafe") },
  "--carried-to": { args: ["--status", "archived", "--outcome", "delivered", "--no-deferrals", "--carried-to", "other"], check: (e) => assert.equal(e.disposition.carriedTo, "other") },
  "--no-deferrals": { args: ["--status", "archived", "--outcome", "delivered", "--no-deferrals"], check: (e) => assert.deepEqual(e.deferralAssertion.deferrals, []) },
  "--deferral": { args: ["--status", "archived", "--outcome", "delivered", "--deferral", "other:design.md § Risks"], check: (e) => assert.deepEqual(e.deferralAssertion.deferrals, [{ epic: "other", section: "design.md § Risks" }]) },
  "--declined-deferral": { args: ["--status", "archived", "--outcome", "delivered", "--declined-deferral", "a second zero-fall-through fix:not worth the schema"], check: (e) => assert.deepEqual(e.deferralAssertion.declined, [{ what: "a second zero-fall-through fix", reason: "not worth the schema" }]) },
  "--attribute-commit": { args: ["--attribute-commit", "abc1234"], check: (e) => assert.deepEqual(e.attributedCommits, ["abc1234"]) },
  "--add-story": { args: ["--add-story", "a story"], check: (e) => assert.equal(e.stories.at(-1).title, "a story") },
  // --story and --done are a control PAIR: neither is invocable alone, so both are exercised
  // by the same invocation and each asserts the half it is responsible for.
  "--story": { setup: ["--add-story", "s1"], args: ["--story", "1", "--done"], check: (e) => assert.equal(e.stories[0].done, true) },
  "--done": { setup: ["--add-story", "s1"], args: ["--story", "1", "--done"], check: (e) => assert.equal(e.stories[0].done, true) },
  // --wont-do is the second half of --story's mutation pair. The row must SURVIVE, so this
  // asserts the title is still there alongside the disposition — a check on the disposition
  // alone would pass against an implementation that dropped the story and appended a record.
  "--wont-do": {
    setup: ["--add-story", "s1"],
    args: ["--story", "1", "--wont-do", "descoped by the release cut"],
    check: (e) => {
      assert.equal(e.stories[0].title, "s1");
      assert.equal(e.stories[0].done, false);
      assert.equal(e.stories[0].disposition.state, "wont-do");
      assert.equal(e.stories[0].disposition.reason, "descoped by the release cut");
    },
  },
};

test("every DOCUMENTED update-epic flag is accepted and its value reads back from state", () => {
  const usage = flagsInUsageLine();
  const doc = flagsInCommandDoc();
  assert.ok(usage.size >= 10, `the usage line yielded only ${usage.size} flags — the extractor is broken, not the command`);
  assert.ok(doc.size >= 5, `commands/epic.md's update-epic section yielded only ${doc.size} flags`);
  const documented = [...new Set([...usage, ...doc])].sort();

  for (const flag of documented) {
    const spec = EXERCISE[flag];
    assert.ok(spec,
      `documented flag ${flag} has no entry in this check's exercise table — a documented ` +
      "flag must be invoked and read back, never skipped for being unknown here");

    const cwd = tmpRepo();
    run(["init"], { cwd });
    run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
    run(["add-epic", "--id", "subject", "--lane", "claude-code"], { cwd });
    if (spec.setup) run(["update-epic", "subject", ...spec.setup], { cwd });
    const err = expectFail(() => run(["update-epic", "subject", ...spec.args], { cwd }));
    assert.equal(err, null,
      `update-epic rejected its own documented flag ${flag}: ${err && String(err.stderr || err.message)}`);
    spec.check(readState(cwd).epics.find(e => e.id === "subject"));
  }
});

// ─────────────── the disposition record ───────────────
//
// One shape at four scopes: an epic that ends, a declined deferral, a release exclusion, and
// a handoff. `outcome` is NOT a flat field on the epic and never becomes a `status` value —
// KNOWN_STATUSES is untouched.

const DISPOSITION = new URL("../lib/disposition.mjs", import.meta.url).href;

test("the outcome vocabulary and the engine-stamp token set are each exactly what the release defines", async () => {
  const { KNOWN_OUTCOMES, ENGINE_STAMP_TOKENS } = await import(DISPOSITION);
  // `declined` (gh-112) is the intake end: an ask considered and not taken on. Added to the
  // vocabulary rather than to KNOWN_STATUSES, so no status-driven behavior changes — and named
  // here because this assertion is EXACT: a seventh outcome added without a rule fails it.
  assert.deepEqual([...KNOWN_OUTCOMES].sort(),
    ["abandoned", "declined", "delivered", "killed", "superseded", "unknown"]);
  // Exact, not superset: a sixth token added without a rule fails here, and so does dropping
  // any of the five. Every exemption elsewhere in this release keys on one of these values.
  assert.deepEqual([...ENGINE_STAMP_TOKENS].sort(),
    ["add-epic", "add-many", "archive-backfill", "archive-drift-heal", "migration"]);
});

test("an agent-supplied disposition that is not `delivered` is rejected without a reason", async () => {
  const { KNOWN_OUTCOMES, dispositionError, agentDisposition } = await import(DISPOSITION);
  for (const outcome of KNOWN_OUTCOMES.filter(o => o !== "delivered")) {
    for (const reason of [undefined, "", "   "]) {
      const err = dispositionError({ outcome, reason });
      assert.ok(err, `'${outcome}' with reason ${JSON.stringify(reason)} must be rejected`);
      assert.match(err, /reason/, "the refusal must name the missing reason");
      assert.throws(() => agentDisposition({ outcome, reason }),
        `no record may be produced for '${outcome}' with reason ${JSON.stringify(reason)}`);
    }
  }
});

test("`delivered` needs no reason, and an agent's record carries no recordedBy", async () => {
  const { dispositionError, agentDisposition } = await import(DISPOSITION);
  assert.equal(dispositionError({ outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } }), null);
  const d = agentDisposition({ outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } });
  assert.equal(d.outcome, "delivered");
  assert.ok(d.recordedAt, "a disposition records when it was recorded");
  assert.equal("reason" in d, false, "an omitted reason must not be stored as an empty string");
  assert.equal("recordedBy" in d, false,
    "an agent-supplied record is defined by carrying NO recordedBy at all");
});

test("an outcome outside the vocabulary is rejected by name", async () => {
  const { dispositionError } = await import(DISPOSITION);
  const err = dispositionError({ outcome: "shipped", reason: "x" });
  assert.ok(err && err.includes("shipped"), "the refusal must name the outcome it rejected");
});

test("an engine stamp carries its path token, defaults to `unknown`, and demands no reason", async () => {
  const { ENGINE_STAMP_TOKENS, engineStamp } = await import(DISPOSITION);
  for (const token of ENGINE_STAMP_TOKENS) {
    const d = engineStamp(token);
    assert.equal(d.outcome, "unknown");
    assert.equal(d.recordedBy, token);
    assert.ok(d.recordedAt);
    assert.equal("reason" in d, false);
  }
  // The migration stamps `delivered` where a passing Gate 2 exists, and prefers the epic's
  // existing completedAt over the migration clock — so both are parameters, not constants.
  const m = engineStamp("migration", { outcome: "delivered", recordedAt: "2026-01-02T03:04:05.000Z" });
  assert.equal(m.outcome, "delivered");
  assert.equal(m.recordedAt, "2026-01-02T03:04:05.000Z");
  assert.throws(() => engineStamp("some-new-path"),
    "a token outside the fixed five must be rejected, not silently recorded");
});

test("outcomeOf is the reader — an epic with no disposition reads `unknown`", async () => {
  const { outcomeOf, agentDisposition, engineStamp } = await import(DISPOSITION);
  assert.equal(outcomeOf({}), "unknown",
    "an epic that predates this capability reads `unknown`, which is exactly true: nobody " +
    "recorded a disposition");
  assert.equal(outcomeOf({ disposition: null }), "unknown");
  assert.equal(outcomeOf({ disposition: agentDisposition({ outcome: "killed", reason: "Gate 1" }) }), "killed");
  assert.equal(outcomeOf({ disposition: engineStamp("migration", { outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } }) }), "delivered");
});

test("isEngineStamped is the ONLY way an engine stamp is told from an agent's record", async () => {
  const { ENGINE_STAMP_TOKENS, isEngineStamped, agentDisposition } = await import(DISPOSITION);
  assert.equal(isEngineStamped(agentDisposition({ outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } })), false,
    "no recordedBy at all is what makes a record agent-supplied");
  assert.equal(isEngineStamped(undefined), false);
  assert.equal(isEngineStamped({ outcome: "unknown" }), false);
  for (const token of ENGINE_STAMP_TOKENS) {
    assert.equal(isEngineStamped({ outcome: "unknown", recordedBy: token }), true, token);
  }
  assert.equal(isEngineStamped({ outcome: "unknown", recordedBy: "some-later-path" }), false,
    "a token outside the fixed five is not an engine stamp — the set is closed on purpose");
});

test("no module under scripts/lib/ reads .outcome or .recordedBy off an epic", async () => {
  // The invariant that makes `outcome is not a flat field` enforceable rather than a comment.
  // disposition.mjs is the one exemption, and for the stated reason: it DEFINES the readers,
  // so isEngineStamped necessarily inspects recordedBy itself.
  const libDir = path.join(REPO, "scripts", "lib");
  const offenders = [];
  for (const name of fs.readdirSync(libDir).filter(f => f.endsWith(".mjs"))) {
    if (name === "disposition.mjs") continue;
    const src = fs.readFileSync(path.join(libDir, name), "utf8");
    src.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;  // prose, not code
      // `f` is parseFlags()'s result — the CLI flags an invocation carried, not an epic. A
      // command reading its own `--outcome` flag is not a second reader of the record.
      if (/\bf\.\s*(outcome|recordedBy)\b/.test(line)) return;
      if (/\.\s*(outcome|recordedBy)\b/.test(line)) offenders.push(`${name}:${i + 1}: ${t}`);
    });
  }
  assert.deepEqual(offenders, [],
    "read an outcome through outcomeOf(epic) and an engine stamp through " +
    "isEngineStamped(disposition) — a direct property read is how a second definition starts");
});

test("a recorded disposition renders in PROJECT.md and the brief from state.json alone", () => {
  // "A change killed at Gate 1 with 47 tasks and no code written is byte-identical in
  // state.json to one that shipped" is the defect. The reason must be readable without
  // opening the commit that deleted the change's spec files — so it renders from the record,
  // and no prose artifact is consulted to produce it.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{
      id: "killed-at-gate-1", title: "Autonomous exit-path check", priority: "P1",
      status: "archived", role: "epic", lane: "openspec", links: [],
      disposition: {
        outcome: "killed",
        reason: "Gate 1 found the proposed check would invert stop-loss safety",
        recordedAt: "2026-08-20T10:11:12.000Z",
      },
    }],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /killed/, "PROJECT.md must name the recorded outcome");
  assert.match(md, /invert stop-loss safety/, "PROJECT.md must carry the recorded reason");
  assert.match(md, /2026-08-20/, "PROJECT.md must say when the disposition was recorded");

  const brief = parseBrief(cwd);
  assert.match(brief, /killed/, "the brief must name the recorded outcome");
  assert.match(brief, /invert stop-loss safety/, "the brief must carry the recorded reason");
});

test("an engine `unknown` stamp with no reason adds no disposition row", () => {
  // 66 of this repository's archived epics will read `unknown` after the migration. A row per
  // epic saying nothing the status column does not already say is how a reader learns to skip
  // the section — the outcome still shows beside the status.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{
      id: "healed", title: "Healed from disk", priority: "P2",
      status: "archived", role: "epic", lane: "claude-code", links: [],
      disposition: { outcome: "unknown", recordedAt: "2026-08-20T10:11:12.000Z", recordedBy: "archive-drift-heal" },
    }],
  });
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /## Dispositions/,
    "an `unknown` stamp carrying no reason must not open a Dispositions section on its own");
});

// ─────────────── the archive gate ───────────────
//
// The Gate 2 refusal lived inline in update-epic.mjs, which is exactly how it came to bind
// ONE of the five paths that can leave an epic at `status: "archived"`. It moves into a module
// the paths import, so a rule added there binds every caller rather than whichever site the
// implementer happened to be editing.

const ARCHIVE_GATE = new URL("../lib/archive-gate.mjs", import.meta.url).href;

test("update-epic holds no openspec-lane archive condition of its own", () => {
  // The co-occurrence is what matters, not the bare string: a line that tests the openspec
  // lane AND reads a gate verdict is the guard, wherever it is written.
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "update-epic.mjs"), "utf8");
  const lines = src.split("\n");
  const offenders = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (!line.includes('"openspec"')) return;
    const window = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
    if (/gate2|gateReview/.test(window)) offenders.push(`${i + 1}: ${t}`);
  });
  assert.deepEqual(offenders, [],
    "the archive gate belongs in archive-gate.mjs, which every archive path imports — an " +
    "inline condition here binds this one path and no other");
});

test("the archive gate returns a refusal OBJECT and never exits the process itself", async () => {
  const { archiveGate } = await import(ARCHIVE_GATE);
  const refused = archiveGate({ id: "spec-epic", lane: "openspec" }, { outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Gate 2/,
    "the refusal must name what is missing, and it must be a value the caller can plumb — " +
    "a gate that calls process.exit is unusable from any path that has cleanup to do");
  assert.equal(archiveGate({ id: "spec-epic", lane: "openspec",
    gateReview: { gate2: { verdict: "fail" } } }, { outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } }).ok, false);
  assert.equal(archiveGate({ id: "spec-epic", lane: "openspec",
    gateReview: { gate2: { verdict: "pass" } } }, { outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } }).ok, true);
  assert.equal(archiveGate({ id: "cc-epic", lane: "claude-code" }, { outcome: "delivered", deferralAssertion: { deferrals: [], declined: [] } }).ok, true,
    "a non-openspec-lane epic is unaffected");
});

test("the gate is reachable from update-epic, refusal text intact", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = readState(cwd);
  const err = expectFail(() => run(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "expected the archive to be refused");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /cannot archive openspec-lane epic 'spec-epic'/,
    "the message must still identify the epic and the lane rule that refused it");
  assert.match(msg, /record-gate-review spec-epic --gate 2 --verdict pass/,
    "every refusal names its remedy and the exact command");
  assert.deepEqual(readState(cwd).epics, before.epics, "a refused archive writes nothing");
});

// ─────────────── outstanding work, and the <!-- pm:lifecycle --> declaration ───────────────

/** Evaluate epicProgress()/outstandingWork() for `epic` with the engine rooted at `cwd`.
 *
 *  A CHILD PROCESS, not a cache-busted in-process import: constants.mjs resolves ROOT once at
 *  import time and a query string on epic-progress.mjs does not reach the constants.mjs it
 *  imports, so an in-process reload would silently keep the FIRST root any test established
 *  and read task sources out of this repository instead of the fixture. */
function progressIn(cwd, epic) {
  const src = `
    import { epicProgress, outstandingWork } from ${JSON.stringify(new URL("../lib/epic-progress.mjs", import.meta.url).href)};
    const epic = JSON.parse(process.env.PM_TEST_EPIC);
    process.stdout.write(JSON.stringify({ progress: epicProgress(epic), outstanding: outstandingWork(epic) }));
  `;
  const out = execFileSync("node", ["--input-type=module", "-e", src], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_TEST_EPIC: JSON.stringify(epic) },
  });
  return JSON.parse(out);
}

function withTasks(cwd, id, lines) {
  const dir = path.join(cwd, "openspec", "changes", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), lines.join("\n") + "\n");
}

const MARKER = "<!-- pm:lifecycle -->";

test("a declared lifecycle task leaves BOTH numerator and denominator", () => {
  // 12 of 13 done, the thirteenth an archive instruction that cannot be ticked before the
  // thing that ticks it. It renders 12/12 and nothing is outstanding — never 12/13 with a
  // footnote, because a guard and a progress bar computing different numbers is how a guard
  // comes to refuse an epic that reads as complete.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const lines = Array.from({ length: 12 }, (_, i) => `- [x] ${i + 1} did a thing`);
  lines.push(`- [ ] 13 ${MARKER} Run \`/opsx:archive <this change>\``);
  withTasks(cwd, "ctt", lines);
  run(["add-epic", "--id", "ctt", "--lane", "openspec"], { cwd });

  const { progress, outstanding } = progressIn(cwd, readState(cwd).epics.find(e => e.id === "ctt"));
  assert.equal(progress.done, 12);
  assert.equal(progress.total, 12, "the excluded task must leave the DENOMINATOR too");
  assert.equal(progress.excluded, 1);
  assert.equal(outstanding, 0);

  run(["render"], { cwd });
  assert.match(projectMd(cwd), /12\/12/, "the rendered bar must show the same arithmetic");
  assert.doesNotMatch(projectMd(cwd), /12\/13/);
});

test("a marked task is excluded whether or not it is ticked", () => {
  // 17.9 in this very change is a marked task that WILL be ticked. If exclusion depended on
  // the checkbox state the count would move at the instant it is ticked, which is the silent
  // drift this definition exists to prevent.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "ctt", [`- [x] 1 ${MARKER} archived already`, "- [ ] 2 real work"]);
  run(["add-epic", "--id", "ctt", "--lane", "openspec"], { cwd });
  const { progress, outstanding } = progressIn(cwd, readState(cwd).epics.find(e => e.id === "ctt"));
  assert.deepEqual({ done: progress.done, total: progress.total, excluded: progress.excluded },
    { done: 0, total: 1, excluded: 1 });
  assert.equal(outstanding, 1);
});

test("excluded is always a number, including on the branches that read no file", () => {
  // 3.5's byte-identical-count assertion compares this field across surfaces; `undefined`
  // where one branch means zero is how two surfaces come to disagree.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const stories = progressIn(cwd, { id: "s", lane: "claude-code", stories: [{ title: "a", done: true }, { title: "b", done: false }] });
  assert.equal(stories.progress.excluded, 0);
  assert.equal(stories.outstanding, 1);
  const none = progressIn(cwd, { id: "n", lane: "decision" });
  assert.equal(none.progress.excluded, 0);
  assert.equal(none.outstanding, 0);
  const danglingPlan = progressIn(cwd, { id: "d", lane: "superpowers", planPath: "docs/superpowers/plans/gone.md" });
  assert.equal(danglingPlan.progress.excluded, 0);
});

test("an UNDECLARED task is counted however it is worded", () => {
  // Both of these are what a text matcher would get wrong, in the direction that matters: an
  // undeclared bookkeeping task keeps counting (visible in the record), while a matcher would
  // silently exclude the second one and under-report outstanding work.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "ctt", [
    "- [x] 1 real work",
    "- [ ] 2 run `/opsx:archive <this change>`",
    "- [ ] 3 implement archiving so `/opsx:archive` moves the directory, and test it",
  ]);
  run(["add-epic", "--id", "ctt", "--lane", "openspec"], { cwd });
  const { progress, outstanding } = progressIn(cwd, readState(cwd).epics.find(e => e.id === "ctt"));
  assert.equal(progress.total, 3, "neither task may be excluded — neither carries the marker");
  assert.equal(progress.excluded, 0);
  assert.equal(outstanding, 2);
});

test("the marker is read on the task LINE — never on a following line, never by position", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "ctt", [
    `- [ ] 1 ${MARKER} marker before the text`,
    `- [ ] 2 marker at the end of the line ${MARKER}`,
    "- [ ] 3 the marker below belongs to nothing",
    `  ${MARKER}`,
    "- [ ] 4 last task, and last in the file",
  ]);
  run(["add-epic", "--id", "ctt", "--lane", "openspec"], { cwd });
  const { progress } = progressIn(cwd, readState(cwd).epics.find(e => e.id === "ctt"));
  assert.equal(progress.excluded, 2, "exactly the two tasks whose own line carries the marker");
  assert.equal(progress.total, 2,
    "a marker on a FOLLOWING line excludes nothing, and being last in the file excludes nothing");
});

test("a source whose every task is excluded is still a SOURCE — no missing-source warning", () => {
  // `exists` from countCheckboxes() stays the discriminator. Switching it to `total > 0`
  // collapses "present and fully excluded" into "missing", which is the three-states-into-one
  // -glyph failure the missing-source warning was added to end.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "ctt", [`- [x] 1 ${MARKER} archived`, `- [ ] 2 ${MARKER} closed the issues`]);
  run(["add-epic", "--id", "ctt", "--lane", "openspec"], { cwd });
  const { progress, outstanding } = progressIn(cwd, readState(cwd).epics.find(e => e.id === "ctt"));
  assert.equal(progress.warn, null, "a present, readable source must never warn as missing");
  assert.equal(progress.total, 0);
  assert.equal(progress.excluded, 2);
  assert.equal(outstanding, 0);
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /tasks\.md missing/);
});

/** outstandingSummary() for `epic` with the engine rooted at `cwd`. Child process, for the
 *  same reason progressIn() is one. */
function summaryIn(cwd, epic) {
  const src = `
    import { outstandingSummary } from ${JSON.stringify(new URL("../lib/archive-gate.mjs", import.meta.url).href)};
    process.stdout.write(JSON.stringify(outstandingSummary(JSON.parse(process.env.PM_TEST_EPIC))));
  `;
  return JSON.parse(execFileSync("node", ["--input-type=module", "-e", src], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_TEST_EPIC: JSON.stringify(epic) },
  }));
}

test("the count a guard would cite is byte-identical to the count PROJECT.md renders", () => {
  // A guard that refuses because work remains must cite THIS count. Refusing an epic that
  // renders as complete — because the guard counted an item the definition excludes — is the
  // failure this shared renderer exists to make impossible.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const lines = Array.from({ length: 12 }, (_, i) => `- [x] ${i + 1} done`);
  lines.push("- [ ] 13 still outstanding");
  lines.push(`- [ ] 14 ${MARKER} Run \`/opsx:archive <this change>\``);
  withTasks(cwd, "ctt", lines);
  run(["add-epic", "--id", "ctt", "--lane", "openspec"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "ctt");

  const summary = summaryIn(cwd, epic);
  assert.equal(summary.outstanding, 1, "one unticked, undeclared task remains");
  run(["render"], { cwd });
  assert.ok(projectMd(cwd).includes(summary.claimed),
    `PROJECT.md must render the same count a refusal would cite (${summary.claimed})`);
  assert.ok(parseBrief(cwd).includes(summary.claimed),
    "and so must the brief — three surfaces, one arithmetic");
});

test("no module computes outstanding work for itself", () => {
  // The definition lives in epic-progress.mjs. A second subtraction anywhere else is how a
  // guard and a progress bar come to disagree, which is the whole defect.
  const libDir = path.join(REPO, "scripts", "lib");
  const offenders = [];
  for (const name of fs.readdirSync(libDir).filter(f => f.endsWith(".mjs"))) {
    if (name === "epic-progress.mjs") continue;
    fs.readFileSync(path.join(libDir, name), "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (/\btotal\s*-\s*\w*\.?done\b|\.total\s*-\s*/.test(line)) offenders.push(`${name}:${i + 1}: ${t}`);
    });
  }
  assert.deepEqual(offenders, [],
    "ask outstandingWork(epic) — it is the single definition every consumer keys on");
});

test("all three surfaces present checkbox progress as CLAIMED completion, in one wording", async () => {
  // Measured, not theoretical: in an 18-epic sample 3 ticked tasks hid undone work — one
  // still defective at HEAD — and all 3 unticked boxes were non-work. The errors run toward
  // over-reporting completion, so `12/12` must not read as evidence that the work is correct.
  const { CLAIMED_COMPLETION_NOTE } = await import(new URL("../lib/epic-progress.mjs", import.meta.url).href);
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "ctt", ["- [x] 1 done", "- [x] 2 done"]);
  run(["add-epic", "--id", "ctt", "--lane", "openspec", "--status", "active"], { cwd });
  run(["render"], { cwd });

  assert.ok(projectMd(cwd).includes(CLAIMED_COMPLETION_NOTE),
    "PROJECT.md must say so beside the progress it renders");
  assert.ok(parseBrief(cwd).includes(CLAIMED_COMPLETION_NOTE),
    "the brief must say so too — a compacted session re-reads only this");
  // /pm:next is a command document, not an engine subcommand: its output is authored by the
  // agent following commands/next.md, so the obligation binds that text.
  assert.ok(fs.readFileSync(path.join(REPO, "commands", "next.md"), "utf8").includes(CLAIMED_COMPLETION_NOTE),
    "/pm:next must carry the same wording, verbatim, so the three surfaces cannot drift");
});

test("a task that merely DOCUMENTS the marker is not excluded by it", () => {
  const cwd = tmpRepo();
  withTasks(cwd, "doc-mention", [
    `- [ ] 1.1 Real delivery work whose text mentions \`${MARKER}\` inside a code span`,
    `- [ ] 1.2 ${MARKER} Genuine bookkeeping, actually declared`,
    "- [x] 1.3 Done",
  ]);
  const { progress, outstanding } = progressIn(cwd, { id: "doc-mention", lane: "openspec" });
  // Found by dogfooding: this change's own tasks.md names the marker in backticks on six real
  // task lines and declares on exactly one. Counting the mentions would under-report
  // outstanding work by six and make the release's own self-check pass falsely.
  assert.equal(progress.excluded, 1, "a backticked mention must not count as a declaration");
  assert.equal(progress.total, 2);
  assert.equal(progress.done, 1);
  assert.equal(outstanding, 1);
});

// ─────────────── openspec-lane normalization: every site, not some of them ───────────────
//
// A lane-less epic renders as openspec-lane everywhere (resolveEpics() normalizes) and then
// slips every gate that tests `epic.lane === "openspec"` strictly. The strict sites surviving
// wave 1 are the archive guard (now in archive-gate.mjs), missing() and record-gate-review's
// lane refusal; the heal's bypass-half lane test (6.8) is the fourth and consumes the same
// predicate rather than re-deriving one.

const EPIC_PROGRESS = new URL("../lib/epic-progress.mjs", import.meta.url).href;

/** A state file holding one lane-less epic — a shape `add-epic` cannot produce (`--lane` is
 *  required) and every pre-0.3.0 repo is full of. */
function withLanelessEpic(cwd, overrides = {}) {
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{
      id: "no-lane", title: "No lane recorded", priority: "P1",
      status: "queued", role: "epic", links: [], reconcileNeeded: false, ...overrides,
    }],
  });
}

test("a lane-less epic is held to the openspec-lane archive gate", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withLanelessEpic(cwd);
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "no-lane", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "an epic with no lane renders as openspec-lane, so the gate must bind it");
  assert.match(String(err.stderr || err.message), /Gate 2/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("a lane-less epic appears in the dangling-change check", async () => {
  // missing() is exercised as a UNIT deliberately. Every caller in the engine hands it an epic
  // resolveEpics() has already normalized, so an end-to-end assertion cannot distinguish a
  // strict site from a normalized one and would pass either way — a vacuous check on exactly
  // the omission this task exists to close.
  const { missing } = await import(EPIC_PROGRESS);
  assert.equal(missing({ id: "no-lane", present: false, status: "queued" }), true,
    "an epic with no lane is openspec-lane, so a missing change on disk is a dangling pointer");
});

test("a gate verdict can be recorded against a lane-less epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withLanelessEpic(cwd);
  run(["record-gate-review", "no-lane", "--gate", "2", "--verdict", "pass", "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "no-lane");
  assert.equal(epic.gateReview.gate2.verdict, "pass",
    "refusing a verdict to an epic every other site treats as openspec-lane leaves it with no " +
    "way to ever satisfy the gate that binds it");
});

test("no module under scripts/lib/ decides openspec-lane membership with a strict comparison", () => {
  // A fifth strict site added later — 6.8's heal bypass included — fails HERE rather than
  // passing silently, which is the whole reason the predicate is exported instead of the
  // normalization being retyped at each site.
  const libDir = path.join(REPO, "scripts", "lib");
  const offenders = [];
  for (const name of fs.readdirSync(libDir).filter(f => f.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(libDir, name), "utf8");
    src.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (!/[!=]==\s*"openspec"/.test(line)) return;
      if (line.includes('|| "openspec"')) return;      // normalized inline — acceptable
      offenders.push(`${name}:${i + 1}: ${t}`);
    });
  }
  assert.deepEqual(offenders, [],
    "decide openspec-lane membership through isOpenspecLane(epic), or normalize the absent " +
    "lane inline — a strict comparison silently exempts every lane-less epic");
});

// ─────────────── gate verdicts carry checkable evidence ───────────────
//
// `record-gate-review <id> --gate 2 --verdict pass` was one command with no evidence
// requirement: a review of `a..b` on an epic that later shipped `b..c` is byte-identical in
// the record to one that covered everything.

test("a pass records its range and reviewer as separate FIELDS, not as prose", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass",
    "--base-sha", "d168b1e", "--head-sha", "04c54c8", "--reviewer", "fresh-context reviewer"], { cwd });
  const g = readState(cwd).epics.find(e => e.id === "spec-epic").gateReview.gate2;
  assert.equal(g.verdict, "pass");
  assert.equal(g.baseSha, "d168b1e", "the reviewed range's base must be readable without parsing prose");
  assert.equal(g.headSha, "04c54c8");
  assert.equal(g.reviewer, "fresh-context reviewer",
    "reviewer identity is its own field — stored in `note`, an audit query over reviewers " +
    "cannot tell an identity from any other remark");
});

test("a pass with no recorded range is refused, naming the missing evidence", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass", "--base-sha", "d168b1e"], { cwd }));
  assert.ok(err, "a pass with no --head-sha claims a review of nothing checkable");
  assert.match(String(err.stderr || err.message), /--head-sha/,
    "the refusal must name the evidence that is missing, not just that something is");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "a refused verdict writes nothing");
});

test("a fail verdict may omit the range — there is no shipped work to have covered", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "fail"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "spec-epic").gateReview.gate2.verdict, "fail");
});

// A verdict recorded before the evidence fields existed carries a free-text note. It stays
// exactly as recorded — the note names shas, and mining them would rebuild the prose
// dependency the fields exist to remove.

const LEGACY_STATE = path.join(REPO, "scripts", "test", "fixtures", "state-legacy-gate-verdict.json");

test("a pre-existing verdict loads, renders as carrying no checkable evidence, and is not rewritten", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const legacy = fs.readFileSync(LEGACY_STATE, "utf8");
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), legacy);
  run(["render"], { cwd });

  const md = projectMd(cwd);
  assert.match(md, /no checkable evidence/,
    "a verdict with no recorded range must be reported as unevidenced, never shown as a " +
    "verified pass — 42 of 49 audited archives reached `archived` on exactly this shape");
  const brief = parseBrief(cwd);
  assert.match(brief, /no checkable evidence/);

  const g = readState(cwd).epics.find(e => e.id === "platform-parity-mechanism").gateReview.gate2;
  assert.equal(g.verdict, "pass", "the verdict is not deleted or downgraded");
  assert.match(g.note, /d168b1e\.\.04c54c8/, "the note survives verbatim");
  assert.equal(g.baseSha, undefined, "no range is invented for it");
  assert.equal(g.headSha, undefined);
});

test("no module under scripts/lib/ mines a sha or a range out of a verdict note", () => {
  const libDir = path.join(REPO, "scripts", "lib");
  const offenders = [];
  for (const name of fs.readdirSync(libDir).filter(f => f.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(libDir, name), "utf8");
    src.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      // A PROPERTY read — `entry.note`, `gate2.note`. The detour log also carries a local
      // `note` variable it splits and trims (git.mjs, render.mjs's Recent-detours table), and
      // that has nothing to do with a gate verdict; scoping to the property access is what
      // keeps this scan pointed at the thing it is about.
      if (!/\.note\b/.test(line)) return;
      if (/\.(match|exec|split|search|slice|indexOf)\s*\(|RegExp|\[0-9a-f\]/.test(line)) {
        offenders.push(`${name}:${i + 1}: ${t}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    "a note is prose and stays prose — parsing a range out of one is the dependency the " +
    "baseSha/headSha fields were added to remove");
});

// ─────────────── two verdict vocabularies, deliberately distinct ───────────────
//
// `ungated` means "no review happened". Widening the single `--verdict` allowlist to admit it
// for storage's sake would let the party whose work would otherwise be reviewed certify that
// no review was needed — which is why the agent-writable list and the storable list are two
// lists rather than one.

const GATE_WRITEBACK = new URL("../lib/gate-review-writeback.mjs", import.meta.url).href;

test("the agent-writable and the storable verdict vocabularies are separate lists", async () => {
  const { KNOWN_GATE_VERDICTS } = await import(GATE_WRITEBACK);
  const { STORABLE_GATE_VERDICTS } = await import(CONSTANTS);
  assert.deepEqual(KNOWN_GATE_VERDICTS, ["pass", "fail"],
    "the agent may write a verdict about a review that happened, and nothing else");
  assert.deepEqual(STORABLE_GATE_VERDICTS, ["pass", "fail", "ungated"],
    "the engine may additionally store `ungated` — the archive-drift heal's record that it " +
    "flipped a status with no verdict from anyone");
  assert.ok(!KNOWN_GATE_VERDICTS.includes("ungated"),
    "the moment `ungated` appears in the agent's allowlist this capability is defeated");
});

test("record-gate-review refuses `ungated` and names the verdicts it accepts", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "ungated"], { cwd }));
  assert.ok(err, "a verdict meaning `no review happened` is not self-certifiable");
  assert.match(String(err.stderr || err.message), /pass\|fail/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("a real verdict supersedes the prior entry instead of destroying it", () => {
  // The heal's `ungated` entry is the record that an epic was archived with no review. A
  // wholesale overwrite meant the verdict that SUPERSEDES it also erased it, so
  // "the superseded entry MUST remain readable" had no writer anywhere in the engine.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{
      id: "healed-then-reviewed", title: "Healed, then really reviewed", priority: "P1",
      status: "archived", role: "epic", lane: "openspec", links: [], reconcileNeeded: false,
      gateReview: { gate2: {
        verdict: "ungated", reviewedAt: "2026-08-01T09:00:00.000Z", recordedBy: "archive-drift-heal",
      } },
    }],
  });
  run(["record-gate-review", "healed-then-reviewed", "--gate", "2", "--verdict", "pass",
    "--base-sha", "d168b1e", "--head-sha", "04c54c8"], { cwd });

  const g = readState(cwd).epics.find(e => e.id === "healed-then-reviewed").gateReview.gate2;
  assert.equal(g.verdict, "pass");
  assert.equal(g.superseded.verdict, "ungated",
    "an audit must still be able to see the epic was archived ungated before it was reviewed");
  assert.equal(g.superseded.recordedBy, "archive-drift-heal");
});

test("supersession preserves ANY prior entry and never nests a second level", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "fail"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass",
    "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass",
    "--base-sha", "aaaaaaa", "--head-sha", "ccccccc"], { cwd });

  const g = readState(cwd).epics.find(e => e.id === "spec-epic").gateReview.gate2;
  assert.equal(g.headSha, "ccccccc");
  assert.equal(g.superseded.headSha, "bbbbbbb", "the entry it replaced, whatever its verdict");
  assert.equal(g.superseded.superseded, undefined,
    "one nested record, not a chain — a growing history here is a different capability");
});

// ─────────────── Gate 1 is read ───────────────
//
// `gate1` was stored, documented in the `conductor` skill, and consumed by NOTHING: the sole
// reader of `gateReview` anywhere in the engine was the archive guard's `gate2` test. A spec
// review that never happened was indistinguishable from one that did.

test("an epic carrying only a gate1 verdict is named on both surfaces, with its evidence", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-only", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-only", "--gate", "1", "--verdict", "pass",
    "--base-sha", "1111111", "--head-sha", "2222222", "--reviewer", "spec reviewer"], { cwd });

  const md = projectMd(cwd);
  assert.match(md, /Gate 1/, "PROJECT.md must have somewhere to show a spec review at all");
  assert.match(md, /1111111\.\.2222222/, "and must show the evidence it recorded");
  assert.match(md, /spec reviewer/);

  const brief = parseBrief(cwd);
  assert.match(brief, /gate 1: pass \(1111111\.\.2222222\)/,
    "an epic with no gate2 must still appear — filtering the section on gate2 hides exactly " +
    "the epic whose spec review is the only one recorded");
});

// ─────────────── commit attribution ───────────────

test("--attribute-commit appends a hash that reads back from state.json", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "openspec"], { cwd });
  run(["update-epic", "subject", "--attribute-commit", "1a2b3c4"], { cwd });
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "subject").attributedCommits, ["1a2b3c4"]);
  run(["update-epic", "subject", "--attribute-commit", "5d6e7f8"], { cwd });
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "subject").attributedCommits,
    ["1a2b3c4", "5d6e7f8"], "appends in the order given — the LAST entry is what a verdict's " +
    "headSha is compared against, so order is the meaning");
});

test("two hashes in ONE invocation both land, in the order given", () => {
  // parseFlags overwrites a non-repeatable flag on each occurrence, so without `repeats: true`
  // this exits 0 having kept only the second — one hash where two were attributed, and the
  // order that gives the array its meaning gone with it.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "openspec"], { cwd });
  run(["update-epic", "subject", "--attribute-commit", "aaa1111", "--attribute-commit", "bbb2222"], { cwd });
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "subject").attributedCommits,
    ["aaa1111", "bbb2222"], "reports length 1 the moment the flag leaves the repeatable set");
});

// ─────────────── absent vs empty attribution ───────────────

// The creation-path rule is checked at the BOTTOM of this file, derived from the source rather
// than from a list of command names — the check that stood here enumerated `add-epic` and
// `add-many` by name and passed while `sync`'s two paths carried nothing.

test("an epic written before this capability carries NO attribution key at all", () => {
  // The distinction is load-bearing: absent means unverifiable and is forgiven by the staleness
  // gate, empty means the agent had the obligation and did not meet it.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), fs.readFileSync(LEGACY_STATE, "utf8"));
  run(["render"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "platform-parity-mechanism");
  assert.ok(!Object.prototype.hasOwnProperty.call(e, "attributedCommits"),
    "nothing may back-fill the array onto a pre-existing epic — that would convert the gate's " +
    "one forgiven case into a repo-wide false claim");
});

// ─────────────── verdict staleness ───────────────
//
// Repository HEAD is deliberately NOT the baseline: an epic archived a week after its merge has
// a HEAD far past its own headSha through nobody's fault. The baseline is the LAST commit the
// agent attributed to this epic.

const headSha = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

/** An openspec epic with a passing Gate 2 in a real two-delivery-commit repository. */
function stalenessFixture({ attribute, reviewedUpTo }) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  commitFiles(cwd, { "one.txt": "1" }, "feat: first delivery commit");
  const first = headSha(cwd);
  commitFiles(cwd, { "two.txt": "2" }, "feat: second delivery commit");
  const second = headSha(cwd);
  run(["add-epic", "--id", "shipped", "--lane", "openspec"], { cwd });
  for (const sha of attribute({ first, second })) {
    run(["update-epic", "shipped", "--attribute-commit", sha], { cwd });
  }
  run(["record-gate-review", "shipped", "--gate", "2", "--verdict", "pass",
    "--base-sha", "HEAD~2", "--head-sha", reviewedUpTo({ first, second })], { cwd });
  return { cwd, first, second };
}

test("a verdict whose range stops short of the attributed commits refuses the archive", () => {
  const { cwd, first, second } = stalenessFixture({
    attribute: ({ first, second }) => [first, second],
    reviewedUpTo: ({ first }) => first,
  });
  const err = expectFail(() => run(["update-epic", "shipped", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "a review of a..b on an epic that shipped b..c did not review what shipped");
  const msg = String(err.stderr || err.message);
  assert.match(msg, new RegExp(first), "the refusal names the range the reviewer actually read");
  assert.match(msg, new RegExp(second), "and the attributed commit it does not cover");
  assert.equal(readState(cwd).epics.find(e => e.id === "shipped").status, "queued");
});

test("a verdict covering the last attributed commit passes, even after HEAD moves on", () => {
  const { cwd } = stalenessFixture({
    attribute: ({ first, second }) => [first, second],
    reviewedUpTo: ({ second }) => second,
  });
  // Unrelated work lands afterwards — someone else's epic. HEAD is now far past the verdict.
  commitFiles(cwd, { "unrelated.txt": "x" }, "chore: another epic's commit");
  run(["update-epic", "shipped", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "shipped").status, "archived");
});

test("the archive-move commit, left unattributed, does not make the epic's own verdict stale", () => {
  // The trap the emitted exclusion exists to keep an agent out of, asserted against the gate:
  // the move lands after the reviewed range by construction, so attributing it would refuse the
  // archive at the exact moment the archive gate reads the verdict.
  const { cwd, second } = stalenessFixture({
    attribute: ({ first, second }) => [first, second],
    reviewedUpTo: ({ second }) => second,
  });
  assert.ok(second);
  commitFiles(cwd, { "openspec-archive-move.txt": "moved" }, "chore(opsx): archive the change");
  run(["update-epic", "shipped", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "shipped").status, "archived",
    "the move was never attributed, so the recorded headSha is still the last entry");
});

test("attributing the archive-move commit DOES refuse it — which is why the exclusion is emitted", () => {
  const { cwd } = stalenessFixture({
    attribute: ({ first, second }) => [first, second],
    reviewedUpTo: ({ second }) => second,
  });
  commitFiles(cwd, { "openspec-archive-move.txt": "moved" }, "chore(opsx): archive the change");
  run(["update-epic", "shipped", "--attribute-commit", headSha(cwd)], { cwd });
  const err = expectFail(() => run(["update-epic", "shipped", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err,
    "the engine classifies nothing and appends exactly what it is handed — so the obligation " +
    "pm emits has to state the exclusion, and 15.4 is where it does");
});

// ─────────────── the interactive archive verb names how the work ended ───────────────

test("archiving with no --outcome is refused, naming the permitted outcomes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "cc-epic", "--status", "archived"], { cwd }));
  assert.ok(err, "an epic that ends without saying how is the silence this release removes");
  const msg = String(err.stderr || err.message);
  for (const o of ["delivered", "killed", "superseded", "abandoned"]) assert.match(msg, new RegExp(o));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("the agent cannot choose `unknown` — it records that nobody was asked", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(
    ["update-epic", "cc-epic", "--status", "archived", "--outcome", "unknown", "--no-deferrals"], { cwd }));
  assert.ok(err, "running the verb means somebody was asked");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  assert.equal(readState(cwd).epics.find(e => e.id === "cc-epic").status, "queued");
});

test("a non-delivered outcome without a reason is refused, and delivered needs none", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  assert.ok(expectFail(() => run(
    ["update-epic", "cc-epic", "--status", "archived", "--outcome", "killed", "--reason", "   ", "--no-deferrals"], { cwd })),
    "whitespace is not a reason");
  run(["update-epic", "cc-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const d = readState(cwd).epics.find(e => e.id === "cc-epic").disposition;
  assert.equal(d.outcome, "delivered");
  assert.equal(d.recordedBy, undefined,
    "an agent's record carries no recordedBy — that field is what tells an engine stamp from " +
    "a judgment, and it is the only thing that does");
});

test("a change killed at Gate 1 with 47 unticked tasks archives with no Gate 2 demanded", () => {
  // The release's flagship case. Demanding a verdict here would make a killed change
  // recordable only by fabricating a review that never happened — one of the two failures
  // this release exists to end.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "killed-at-gate-1",
    Array.from({ length: 47 }, (_, i) => `- [ ] ${i + 1}.1 Task ${i + 1}`));
  run(["add-epic", "--id", "killed-at-gate-1", "--lane", "openspec"], { cwd });
  run(["update-epic", "killed-at-gate-1", "--status", "archived", "--outcome", "killed", "--no-deferrals",
    "--reason", "Gate 1 found the check would invert stop-loss safety on the autonomous exit path"], { cwd });

  const e = readState(cwd).epics.find(x => x.id === "killed-at-gate-1");
  assert.equal(e.status, "archived");
  assert.match(e.disposition.reason, /invert stop-loss safety/,
    "the reason must be readable without opening the commit that deleted the spec files");
  assert.equal(e.gateReview, undefined, "no verdict is demanded, and none is invented");
});

test("a DELIVERED archive of the same epic is still refused without a passing Gate 2", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "shipped-maybe", ["- [x] 1.1 Done"]);
  run(["add-epic", "--id", "shipped-maybe", "--lane", "openspec"], { cwd });
  const err = expectFail(() => run(
    ["update-epic", "shipped-maybe", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "binding the Gate 2 demand to `delivered` must not remove it from `delivered`");
  assert.match(String(err.stderr || err.message), /Gate 2/);
});

// ─────────────── the replacement rule ───────────────

/** An archived epic carrying an engine stamp, the shape every non-interactive path leaves. */
function archivedWithStamp(cwd, recordedBy) {
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{
      id: "healed", title: "Healed from disk", priority: "P1",
      status: "archived", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false,
      disposition: { outcome: "unknown", recordedAt: "2026-08-01T09:00:00.000Z", recordedBy },
    }],
  });
}

test("an agent's disposition REPLACES an engine stamp and leaves no recordedBy behind", () => {
  for (const token of ["archive-drift-heal", "migration"]) {
    const cwd = tmpRepo();
    run(["init"], { cwd });
    archivedWithStamp(cwd, token);
    run(["update-epic", "healed", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
    const d = readState(cwd).epics.find(e => e.id === "healed").disposition;
    assert.equal(d.outcome, "delivered", `${token} stamp must be replaceable`);
    assert.equal(d.recordedBy, undefined,
      "the replacing record carries no recordedBy, so a record replaced once is not " +
      "replaceable again by this rule");
  }
});

test("an agent-supplied disposition is REFUSED, naming what it collided with", () => {
  // The opposite direction from the heal's and the migration's never-overwrite rules, and it
  // must not be generalized from them: this is a judgment somebody made.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{
      id: "judged", title: "Already judged", priority: "P1",
      status: "archived", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false,
      disposition: { outcome: "killed", reason: "not worth it", recordedAt: "2026-08-02T10:00:00.000Z" },
    }],
  });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(
    ["update-epic", "judged", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err);
  const msg = String(err.stderr || err.message);
  assert.match(msg, /killed/, "the refusal names the recorded outcome");
  assert.match(msg, /2026-08-02/, "and when it was recorded");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

// ─────────────── the deferral assertion ───────────────

test("the refusal names the MISSING ASSERTION and lists no deferrals of its own", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "has-deferrals", [
    "- [x] 1.1 Done",
    "- [ ] 1.2 OUT OF SCOPE HERE: the identical fix in the second code path",
  ]);
  run(["add-epic", "--id", "has-deferrals", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(
    ["update-epic", "has-deferrals", "--status", "archived", "--outcome", "killed",
     "--reason", "superseded by a wider change"], { cwd }));
  assert.ok(err);
  const msg = String(err.stderr || err.message);
  assert.match(msg, /deferral assertion/i, "the refusal is about the missing assertion");
  assert.doesNotMatch(msg, /second code path/,
    "naming specific deferrals would require the prose scanner this design rules out, and " +
    "would make the message a guess");
});

test("asserting `none` satisfies the gate and reads back as the agent's answer", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "clean", "--lane", "claude-code"], { cwd });
  run(["update-epic", "clean", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const a = readState(cwd).epics.find(e => e.id === "clean").deferralAssertion;
  assert.deepEqual(a.deferrals, []);
  assert.deepEqual(a.declined, []);
  assert.ok(a.assertedAt,
    "an assertion of `none` must be distinguishable from never having looked");
});

test("no module under scripts/lib/ reads a change's artifacts to identify deferrals", () => {
  const libDir = path.join(REPO, "scripts", "lib");
  const offenders = [];
  for (const name of fs.readdirSync(libDir).filter(f => f.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(libDir, name), "utf8");
    src.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (!/defer/i.test(line)) return;
      if (/readFileSync|readdirSync|proposal|design\.md|tasks\.md/.test(line)) {
        offenders.push(`${name}:${i + 1}: ${t}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    "identification is the agent's job; a scanner that missed a deferral would make the guard " +
    "less trustworthy than no guard at all");
});

// ─────────────── the handoff ───────────────

/** A superpowers-lane plan file — a progress source that is read for a NON-openspec epic, so
 *  the handoff demand can be exercised without the Gate 2 demand firing at the same time. */
function withPlan(cwd, id, lines) {
  const dir = path.join(cwd, "docs", "superpowers", "plans");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), `# ${id}\n\n` + lines.join("\n") + "\n");
  return path.join("docs", "superpowers", "plans", `${id}.md`);
}


test("a delivered archive with outstanding work names BOTH remedies and the same count", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = withPlan(cwd, "remainder", [
    ...Array.from({ length: 78 }, (_, i) => `- [x] ${i + 1}.1 Done`),
    "- [ ] 79.1 Not done",
    "- [ ] 80.1 Not done either",
    "- [ ] 81.1 Nor this",
  ]);
  run(["add-epic", "--id", "remainder", "--lane", "superpowers", "--plan", plan], { cwd });
  run(["add-epic", "--id", "inheritor", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(
    ["update-epic", "remainder", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err);
  const msg = String(err.stderr || err.message);
  assert.match(msg, /3 of 78\/81/, "the refusal states the same count the record renders");
  assert.match(msg, /--carried-to/, "remedy one: say where the work went");
  assert.ok(msg.includes(MARKER),
    "remedy two, quoted as the literal token: declare the item as lifecycle bookkeeping. A " +
    "refusal naming only the handoff steers an agent into inventing a receiver for work " +
    "nobody carried anywhere");
});

test("recording where the work went lets the archive through", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = withPlan(cwd, "remainder", ["- [x] 1.1 Done", "- [ ] 1.2 Moved"]);
  run(["add-epic", "--id", "remainder", "--lane", "superpowers", "--plan", plan], { cwd });
  run(["add-epic", "--id", "inheritor", "--lane", "claude-code"], { cwd });
  run(["update-epic", "remainder", "--status", "archived", "--outcome", "delivered",
    "--no-deferrals", "--carried-to", "inheritor"], { cwd });
  const d = readState(cwd).epics.find(e => e.id === "remainder").disposition;
  assert.equal(d.carriedTo, "inheritor");
});

test("a fully delivered change whose only unticked item is MARKED needs no handoff", () => {
  // The guard's own success case. Counting raw checkboxes here would refuse every correctly
  // finished change in the repository, since the archive instruction is unticked by
  // construction at the moment the archive runs.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = withPlan(cwd, "finished", [
    "- [x] 1.1 Done",
    `- [ ] 1.2 ${MARKER} Run /opsx:archive on this change`,
  ]);
  run(["add-epic", "--id", "finished", "--lane", "superpowers", "--plan", plan], { cwd });
  run(["update-epic", "finished", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "finished").status, "archived");
});

test("a killed epic with every task outstanding is asked for no handoff", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = withPlan(cwd, "killed-whole",
    Array.from({ length: 47 }, (_, i) => `- [ ] ${i + 1}.1 Never written`));
  run(["add-epic", "--id", "killed-whole", "--lane", "superpowers", "--plan", plan], { cwd });
  run(["update-epic", "killed-whole", "--status", "archived", "--outcome", "killed",
    "--reason", "dropped at Gate 1, no code written", "--no-deferrals"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "killed-whole");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.carriedTo, undefined,
    "the recorded reason already accounts for where the work went: nowhere, and why");
});

// ─────────────── the archive-drift heal writes ONE record ───────────────
//
// The rules bind the FUNCTION, not any list of entry points: `reconcileArchived()` is reached
// from `upgrade` (migrations.mjs), `render` (twice), the commit nudge (twice) and `sync`. Two
// of those are interactive verbs an agent typed, so "nobody is present" is false and is not the
// trigger — the trigger is that no disposition is supplied at the transition, which is true at
// every one of them.

/** Put an ARCHIVED change on disk for `id`, with an epic that has not been healed yet. */
function unhealed(cwd, id, lane) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `2026-08-01-${id}`), { recursive: true });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{ id, title: id, priority: "P1", status: "queued", role: "epic",
      links: [], reconcileNeeded: false, ...(lane === undefined ? {} : { lane }) }],
  });
}

for (const [label, invoke] of [
  ["render", (cwd) => run(["render"], { cwd })],
  ["sync", (cwd) => run(["sync"], { cwd })],
  ["upgrade", (cwd) => run(["upgrade"], { cwd })],
  ["commit-nudge", (cwd) => run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) })],
]) {
  test(`the heal writes an identical record from the ${label} call site`, () => {
    const cwd = tmpRepo();
    run(["init"], { cwd });
    unhealed(cwd, "healed-here", "openspec");
    invoke(cwd);
    const e = readState(cwd).epics.find(x => x.id === "healed-here");
    assert.equal(e.status, "archived");
    assert.equal(e.disposition.outcome, "unknown");
    assert.equal(e.disposition.recordedBy, "archive-drift-heal",
      "recordedBy is a FIELD — a consumer must never parse a path name out of a free-text reason");
    assert.ok(e.disposition.recordedAt);
    assert.equal(e.gateReview.gate2.verdict, "ungated");
    assert.equal(e.gateReview.gate2.recordedBy, "archive-drift-heal");
    assert.equal(e.gateReview.gate2.reviewer, undefined,
      "`reviewer` carries an identity; an audit over reviewers must not collect path names");
  });
}

test("a healed superpowers-lane epic gets the disposition and NO ungated condition", () => {
  // `record-gate-review` refuses a verdict to any non-openspec lane, so an `ungated` entry
  // there would be a standing condition with no clearing path in the engine at all — and the
  // lanes this function reaches most are not openspec.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  unhealed(cwd, "healed-sp", "superpowers");
  run(["render"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "healed-sp");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.recordedBy, "archive-drift-heal", "the disposition half binds every lane");
  assert.equal(e.gateReview, undefined, "the bypass half binds openspec-lane epics only");
});

test("a healed LANE-LESS epic DOES receive the bypass half", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  unhealed(cwd, "healed-nolane", undefined);
  run(["render"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "healed-nolane");
  assert.equal(e.gateReview.gate2.verdict, "ungated",
    "a lane-less epic renders as openspec-lane everywhere, so a strict test here would deny " +
    "it the record its own rendering says it owes");
});

test("an existing gate2 verdict is never overwritten by the heal", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-08-01-reviewed"), { recursive: true });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{ id: "reviewed", title: "reviewed", priority: "P1", status: "queued", role: "epic",
      lane: "openspec", links: [], reconcileNeeded: false,
      gateReview: { gate2: { verdict: "pass", reviewedAt: "2026-07-01T00:00:00.000Z", baseSha: "aaa1111", headSha: "bbb2222" } } }],
  });
  run(["render"], { cwd });
  const g = readState(cwd).epics.find(x => x.id === "reviewed").gateReview.gate2;
  assert.equal(g.verdict, "pass", "the heal reflects disk; it does not overwrite a real review");
  assert.equal(g.headSha, "bbb2222");
});

// ─────────────── the two archived-at-creation paths ───────────────

test("add-epic --status archived stamps its own token and writes no gate2", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "born-archived", "--lane", "openspec", "--status", "archived"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "born-archived");
  assert.equal(e.disposition.outcome, "unknown");
  assert.equal(e.disposition.recordedBy, "add-epic");
  assert.equal(e.gateReview, undefined,
    "an ungated entry here would be a permanent standing condition clearable only by a real " +
    "Gate 2 review of work that finished before the epic existed");
});

test("an add-many batch entry at archived stamps ITS token, so neither rule hides in the other", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-many", "--from", writeBatch(cwd, { epics: [
    { id: "batch-archived", lane: "openspec", status: "archived" },
    { id: "batch-queued", lane: "openspec" },
  ] })], { cwd });
  const st = readState(cwd);
  assert.equal(st.epics.find(x => x.id === "batch-archived").disposition.recordedBy, "add-many");
  assert.equal(st.epics.find(x => x.id === "batch-queued").disposition, undefined,
    "creation at any other status writes no disposition at all — nothing has ended, and " +
    "`unknown` would assert a terminal disposition for work that has not terminated");
});

test("a backfill registering THROUGH a creation path keeps the backfill's token", async () => {
  // Every rule elsewhere that exempts historical registrations keys on this token, so a record
  // carrying the inner creation token would defeat those exemptions.
  const { creationStamp } = await import(new URL("../lib/disposition.mjs", import.meta.url).href);
  assert.equal(creationStamp("add-epic", { via: "archive-backfill" }).recordedBy, "archive-backfill");
  assert.equal(creationStamp("add-many", { via: "archive-backfill" }).recordedBy, "archive-backfill");
  assert.equal(creationStamp("add-epic").recordedBy, "add-epic");
});

test("no flag on any command writes recordedBy", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  assert.deepEqual(EPIC_FLAGS.filter(f => f.key === "recordedBy"), [],
    "recordedBy is what tells an engine stamp from an agent's judgment; an agent-writable " +
    "path for it would collapse the distinction every exemption in this release keys on");
});

// ─────────────── the verb accepts an epic that is already archived ───────────────

test("the documented sequence ends with the real disposition recorded", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withTasks(cwd, "shipped-properly", ["- [x] 1.1 Done"]);
  run(["add-epic", "--id", "shipped-properly", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "shipped-properly", "--gate", "2", "--verdict", "pass",
    "--base-sha", "aaa1111", "--head-sha", "bbb2222", "--reviewer", "fresh-context reviewer"], { cwd });

  // /opsx:archive moves the change directory on disk...
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec", "changes", "shipped-properly"),
    path.join(cwd, "openspec", "changes", "archive", "2026-08-24-shipped-properly"));
  // ...the heal observes it and flips the status, stamping `unknown` because nobody was asked.
  run(["render"], { cwd });
  const healed = readState(cwd).epics.find(e => e.id === "shipped-properly");
  assert.equal(healed.status, "archived");
  assert.equal(healed.disposition.recordedBy, "archive-drift-heal");
  assert.equal(healed.gateReview.gate2.verdict, "pass", "the real verdict survives the heal");

  // ...and the agent records the real disposition on the already-archived epic.
  run(["update-epic", "shipped-properly", "--status", "archived", "--outcome", "delivered",
    "--no-deferrals"], { cwd });
  const done = readState(cwd).epics.find(e => e.id === "shipped-properly");
  assert.equal(done.disposition.outcome, "delivered",
    "a verb that refused this call would leave EVERY openspec epic following the documented " +
    "workflow at `unknown` — the defect this release exists to close");
  assert.equal(done.disposition.recordedBy, undefined);
  assert.equal(done.gateReview.gate2.verdict, "pass");
  assert.doesNotMatch(JSON.stringify(done.gateReview), /ungated/,
    "no ungated standing condition anywhere in gateReview");
});

test("accepting an already-archived epic is not waiving the gate", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{ id: "healed-ungated", title: "x", priority: "P1", status: "archived", role: "epic",
      lane: "openspec", links: [], reconcileNeeded: false,
      disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "archive-drift-heal" },
      gateReview: { gate2: { verdict: "ungated", reviewedAt: "2026-08-01T00:00:00.000Z", recordedBy: "archive-drift-heal" } } }],
  });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "healed-ungated", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "refused exactly as a first-time archive would be");
  assert.match(String(err.stderr || err.message), /Gate 2/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

// ─────────────── the four exempt paths ───────────────

test("the heal archives an epic with 12 unticked tasks, counts intact, no refusal", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = withPlan(cwd, "abandoned-long-ago",
    Array.from({ length: 12 }, (_, i) => `- [ ] ${i + 1}.1 Never finished`));
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-abandoned-long-ago"), { recursive: true });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{ id: "abandoned-long-ago", title: "x", priority: "P2", status: "queued", role: "epic",
      lane: "superpowers", planPath: plan, links: [], reconcileNeeded: false }],
  });
  run(["render"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "abandoned-long-ago");
  assert.equal(e.status, "archived", "the heal reflects disk; refusing would make the record lie");
  assert.equal(e.disposition.recordedBy, "archive-drift-heal");
  assert.equal(e.deferralAssertion, undefined, "no deferral assertion is demanded of it");
  assert.equal(e.disposition.carriedTo, undefined, "and no handoff — nobody named a receiver");
  assert.match(projectMd(cwd), /0\/12/, "its unticked counts survive as the evidence they are");
});

test("both archived-at-creation paths succeed with no outcome, no assertion, no handoff", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "created-archived", "--lane", "openspec", "--status", "archived"], { cwd });
  run(["add-many", "--from", writeBatch(cwd, { epics: [{ id: "batch-archived", lane: "openspec", status: "archived" }] })], { cwd });
  const st = readState(cwd);
  for (const id of ["created-archived", "batch-archived"]) {
    const e = st.epics.find(x => x.id === id);
    assert.equal(e.status, "archived");
    assert.equal(e.deferralAssertion, undefined);
    assert.equal(e.disposition.outcome, "unknown");
  }
});

// ─────────────── the outcome invariant, over the whole epic list ───────────────

test("after an upgrade, every archived epic carries a disposition RECORD, not a reader default", () => {
  // Asserting the RECORD is the point. `outcomeOf({})` returns "unknown", so an assertion that
  // the reader is non-null would be satisfied with every stamp in this release deleted — which
  // is exactly the check that measures nothing.
  //
  // The fixture is the ordering case: `migrations.mjs` runs the MIGRATIONS loop, THEN the heal,
  // THEN stamps pmVersion. An epic the heal flips during that run is archived after the
  // migration has already walked the list, and the migration never replays.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-08-01-healed-during-upgrade"), { recursive: true });
  writeState(cwd, {
    version: 1, pmVersion: "0.26.0", active: null, detourStack: [],
    epics: [
      { id: "healed-during-upgrade", title: "x", priority: "P1", status: "queued", role: "epic",
        lane: "openspec", links: [], reconcileNeeded: false },
      { id: "created-archived", title: "y", priority: "P2", status: "archived", role: "epic",
        lane: "claude-code", links: [], reconcileNeeded: false,
        disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "add-epic" } },
      { id: "judged", title: "z", priority: "P2", status: "archived", role: "epic",
        lane: "claude-code", links: [], reconcileNeeded: false,
        disposition: { outcome: "killed", reason: "not worth it", recordedAt: "2026-08-02T00:00:00.000Z" } },
    ],
  });
  run(["upgrade"], { cwd });

  const { ENGINE_STAMP_TOKENS } = { ENGINE_STAMP_TOKENS: ["archive-drift-heal", "archive-backfill", "add-epic", "add-many", "migration"] };
  const archived = readState(cwd).epics.filter(e => e.status === "archived");
  assert.ok(archived.length >= 3);
  for (const e of archived) {
    // (a) the record itself
    assert.equal(typeof e.disposition, "object", `${e.id} carries no disposition OBJECT`);
    assert.ok(e.disposition && e.disposition.outcome != null, `${e.id} has no outcome`);
    assert.ok(e.disposition.recordedAt, `${e.id} has no recordedAt`);
    // (b) engine-stamped and agent-supplied are distinguishable without prose
    if ("recordedBy" in e.disposition) {
      assert.ok(ENGINE_STAMP_TOKENS.includes(e.disposition.recordedBy),
        `${e.id} carries a recordedBy outside the fixed five`);
    }
  }
  // (c) the heal-flipped epic names the heal specifically
  const healed = archived.find(e => e.id === "healed-during-upgrade");
  assert.equal(healed.disposition.recordedBy, "archive-drift-heal",
    "without the heal's own stamp this epic is archived after the migration walked the list " +
    "and is never revisited, because the version stamp now says the migration ran");
  assert.equal(archived.find(e => e.id === "judged").disposition.recordedBy, undefined,
    "an agent's judgment stays distinguishable from an engine stamp");
});

// ─────────────── staleness renders wherever a verdict is displayed ───────────────

test("a stale verdict and a fresh one render differently on BOTH surfaces", () => {
  for (const [reviewedUpTo, expectStale] of [[({ first }) => first, true], [({ second }) => second, false]]) {
    const { cwd } = stalenessFixture({ attribute: ({ first, second }) => [first, second], reviewedUpTo });
    run(["render"], { cwd });
    const md = projectMd(cwd);
    const brief = parseBrief(cwd);
    for (const [surface, text] of [["PROJECT.md", md], ["the brief", brief]]) {
      assert.equal(/⚠ stale/.test(text), expectStale,
        `${surface} must mark a verdict stale iff it is — a refusal and a rendering that can ` +
        "disagree about the same verdict is the divergence the shared predicate prevents");
    }
  }
});

test("the three no-attribution states each archive successfully and each render differently", () => {
  // Collapsing any two of them into one branch fails two of these three assertions.
  const seen = new Set();
  const cases = [
    ["absent", (e) => { delete e.attributedCommits; }],
    ["empty", (e) => { e.attributedCommits = []; }],
  ];
  for (const [label, mutate] of cases) {
    const cwd = tmpRepo();
    run(["init"], { cwd });
    const epic = {
      id: "no-attr", title: "x", priority: "P1", status: "queued", role: "epic",
      lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [],
      gateReview: { gate2: { verdict: "pass", reviewedAt: "2026-08-01T00:00:00.000Z", baseSha: "aaa1111", headSha: "bbb2222" } },
    };
    mutate(epic);
    writeState(cwd, { version: 1, active: null, detourStack: [], epics: [epic] });
    run(["update-epic", "no-attr", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
    assert.equal(readState(cwd).epics[0].status, "archived", `${label} must not be refused`);
    const line = projectMd(cwd).split("\n").find(l => l.includes("bbb2222"));
    assert.ok(line, `${label}: the verdict must render at all`);
    seen.add(line.replace(/\s+/g, " "));
  }
  // Plus the git-unavailable case: a repository with no git history at all.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [{
    id: "no-git", title: "x", priority: "P1", status: "queued", role: "epic", lane: "openspec",
    links: [], reconcileNeeded: false, attributedCommits: ["deadbee"],
    gateReview: { gate2: { verdict: "pass", reviewedAt: "2026-08-01T00:00:00.000Z", baseSha: "aaa1111", headSha: "bbb2222" } },
  }] });
  run(["update-epic", "no-git", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics[0].status, "archived",
    "where git cannot answer, the verdict is unverifiable and the archive is not refused on " +
    "staleness grounds — reporting that as `not stale` would claim a check that never ran");
  assert.match(projectMd(cwd), /⚠ unverifiable/);
  assert.equal(seen.size, 2,
    "an absent array (unverifiable) and an empty one (nothing attributed) are different claims " +
    "and must not collapse into one rendering");
});

// ─────────────── the handoff renders on both ends ───────────────

test("both the archiving epic and the receiving epic show the relationship", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = withPlan(cwd, "carrier", ["- [x] 1.1 Done", "- [ ] 1.2 Moved on"]);
  run(["add-epic", "--id", "carrier", "--lane", "superpowers", "--plan", plan], { cwd });
  run(["add-epic", "--id", "inheritor", "--lane", "claude-code"], { cwd });
  run(["update-epic", "carrier", "--status", "archived", "--outcome", "delivered",
    "--no-deferrals", "--carried-to", "inheritor", "--reason", "task 1.2 moved to inheritor"], { cwd });

  const rows = projectMd(cwd).split("\n");
  const carrierRow = rows.find(l => l.includes("`carrier`"));
  const inheritorRow = rows.find(l => l.includes("`inheritor`"));
  assert.match(carrierRow, /carried-to→inheritor/, "the archiving epic shows it carried work out");
  assert.match(inheritorRow, /carried-from←carrier/, "the receiving epic shows what it inherited");

  const brief = parseBrief(cwd);
  assert.match(brief, /`carrier` carried work to `inheritor`/);
  assert.match(brief, /`inheritor` inherited it from `carrier`/);
});

// ─────────── every creation path carries the array — derived, never enumerated ───────────
//
// The check this replaced named `add-epic` and `add-many` in its own title ("on both creation
// paths") while `sync` had two more that carried nothing. An enumeration transcribed into a test
// goes stale the moment a caller is added — docs/lessons/bind-rules-to-functions-not-enumerations
// — so the rule is bound to the FUNCTION every creation path must route through, and the
// enumeration is derived from the source at check time.

test("no module creates an epic except through pushEpic() — the sink the rule is bound to", () => {
  const libDir = path.join(REPO, "scripts", "lib");
  const offenders = [];
  for (const name of fs.readdirSync(libDir).filter(n => n.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(libDir, name), "utf8");
    const lines = src.split("\n");
    // state.mjs is the helper's HOME, not an exemption — a sixth creation path added there is
    // the likeliest place to put one, so the push is allowed on exactly the line inside
    // pushEpic() and flagged anywhere else in the same file.
    const helperAt = name === "state.mjs"
      ? lines.findIndex(l => l.includes("export function pushEpic("))
      : -1;
    lines.forEach((line, i) => {
      if (!/epics\.push\(/.test(line)) return;
      if (helperAt !== -1 && i > helperAt && i < helperAt + 6) return;
      offenders.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    "a raw `epics.push(...)` bypasses pushEpic() and therefore the attributedCommits " +
    "initialization every creation path owes — route it through pushEpic(state, epic) " +
    `instead (found at: ${offenders.join(", ")})`);
});

test("EVERY creation path yields an epic carrying the array EMPTY — sync's two included", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "born-here", "--lane", "openspec"], { cwd });
  run(["add-many", "--from", writeBatch(cwd, { epics: [{ id: "batch-born", lane: "claude-code" }] })], { cwd });
  // sync's two registration paths: an on-disk OpenSpec change and a Superpowers plan. /pm:sync
  // is the DOMINANT registration path for openspec-lane epics — exactly the lane the Gate 2 and
  // staleness rules bind — so an omission here hides behind the one case the staleness gate is
  // required to forgive.
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "synced-change"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "synced-plan.md"), "# A plan\n");
  run(["sync"], { cwd });

  const st = readState(cwd);
  for (const id of ["born-here", "batch-born", "synced-change", "synced-plan"]) {
    const e = st.epics.find(x => x.id === id);
    assert.ok(e, `${id} must have been registered — the fixture, not the rule, is broken`);
    assert.ok(Object.prototype.hasOwnProperty.call(e, "attributedCommits"),
      `${id} must carry the KEY — a rule applied at some creation sites is the absent-edit ` +
      "class this release exists to close");
    assert.deepEqual(e.attributedCommits, [], `${id} asserts nothing attributed yet`);
  }
});

test("the archive backfill is the ONE creation path that carries no array, deliberately", () => {
  // A backfilled epic genuinely predates commit attribution: absent means unverifiable, and the
  // staleness gate forgives it. Stamping `[]` here would assert "created under this capability,
  // nothing attributed" — false for every one of them.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-06-25-ancient"), { recursive: true });
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "ancient");
  assert.ok(e, "the backfill must have registered the archived change");
  assert.ok(!Object.prototype.hasOwnProperty.call(e, "attributedCommits"),
    "a backfilled epic must remain unverifiable, not assert an empty attribution");
});

// ─────────── record-gate-review's unknown-flag allowlist (#79 at a fifth site) ───────────
//
// `add-epic`, `update-epic`, `add-many` and `release` all reject a flag they do not support.
// `record-gate-review` read its named flags off parseFlags and dropped the rest, so
// `--reviewr "x"` exited 0 and wrote nothing — the silent-no-op failure #79 exists to close,
// at the very command this release ADDED three registry entries for.

/** The flags `record-gate-review`'s usage line names. Read at check time from the source, never
 *  transcribed — a flag a capability forgot to register is absent from the allowlist, so
 *  driving this from the allowlist itself would pass vacuously on the omission it exists to
 *  catch. */
function gateReviewUsageFlags() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "gate-review-writeback.mjs"), "utf8");
  const at = src.indexOf("usage: conductor.mjs record-gate-review");
  assert.notEqual(at, -1, "record-gate-review must still print a usage line — the check reads its flags from it");
  const line = src.slice(at, src.indexOf("process.exit(1)", at));
  return new Set(line.match(FLAG_RE) || []);
}

/** The flags `commands/epic.md` names in record-gate-review's OWN section. */
function gateReviewDocFlags() {
  const doc = fs.readFileSync(path.join(REPO, "commands", "epic.md"), "utf8");
  const start = doc.indexOf("## Record a gate verdict — `record-gate-review`");
  assert.notEqual(start, -1, "commands/epic.md must still document record-gate-review in its own section");
  const next = doc.indexOf("\n## ", start + 1);
  return new Set(doc.slice(start, next === -1 ? doc.length : next).match(FLAG_RE) || []);
}

test("record-gate-review rejects an unsupported flag by name and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "openspec"], { cwd });
  const before = JSON.stringify(readState(cwd));
  const err = expectFail(() => run(
    ["record-gate-review", "subject", "--gate", "2", "--verdict", "fail", "--reviewr", "a typo"], { cwd }));
  assert.ok(err, "a misspelled flag must not exit 0 — a silent no-op is the whole defect");
  assert.match(String(err.stderr), /reviewr/, "the refusal must NAME the offending flag");
  assert.match(String(err.stderr), /--gate/, "the refusal must also name the flags it does support");
  assert.equal(JSON.stringify(readState(cwd)), before, "a refused invocation must write nothing");
});

test("every DOCUMENTED record-gate-review flag is accepted and reads back from state", () => {
  const documented = [...new Set([...gateReviewUsageFlags(), ...gateReviewDocFlags()])].sort();
  assert.ok(documented.length >= 5,
    `the extractors yielded only ${documented.length} flags — the extractor is broken, not the command`);
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "openspec"], { cwd });
  const err = expectFail(() => run(["record-gate-review", "subject",
    "--gate", "2", "--verdict", "pass", "--base-sha", "aaa1111", "--head-sha", "bbb2222",
    "--reviewer", "a fresh-context subagent"], { cwd }));
  assert.equal(err, null,
    `record-gate-review rejected its own documented flags: ${err && String(err.stderr || err.message)}`);
  const g2 = readState(cwd).epics.find(e => e.id === "subject").gateReview.gate2;
  assert.deepEqual(
    { verdict: g2.verdict, baseSha: g2.baseSha, headSha: g2.headSha, reviewer: g2.reviewer },
    { verdict: "pass", baseSha: "aaa1111", headSha: "bbb2222", reviewer: "a fresh-context subagent" });
  // Every documented flag must be one the allowlist knows, or the allowlist would reject the
  // command's own usage line — which is how a rejection added late breaks a working command.
  const missing = documented.filter(f =>
    !["--gate", "--verdict", "--base-sha", "--head-sha", "--reviewer"].includes(f));
  assert.deepEqual(missing, [],
    "record-gate-review documents a flag this check does not exercise — add it to the " +
    "allowlist and to this invocation rather than letting it go unchecked");
});

test("record-gate-review's allowlist is the shared registry's projection, not a second literal", async () => {
  const { epicFlagsFor } = await import(CONSTANTS);
  assert.deepEqual(epicFlagsFor("record-gate-review").sort(),
    ["base-sha", "gate", "head-sha", "reviewer", "verdict"],
    "every flag record-gate-review accepts is declared in EPIC_FLAGS — there is no second, " +
    "parallel allowlist for a subset of them");
});

// ─────────── sha identity: the same commit written at two lengths ───────────
//
// Found by task 16.3 while FOLLOWING this release's own attribution obligation, not by testing it.
// `--attribute-commit` records short shas; `--head-sha` may be given long. A raw `===` calls those
// two different commits, and the check then asks `isAncestor(X, X)` — TRUE, because a commit is
// its own ancestor — and concludes the verdict is stale, refusing the archive over a formatting
// difference.
//
// This asserts the PREDICATE, not the gate's overall verdict: an earlier draft asserted the gate
// did not refuse "with a message matching /stale/", which passed with the fix reverted because the
// gate refused for an unrelated reason first. A weaker assertion that happens to be true is the
// exact defect class this release exists to end.
test("16.3: a headSha naming the last attributed commit at another length reads FRESH", async () => {
  const { gateStaleness } = await import(ARCHIVE_GATE);
  const short = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const long = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.notEqual(short, long, "the fixture needs two spellings of ONE commit");

  const state = gateStaleness(
    { id: "e", lane: "openspec", attributedCommits: [short] },
    { verdict: "pass", baseSha: short, headSha: long, reviewedAt: "2026-08-25T00:00:00.000Z" });

  assert.equal(state.state, "fresh",
    `one commit spelled two ways must read fresh, not ${state.state} — a gate that refuses an ` +
    "archive over sha formatting is worse than no gate");
});
