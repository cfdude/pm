import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail, writeBatch } from "./helpers.mjs";

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

test("the registry's update-epic projection is set-equal to 0.26.0's UPDATE_EPIC_FLAGS literal", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("update-epic")).map(f => f.flag);
  assert.deepEqual(
    [...projected].sort(),
    [...UPDATE_EPIC_FLAGS_0_26_0].sort(),
    "seeding EPIC_FLAGS must reproduce 0.26.0's update-epic flag surface exactly — no flag " +
    "gained, none lost");
});

test("the registry's add-epic projection is exactly the flags add-epic parsed in 0.26.0", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // add-epic had no allowlist, so its 0.26.0 surface is the set of flags its body actually
  // read out of parseFlags(): id, lane, status, title, priority, plan, parent, external-id,
  // external-url, link. Everything else parsed, exited 0 and wrote nothing (issue #79).
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("add-epic")).map(f => f.flag);
  assert.deepEqual(
    [...projected].sort(),
    ["external-id", "external-url", "id", "lane", "link", "parent", "plan", "priority", "status", "title"],
  );
});

test("the registry's add-many keys are exactly the state keys add-many copied in 0.26.0", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // add-many.mjs:61-70's fixed key copy, verbatim. A batch document is written in STATE keys
  // (externalId), not flag names (external-id), which is why the registry carries `key`
  // explicitly rather than deriving it from `flag`.
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("add-many") && f.key).map(f => f.key);
  assert.deepEqual(
    [...projected].sort(),
    ["externalId", "externalUrl", "id", "lane", "links", "parent", "planPath", "priority", "status", "title"],
  );
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
      planPath: "docs/superpowers/plans/x.md", links: [],
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
