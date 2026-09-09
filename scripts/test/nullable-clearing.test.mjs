// scripts/test/nullable-clearing.test.mjs
// 0.40.0 — declared nullability, the uniform clearing form, `--link` as an APPEND, and the
// no-op reporting rule that binds the whole write surface.
//
// The sweeps here are driven from `EPIC_FLAGS` and never from a list typed into this file. That
// is the point of declaring nullability in the registry at all: a field that gains
// `nullable: true` with no clearing path has to FAIL here, and a list transcribed into a test
// would simply not mention it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run, tmpRepo, readState, expectFail, writeBatch, ENGINE, EMPTY_CACHE } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const SOURCE_ARTIFACTS = new URL("../lib/source-artifacts.mjs", import.meta.url).href;
const LINKS = new URL("../lib/links.mjs", import.meta.url).href;

/** stdout+stderr of an invocation that MUST succeed. Local rather than helpers' `runCombined()`
 *  because that one ignores the exit code, and a crash would then read as "no such message" —
 *  a test that passes for the wrong reason on exactly the assertions below. */
function combined(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  assert.equal(r.status, 0, `expected success: ${r.stderr}`);
  return (r.stdout || "") + (r.stderr || "");
}

/** A repo with two epics: `subject` (the one under test) and `other` (a real target for
 *  `--parent` and `--link`, both of which validate against the known epic ids). */
function repo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "claude-code"], { cwd });
  return cwd;
}
const epicOf = (cwd, id = "subject") => readState(cwd).epics.find(e => e.id === id);

/** How to SET each nullable field, so the sweep can clear something that is actually there.
 *  A value table is unavoidable — `--parent` needs a real epic id, `--review-mode` a legal mode
 *  that does not de-escalate below the repo dial — but the ENUMERATION driving it is the
 *  registry, so a nullable row with no entry here is a hard failure naming the flag rather than
 *  a silent skip. */
const SET_VALUE = {
  parent: "other",
  "review-mode": "thorough",
  "external-updated-at": "2026-08-23T09:30:00Z",
  plan: "docs/superpowers/plans/p.md",
  spec: "docs/superpowers/specs/d.md",
};
const setArgs = (flag) => ["--" + flag, SET_VALUE[flag] || `value-for-${flag}`];

// ───────────────────────── 5.2(a) — every nullable row is REACHABLE ─────────────────────────

test("every EPIC_FLAGS row declared nullable is reachable by `update-epic --clear <flag>`", async () => {
  const { nullableEpicFlags } = await import(CONSTANTS);
  const rows = nullableEpicFlags("update-epic");
  assert.ok(rows.length >= 5,
    `the registry yielded only ${rows.length} nullable rows — the projection is broken, not the registry`);

  for (const row of rows) {
    const cwd = repo();
    // SETTING FIRST IS LOAD-BEARING. A freshly created epic already lacks every one of these
    // fields, so a clear asserted against a fresh epic passes against an implementation that
    // does nothing at all — the trap conductor-13's `--clear-links` row documents.
    run(["update-epic", "subject", ...setArgs(row.flag)], { cwd });
    assert.ok(row.key in epicOf(cwd),
      `the fixture must actually set ${row.key} before the clear proves anything`);

    const err = expectFail(() => run(["update-epic", "subject", "--clear", row.flag], { cwd }));
    assert.equal(err, null,
      `--clear ${row.flag} was rejected, so a declared-nullable field has no clearing path: ` +
      `${err && String(err.stderr || err.message)}`);
    // ABSENT, not falsy: `epic.key = undefined` would satisfy a `=== undefined` assertion and is
    // not what "unset" means — it survives JSON.stringify as a dropped key only by accident.
    assert.ok(!(row.key in epicOf(cwd)),
      `--clear ${row.flag} left '${row.key}' present on the record`);
  }
});

// ───────────── 5.2(b) — every SETTABLE row DECLARES which of the two it is ─────────────

test("every settable update-epic row carries `nullable: true` or a `setOnly` reason", async () => {
  const { settableEpicFlags } = await import(CONSTANTS);
  const rows = settableEpicFlags("update-epic");
  assert.ok(rows.length >= 15,
    `the settable projection yielded only ${rows.length} rows — it is broken, not the registry`);
  const undeclared = rows.filter(r => r.nullable !== true && !r.setOnly).map(r => r.flag);
  assert.deepEqual(undeclared, [],
    "these settable fields declare neither `nullable: true` nor a `setOnly` reason: " +
    `${undeclared.join(", ")}. An UNDECLARED row is the population this requirement is about — ` +
    "silence must not pass. The population is deliberately narrowed to rows update-epic accepts " +
    "that carry a non-null `key` and are not `valueless`; the two EPIC_FLAGS rows outside it are " +
    "`--id` (add-epic/add-many only — identity is not a field an epic can lose) and `--member` " +
    "(`release` only, whose inverse is `release --defer`, recording the exclusion's reason).");
  // And no row claims BOTH, which would make the declaration meaningless.
  const both = rows.filter(r => r.nullable === true && r.setOnly).map(r => r.flag);
  assert.deepEqual(both, [], `these rows declare both markers: ${both.join(", ")}`);
  // Every setOnly reason is a real sentence, not a marker. A reason a reader cannot act on is
  // the prose-in-a-comment this declaration replaced.
  for (const r of rows.filter(x => x.setOnly)) {
    assert.equal(typeof r.setOnly, "string");
    assert.ok(r.setOnly.length > 20, `--${r.flag}'s setOnly reason is too short to be a reason`);
  }
});

test("`links` and `notes` are declared SET-ONLY, each carrying its own reason", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const link = EPIC_FLAGS.find(f => f.flag === "link");
  const notes = EPIC_FLAGS.find(f => f.flag === "notes");
  assert.ok(link.setOnly && /clear-links/.test(link.setOnly),
    "--link's setOnly reason must name --clear-links, the grandfathered form it points at");
  assert.ok(notes.setOnly && /append/i.test(notes.setOnly),
    "--notes' setOnly reason must say it is an append-only trail");
});

// ───────────────────────── 5.3 — FLAG spelling, not state key ─────────────────────────

test("--clear names fields by their FLAG spelling; the state key is refused", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--plan", "docs/superpowers/plans/p.md"], { cwd });
  const err = expectFail(() => run(["update-epic", "subject", "--clear", "planPath"], { cwd }));
  assert.ok(err, "`--clear planPath` names the STATE KEY and must be refused");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /planPath/, "the refusal must name what was passed");
  assert.match(msg, /\bplan\b/, "and point at the flag spelling that works");
  assert.equal(epicOf(cwd).planPath, "docs/superpowers/plans/p.md",
    "a refused clear writes nothing");
});

// ─────────── 5.4 — clearing is surgical, and a non-nullable field is refused ───────────

test("clearing one field leaves every other field on the epic untouched", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--title", "keep me", "--priority", "P1",
       "--plan", "docs/superpowers/plans/p.md", "--spec", "docs/superpowers/specs/d.md",
       "--description", "durable rationale", "--external-id", "JOB-9",
       "--link", "blocks:other:because", "--add-story", "s one"], { cwd });
  run(["update-epic", "subject", "--status", "paused"], { cwd });
  const before = epicOf(cwd);

  run(["update-epic", "subject", "--clear", "plan"], { cwd });
  const after = epicOf(cwd);
  assert.ok(!("planPath" in after), "the named field is gone");
  for (const k of ["title", "priority", "status", "specPath", "description", "externalId", "lane"]) {
    assert.deepEqual(after[k], before[k], `--clear plan changed '${k}'`);
  }
  assert.deepEqual(after.links, before.links);
  assert.deepEqual(after.stories, before.stories);
});

test("--clear on a field that is not declared nullable exits non-zero naming it", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--notes", "an activity note"], { cwd });
  const err = expectFail(() => run(["update-epic", "subject", "--clear", "notes"], { cwd }));
  assert.ok(err, "--notes is set-only and the clear must be refused");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /notes/, "the refusal names the field");
  assert.match(msg, /append/i, "and gives the registry's own reason rather than a generic one");
  assert.equal(epicOf(cwd).notes.length, 1, "nothing was written");
});

test("--clear links is refused BY NAME and points at --clear-links", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--link", "blocks:other:because"], { cwd });
  const err = expectFail(() => run(["update-epic", "subject", "--clear", "link"], { cwd }));
  assert.ok(err, "the generic form must refuse links rather than appear to offer a second way");
  assert.match(String(err.stderr || err.message), /--clear-links/);
  assert.equal(epicOf(cwd).links.length, 1);
});

test("--clear and the flag that SETS the same field in one invocation is refused", () => {
  const cwd = repo();
  const err = expectFail(() => run(["update-epic", "subject",
    "--plan", "docs/superpowers/plans/p.md", "--clear", "plan"], { cwd }));
  assert.ok(err, "setting and clearing one field in one write is contradictory");
  assert.match(String(err.stderr || err.message), /plan/);
});

// ───────────────────────── 5.5 — --link APPENDS ─────────────────────────

test("a second --link is ADDED, not substituted for the first", () => {
  const cwd = repo();
  run(["add-epic", "--id", "third", "--lane", "claude-code"], { cwd });
  run(["update-epic", "subject", "--link", "blocks:other:first reason"], { cwd });
  run(["update-epic", "subject", "--link", "relates-to:third:second reason"], { cwd });
  assert.deepEqual(epicOf(cwd).links, [
    { type: "blocks", epic: "other", reason: "first reason" },
    { type: "relates-to", epic: "third", reason: "second reason" },
  ]);
});

test("re-supplying a link with a corrected reason updates that entry in place", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--link", "blocks:other:the old reason"], { cwd });
  run(["update-epic", "subject", "--link", "blocks:other:the corrected reason"], { cwd });
  assert.deepEqual(epicOf(cwd).links, [
    { type: "blocks", epic: "other", reason: "the corrected reason" },
  ], "identity is type+target; the reason is the part a reader acts on and is not identity");
});

test("a wholly identical link is not a duplicate, and the invocation says nothing changed", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--link", "blocks:other:because"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "subject", "--link", "blocks:other:because"], { cwd }));
  assert.equal(err, null, "a no-op link supply is not an error — the record is correct");
  assert.deepEqual(epicOf(cwd).links, [{ type: "blocks", epic: "other", reason: "because" }]);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "and it must not rewrite state.json for a write that did not happen");
});

test("--clear-links and --link combine as ONE atomic replace", () => {
  const cwd = repo();
  run(["add-epic", "--id", "third", "--lane", "claude-code"], { cwd });
  run(["update-epic", "subject", "--link", "blocks:other:stale"], { cwd });
  const err = expectFail(() => run(["update-epic", "subject", "--clear-links",
    "--link", "depends-on:third:the corrected edge"], { cwd }));
  assert.equal(err, null,
    `the documented repair must be one invocation: ${err && String(err.stderr || err.message)}`);
  assert.deepEqual(epicOf(cwd).links, [
    { type: "depends-on", epic: "third", reason: "the corrected edge" },
  ], "the malformed edge is gone and the corrected one is there, in one write");
});

test("within ONE invocation, a repeated identity takes the LAST reason given", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--link", "blocks:other:first",
       "--link", "blocks:other:second"], { cwd });
  assert.deepEqual(epicOf(cwd).links, [{ type: "blocks", epic: "other", reason: "second" }]);
});

// ───────────── 5.6 — the no-op rule binds the WHOLE surface, not two new paths ─────────────

test("setting a field to the value it already holds reports NOTHING CHANGED, not success", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--title", "same title"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = combined(cwd, ["update-epic", "subject", "--title", "same title"]);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "the save was a no-op, which is what the report has to reflect");
  assert.match(out, /nothing changed/i);
  assert.doesNotMatch(out, /updated 'subject'/,
    "a same-valued --title ALREADY reported a write that did not happen — the #79 defect class");
});

test("the no-op report names the same-valued --status and --priority too, not just the new paths", () => {
  for (const [flag, value] of [["--status", "paused"], ["--priority", "P1"], ["--lane", "superpowers"]]) {
    const cwd = repo();
    run(["update-epic", "subject", flag, value], { cwd });
    const out = combined(cwd, ["update-epic", "subject", flag, value]);
    assert.match(out, /nothing changed/i,
      `a same-valued ${flag} still reported a write that did not happen`);
    assert.doesNotMatch(out, /updated 'subject'/,
      `${flag} claimed "updated" for a save that changed nothing`);
  }
});

test("a no-op CLEAR of an already-absent field exits zero and reports no change", () => {
  const cwd = repo();
  assert.ok(!("planPath" in epicOf(cwd)), "the fixture must start without the field");
  const out = combined(cwd, ["update-epic", "subject", "--clear", "plan"]);
  assert.match(out, /nothing changed/i);
  assert.ok(!("planPath" in epicOf(cwd)));
});

test("a no-op LINK supply exits zero and reports no change", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--link", "blocks:other:because"], { cwd });
  const out = combined(cwd, ["update-epic", "subject", "--link", "blocks:other:because"]);
  assert.match(out, /nothing changed/i);
  assert.doesNotMatch(out, /updated 'subject'/);
});

test("a write that DOES change something still reports 'updated'", () => {
  const cwd = repo();
  const out = combined(cwd, ["update-epic", "subject", "--title", "a new title"]);
  assert.match(out, /updated 'subject'/,
    "the no-op report must not swallow the success line for a real write");
});


// ───────── the link rule binds every write surface the registry names, not one of them ─────────

/** How to supply the SAME link identity twice on each command the `link` row declares. Keyed by
 *  command, so a fourth surface declaring `--link` fails here by name instead of being silently
 *  unexercised — the same shape SET_VALUE above uses, and the reason this is a table rather than
 *  three tests. */
const SUPPLY_DUPLICATE_LINK = {
  "add-epic": (cwd) => {
    run(["add-epic", "--id", "subj", "--lane", "claude-code",
      "--link", "blocks:other:first", "--link", "blocks:other:second"], { cwd });
    return "subj";
  },
  "update-epic": (cwd) => {
    run(["update-epic", "subject", "--link", "blocks:other:first",
      "--link", "blocks:other:second"], { cwd });
    return "subject";
  },
  "add-many": (cwd) => {
    const batch = writeBatch(cwd, { epics: [{ id: "subj", lane: "claude-code", links: [
      { type: "blocks", epic: "other", reason: "first" },
      { type: "blocks", epic: "other", reason: "second" },
    ] }] });
    run(["add-many", "--from", batch], { cwd });
    return "subj";
  },
};

test("supplying one link identity twice records ONE link on EVERY surface the registry declares", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const row = EPIC_FLAGS.find(f => f.flag === "link");
  assert.ok(row && row.commands.length >= 3, "the `link` row must still declare its write surfaces");

  for (const command of row.commands) {
    const supply = SUPPLY_DUPLICATE_LINK[command];
    assert.ok(supply,
      `'${command}' declares --link and this sweep has no way to drive it. The identity rule ` +
      "binds every write surface; a surface nothing exercises is how it came to hold at one of " +
      "three. Add a driver rather than removing the command from the row.");
    const cwd = repo();
    const id = supply(cwd);
    const links = epicOf(cwd, id).links.filter(l => l.type === "blocks" && l.epic === "other");
    assert.equal(links.length, 1,
      `${command} recorded ${links.length} entries for one (type, target) — two relationships of ` +
      "the same type between the same pair of epics are one relationship");
    assert.equal(links[0].reason, "second",
      `${command} kept the FIRST reason — a repeat updates the entry's reason in place, and ` +
      "discarding the supplied one removes the only path to correcting it");
  }
});

test("every surface the registry declares reaches `links` through mergeLinks()", async () => {
  // The inversion, so a fifth surface inherits the rule instead of re-implementing it. Scoped to
  // the three modules the registry names: `detour-stack.mjs` and `reconciler-writeback.mjs` also
  // write links, but as ENGINE PROTOCOL with different semantics on purpose (linkOnce() leaves an
  // existing edge's reason alone), and they are not a user supplying a link.
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const row = EPIC_FLAGS.find(f => f.flag === "link");
  for (const command of row.commands) {
    const src = fs.readFileSync(new URL(`../lib/${command}.mjs`, import.meta.url).pathname, "utf8");
    assert.match(src, /mergeLinks\(/,
      `lib/${command}.mjs declares --link and never calls mergeLinks() — the identity rule is a ` +
      "function every surface calls, not a shape three files are trusted to keep");
  }
});

test("mergeLinks leaves an identical stored link OBJECT in place, which is what makes the no-op report true", async () => {
  const { mergeLinks } = await import(LINKS);
  // Key order deliberately reversed from what parseLinkFlags produces: a stored link migrated by
  // normalizeLink(), or written before `reason` existed, serializes differently. Overwriting it
  // with an equal-VALUED fresh object changes the bytes, so saveState()'s whole-body comparison
  // no longer short-circuits and "a wholly identical link is not a duplicate" stops being true.
  const stored = { reason: "why", epic: "other", type: "blocks" };
  const merged = mergeLinks([stored], [{ type: "blocks", epic: "other", reason: "why" }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0], stored, "the STORED object must survive, not an equal-valued copy");

  // A changed reason DOES replace, in position.
  const two = mergeLinks(
    [{ type: "blocks", epic: "a" }, { type: "relates-to", epic: "b" }],
    [{ type: "blocks", epic: "a", reason: "corrected" }]);
  assert.deepEqual(two, [{ type: "blocks", epic: "a", reason: "corrected" }, { type: "relates-to", epic: "b" }]);

  // And a different type to the same target is a DIFFERENT identity.
  assert.equal(mergeLinks([{ type: "blocks", epic: "a" }], [{ type: "relates-to", epic: "a" }]).length, 2);
});

// ───────── the DATA half of the call-site sweep: a cross-record pointer never leaves quietly ────

test("clearing a field that holds another record's id ANNOUNCES what the removal costs", () => {
  const cwd = repo();
  run(["update-epic", "subject", "--parent", "other"], { cwd });
  const out = combined(cwd, ["update-epic", "subject", "--clear", "parent"]);
  assert.match(out, /cleared `subject`'s parent/);
  assert.match(out, /plan-hierarchy/,
    "the note must name the consequence — the epic leaves the hierarchy batching");
  assert.ok(!("parent" in epicOf(cwd)));

  const cwd2 = repo();
  run(["update-epic", "subject", "--external-url", "https://example.test/9"], { cwd: cwd2 });
  const out2 = combined(cwd2, ["update-epic", "subject", "--clear", "external-url"]);
  assert.match(out2, /dedup key/i,
    "clearing the sync procedure's dedup key means the item can be mirrored again as a new epic");
});

test("`--clear plan` says the artifact is un-claimed, and the next sync proves it", () => {
  // THE Gate 2 reproduction, end to end. `--clear plan` is a third un-claim path alongside
  // `remove-epic` (which tombstones) and never registering the artifact at all — and it shipped
  // with neither a tombstone nor a note, so the duplicate-registration defect
  // source-artifacts.mjs exists to make impossible came back through the clearing surface.
  const cwd = repo();
  const plan = path.join(cwd, "docs", "superpowers", "plans", "2026-09-08-a-plan.md");
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, "# a plan\n");
  run(["update-epic", "subject", "--plan", "docs/superpowers/plans/2026-09-08-a-plan.md"], { cwd });

  const skipped = combined(cwd, ["sync"]);
  assert.match(skipped, /claimed by epic 'subject'/,
    "the fixture must actually reach the claim check, or the clear below proves nothing");

  const cleared = combined(cwd, ["update-epic", "subject", "--clear", "plan"]);
  assert.match(cleared, /cleared `subject`'s plan/);
  assert.match(cleared, /registers the file as a NEW untriaged epic/,
    "the note must name the CONSEQUENCE — the next sync re-registers what this epic stopped claiming");
  assert.match(cleared, /--plan <path>/, "and name the way back");
  assert.match(cleared, /tombstone/i,
    "NOT tombstoning is a decision, and an undocumented decision is indistinguishable from an " +
    "omission — the note says so rather than leaving a reader to reason it out from remove-epic");

  // And the consequence is REAL, not just announced.
  const after = combined(cwd, ["sync"]);
  assert.match(after, /1 new epic/,
    "the un-claimed plan is registered again — which is exactly why the note has to exist");
  assert.equal(readState(cwd).syncIgnore, undefined,
    "no tombstone was written: the epic survives, and clearing may mean `let sync find this " +
    "plan's real owner`");
});

test("a no-op clear announces NOTHING — there was no removal to have a consequence", () => {
  const cwd = repo();
  assert.ok(!("parent" in epicOf(cwd)));
  const out = combined(cwd, ["update-epic", "subject", "--clear", "parent"]);
  assert.doesNotMatch(out, /cleared `subject`'s parent/,
    "announcing a removal that did not happen is noise, and trains a reader to skim past the one that matters");
  assert.match(out, /nothing changed/i);
});

/** THE cross-record population, DERIVED — the half the first version of this test only claimed.
 *
 *  It said "the population is derived from the state key rather than listed" and then wrote
 *  `const CROSS_RECORD = ["parent", "externalUrl"]`, which is the hand-typed enumeration
 *  `constants.mjs` rejects everywhere else. It was wrong the moment it shipped: `--clear plan` and
 *  `--clear spec` un-claim an on-disk source artifact, so the next `sync` registers the file as a
 *  fresh untriaged epic — the duplicate-registration defect `source-artifacts.mjs` exists to make
 *  structurally impossible — and neither row carried a note.
 *
 *  Three sources, each of which exists for its OWN reason and is therefore already maintained:
 *
 *   1. `EPIC_SOURCE_ARTIFACTS` — every field naming an on-disk artifact `sync` dedups against.
 *   2. `epicReferences()` — every place the record holds a live epic id, probed with a SENTINEL
 *      rather than read off the returned `where` string (which is rendered prose, not a key).
 *      A synthetic epic gets `sentinel-<key>` in every nullable key; whichever sentinels come
 *      back as `r.epic` are the epic-id-bearing nullable fields, by construction.
 *   3. `EPIC_DEDUP_KEYS` — the two fields the inward sync dedup compares. `add-epic` reads the
 *      same declaration, so it cannot rot into decoration.
 *
 *  DELIBERATELY OUT: `reviewMode`, which points at a repo-global dial rather than at another
 *  record. It carries a clearNote anyway, as a declared judgement on its row — but demanding one
 *  from THIS sweep would need a fourth source invented for one field, and a population widened to
 *  fit its members stops being derived. */
async function crossRecordKeys() {
  const { nullableEpicFlags, EPIC_DEDUP_KEYS } = await import(CONSTANTS);
  const { EPIC_SOURCE_ARTIFACTS } = await import(SOURCE_ARTIFACTS);
  const { epicReferences } = await import(LINKS);

  const nullable = nullableEpicFlags("update-epic");
  const probe = { id: "probe" };
  for (const row of nullable) probe[row.key] = `sentinel-${row.key}`;
  const held = new Set(epicReferences({ epics: [probe] }).map(r => r.epic));

  const keys = new Set();
  for (const row of nullable) if (held.has(`sentinel-${row.key}`)) keys.add(row.key);
  for (const a of EPIC_SOURCE_ARTIFACTS) keys.add(a.key);
  for (const k of Object.values(EPIC_DEDUP_KEYS)) keys.add(k);
  return keys;
}

test("the cross-record population is DERIVED, and reaches the fields it exists to reach", async () => {
  // The derivation itself, asserted — because a sweep whose population silently narrowed to the
  // empty set passes every assertion below it. Named here as a MINIMUM rather than an equality:
  // this is what the three sources reach today, and a fourth cross-record nullable field must
  // join by being declared in one of them, not by being added to this line.
  const keys = await crossRecordKeys();
  for (const expected of ["parent", "externalUrl", "externalId", "planPath", "specPath"]) {
    assert.ok(keys.has(expected),
      `'${expected}' fell out of the derived cross-record population — one of the three sources ` +
      "stopped covering it, and the sweep below is no longer checking it");
  }
  const { nullableEpicFlags } = await import(CONSTANTS);
  assert.ok(!keys.has("reviewMode"),
    "reviewMode points at a repo dial, not another record — widening the population to include " +
    "it would need a fourth source invented for one field");
  assert.ok(keys.size < nullableEpicFlags("update-epic").length,
    "the population is a SUBSET of the nullable rows; one equal to all of them means the " +
    "derivation collapsed into 'everything' and stopped discriminating");
});

test("every nullable field holding or keying on ANOTHER record carries a clearNote", async () => {
  const { nullableEpicFlags } = await import(CONSTANTS);
  const keys = await crossRecordKeys();
  let checked = 0;
  for (const row of nullableEpicFlags("update-epic")) {
    if (!keys.has(row.key)) continue;
    checked++;
    assert.equal(typeof row.clearNote, "string",
      `--${row.flag} unsets '${row.key}', which points at another record or keys a dedup, and ` +
      "carries no clearNote — the removal would be silent");
    assert.ok(row.clearNote.length > 30, `--${row.flag}'s clearNote is too short to be a consequence`);
  }
  assert.ok(checked >= 5, `only ${checked} cross-record row(s) checked — the population shrank`);
});
