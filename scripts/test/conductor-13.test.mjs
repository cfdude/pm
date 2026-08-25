import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, writeBatch } from "./helpers.mjs";

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
  "--review-mode": { args: ["--review-mode", "thorough"], check: (e) => assert.equal(e.reviewMode, "thorough") },
  "--description": { args: ["--description", "durable rationale"], check: (e) => assert.equal(e.description, "durable rationale") },
  // A note reads back as an ENTRY, not a string — {at, actor, text}. Asserting on the text
  // alone would pass against an implementation that stored the raw string and lost the trail.
  "--notes": { args: ["--notes", "an activity note"], check: (e) => assert.equal(e.notes.at(-1).text, "an activity note") },
  "--add-story": { args: ["--add-story", "a story"], check: (e) => assert.equal(e.stories.at(-1).title, "a story") },
  // --story and --done are a control PAIR: neither is invocable alone, so both are exercised
  // by the same invocation and each asserts the half it is responsible for.
  "--story": { setup: ["--add-story", "s1"], args: ["--story", "1", "--done"], check: (e) => assert.equal(e.stories[0].done, true) },
  "--done": { setup: ["--add-story", "s1"], args: ["--story", "1", "--done"], check: (e) => assert.equal(e.stories[0].done, true) },
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
  assert.deepEqual([...KNOWN_OUTCOMES].sort(),
    ["abandoned", "delivered", "killed", "superseded", "unknown"]);
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
  assert.equal(dispositionError({ outcome: "delivered" }), null);
  const d = agentDisposition({ outcome: "delivered" });
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
  assert.equal(outcomeOf({ disposition: engineStamp("migration", { outcome: "delivered" }) }), "delivered");
});

test("isEngineStamped is the ONLY way an engine stamp is told from an agent's record", async () => {
  const { ENGINE_STAMP_TOKENS, isEngineStamped, agentDisposition } = await import(DISPOSITION);
  assert.equal(isEngineStamped(agentDisposition({ outcome: "delivered" })), false,
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
  const refused = archiveGate({ id: "spec-epic", lane: "openspec" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Gate 2/,
    "the refusal must name what is missing, and it must be a value the caller can plumb — " +
    "a gate that calls process.exit is unusable from any path that has cleanup to do");
  assert.equal(archiveGate({ id: "spec-epic", lane: "openspec",
    gateReview: { gate2: { verdict: "fail" } } }).ok, false);
  assert.equal(archiveGate({ id: "spec-epic", lane: "openspec",
    gateReview: { gate2: { verdict: "pass" } } }).ok, true);
  assert.equal(archiveGate({ id: "cc-epic", lane: "claude-code" }).ok, true,
    "a non-openspec-lane epic is unaffected");
});

test("the gate is reachable from update-epic, refusal text intact", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = readState(cwd);
  const err = expectFail(() => run(["update-epic", "spec-epic", "--status", "archived"], { cwd }));
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
  const err = expectFail(() => run(["update-epic", "no-lane", "--status", "archived"], { cwd }));
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
