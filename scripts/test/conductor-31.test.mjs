// gh-152 / gh-151 — a rule that stops where the engine stops.
//
// #152: 0.34.0 made a valueless value-bearing flag a refusal across the six write surfaces
// `EPIC_FLAGS` declares. `valueBearingFlagsFor()` returned `[]` for every OTHER command, so the
// guard silently no-op'd on a dozen more verbs — and two of them (`triage --limit`,
// `verify-specs --root`) had each INVENTED the same answer by hand, independently. That is the
// enumeration-goes-stale shape (docs/lessons/bind-rules-to-functions-not-enumerations.md): the
// rule was bound to a LIST rather than to the function it governs.
//
// The fix declares a sibling table, `VERB_FLAGS`, for the verbs whose flags are not an epic
// write surface, and makes `valueBearingFlagsFor()` read the UNION. The rename of `EPIC_FLAGS`
// was DECLINED — its name and each of its projections (`epicFlagsFor`, `epicBatchKeys`,
// `epicFlagCommands`) mean "the epic write surface", and renaming it would have touched ~20
// consumers for a word.
//
// #151: the substantial-detour PUSH was a documented hand-edit of `.conductor/state.json`
// (commands/detour.md step 2) — the state of record's most consequential transition performed
// by the one mechanism this project tells every agent never to use. POP was the SAME hand-edit
// (commands/resume.md step 2): `record-reconcile` writes a verdict and clears `reconcileNeeded`,
// and nothing anywhere removed a frame. `push-detour` and `pop-detour` are the verbs.
//
// THE TEST THAT MATTERS is `dispatchedVerbs()` below: the surface list is derived from
// conductor.mjs's own dispatch object, so a verb added later cannot quietly opt out of the flag
// rule the way these dozen did. Deriving it from the REGISTRY instead — which is what
// conductor-30 does — is exactly the blind spot: a verb with flags and no row is invisible to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, readState, expectFail } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const stateOf = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

/** The verb names the engine actually dispatches, read from conductor.mjs's dispatch object.
 *
 *  DUPLICATED from conductor-25.test.mjs, where the identical reader feeds the VERB_EFFECTS
 *  completeness check. Deliberately duplicated rather than extracted: the reader is nine lines,
 *  and hoisting it into helpers.mjs would edit a file every other test module imports for no
 *  behavioural gain. Both copies assert the same two structural markers, so a change to the
 *  dispatch table's shape fails loudly in both places rather than silently in neither. */
function dispatchedVerbs() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const start = src.indexOf("// ---------- dispatch ----------");
  assert.notEqual(start, -1, "conductor.mjs must still carry its dispatch marker comment");
  const body = src.slice(src.indexOf("({", src.indexOf("try {", start)));
  const end = body.indexOf("}[cmd]");
  assert.notEqual(end, -1, "the dispatch object must still be indexed as `}[cmd]`");
  const table = body.slice(0, end);
  const verbs = new Set();
  for (const m of table.matchAll(/^ {2}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

// ═══════════════ #152: the flag-value rule, bound to the dispatch table ═══════════════

/** A minimal invocation of each VERB_FLAGS command that EXITS 0 on the fixture below, so that
 *  appending one valueless flag and seeing a non-zero exit is attributable to THAT flag and to
 *  nothing else. Same discipline as conductor-30's BASELINE, and the completeness test below
 *  asserts this table covers every command `VERB_FLAGS` names — so declaring a flag on a new
 *  verb without a baseline here fails loudly instead of going unswept. */
const VERB_BASELINE = {
  "add-many": (cwd) => ["add-many", "--from", batchFile(cwd)],
  changelog: () => ["changelog", "--since", "0.0.1"],
  "plan-hierarchy": () => ["plan-hierarchy", "--parent", "e1"],
  "push-detour": () => ["push-detour", "e1", "--detour", "other", "--reason", "blocked", "--reconcile"],
  "record-reconcile": () => ["record-reconcile", "e1", "--detour", "other", "--verdict", "valid"],
  "record-tracker-refresh": () => ["record-tracker-refresh", "ext",
    "--verdict", "unchanged", "--external-updated-at", "2026-08-01T00:00:00.000Z"],
  "remove-epic": () => ["remove-epic", "other"],
  render: () => ["render"],
  rules: () => ["rules", "--epic", "e1"],
  "rules-target": () => ["rules-target", "--platform", "claude-code"],
  "set-autonomy": () => ["set-autonomy", "e1", "--level", "off"],
  "set-lane-routing": () => ["set-lane-routing", "--add", "cache:claude-code"],
  "set-review-mode": () => ["set-review-mode", "--mode", "standard"],
  "set-tracker": () => ["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"],
  triage: () => ["triage", "a caching bug in the renderer", "--limit", "3"],
  "verify-specs": () => ["verify-specs", "--root", "docs/superpowers/specs"],
  "write-rules": () => ["write-rules", "--platform", "claude-code"],
};

function batchFile(cwd) {
  const p = path.join(cwd, "batch.json");
  fs.writeFileSync(p, JSON.stringify({ epics: [{ id: "batched", title: "B", lane: "claude-code" }] }));
  return p;
}

/** A repo with the epics, the external id and the paused/detour pair every baseline above
 *  needs, so a baseline that fails does so for a reason the sweep can see. */
function sweepRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const specs = path.join(cwd, "docs", "superpowers", "specs");
  fs.mkdirSync(specs, { recursive: true });
  fs.writeFileSync(path.join(specs, "a-design.md"), "# a\n");
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "ext", "--lane", "claude-code", "--external-id", "7"], { cwd });
  return cwd;
}

test("gh-152: no (command, flag) pair is governed by more than one registry row", async () => {
  const { EPIC_FLAGS, VERB_FLAGS } = await import(CONSTANTS);
  const seen = new Map();
  for (const [table, rows] of [["EPIC_FLAGS", EPIC_FLAGS], ["VERB_FLAGS", VERB_FLAGS]]) {
    for (const row of rows) {
      for (const command of row.commands) {
        const key = `${command} --${row.flag}`;
        assert.equal(seen.has(key), false,
          `${key} is declared twice (${seen.get(key)} and ${table}) — with two rows the guard ` +
          "depends on array order, which is the single-declaration property this table exists for");
        seen.set(key, table);
      }
    }
  }
  assert.ok(seen.size > 40, `the registries govern only ${seen.size} pairs — a reader is broken`);
});

test("gh-152: every DISPATCHED verb is claimed by a flag declaration or declared flagless", async () => {
  // Derived from conductor.mjs, never from the registry. #152's whole defect is that
  // `valueBearingFlagsFor()` answered `[]` for a verb nobody had registered, and a check that
  // walks the registry cannot see the verb that is missing from it.
  const { EPIC_FLAGS, VERB_FLAGS, FLAGLESS_VERBS } = await import(CONSTANTS);
  const dispatched = dispatchedVerbs();
  assert.ok(dispatched.size >= 30,
    `the dispatch-table reader yielded only ${dispatched.size} verbs — the reader is broken, not the table`);

  const withFlags = new Set([...EPIC_FLAGS, ...VERB_FLAGS].flatMap(r => r.commands));
  const flagless = new Set(FLAGLESS_VERBS);

  for (const verb of [...dispatched].sort()) {
    const claims = [withFlags.has(verb) && "a flag registry", flagless.has(verb) && "FLAGLESS_VERBS"]
      .filter(Boolean);
    assert.equal(claims.length, 1,
      `verb '${verb}' is dispatched and claimed by ${claims.length} declaration(s) ` +
      `(${claims.join(" + ") || "none"}) — every verb must declare its flag surface exactly once, ` +
      "or the #152 guard silently no-ops on it the way it did on twelve verbs before this");
  }
  for (const verb of [...withFlags, ...flagless].sort()) {
    assert.ok(dispatched.has(verb),
      `'${verb}' declares a flag surface, and the engine does not dispatch it`);
  }
});

test("gh-152: every FLAG the engine reads off a parsed-flags object is declared somewhere", async () => {
  // The verb-level check above catches a VERB that opts out. It does not catch a FLAG that opts
  // out of a declared verb — which is a real gap, not a hypothetical: `render --diff-summary`
  // was found by grepping the source, not by that test. This closes it from the other end.
  //
  // GLOBAL, not per-verb, and deliberately so. Several modules host more than one verb
  // (lane-routing.mjs, tracker.mjs, conductor.mjs's own dispatch bodies), so attributing a read
  // to the verb that performs it means parsing function boundaries — brittle in exactly the way
  // that would make this check unmaintained. "Is this name declared ANYWHERE" is weaker and it
  // is the strong half of the property: a flag nobody declared cannot be reached by the rule at
  // all, whichever verb reads it.
  const { EPIC_FLAGS, VERB_FLAGS } = await import(CONSTANTS);
  const declared = new Set([...EPIC_FLAGS, ...VERB_FLAGS].map(r => r.flag));
  const files = fs.readdirSync(path.join(REPO, "scripts", "lib"))
    .filter(n => n.endsWith(".mjs"))
    .map(n => path.join("scripts", "lib", n))
    .concat([path.join("scripts", "conductor.mjs")]);

  // The REGION is what makes this precise: a bare `f` is a frame in links.mjs, a finding in
  // integrity.mjs and a registry row in constants.mjs, so scanning whole files is all noise.
  // Start at each `const <name> = parseFlags(…)` and stop at the first non-blank line indented
  // LESS than that one — the enclosing function's closing brace. Everything between is a verb
  // body reading its own parsed flags, and nothing else is scanned at all.
  const undeclared = [];
  let regions = 0;
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(REPO, rel), "utf8").split("\n");
    for (let start = 0; start < lines.length; start++) {
      const m = /^(\s*)const (\w+) = parseFlags\(/.exec(lines[start]);
      if (!m) continue;
      regions++;
      const [, indent, obj] = m;
      const re = new RegExp(`\\b${obj}\\.([a-z][a-zA-Z]*)\\b|\\b${obj}\\["([a-z][a-z-]*)"\\]`, "g");
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() && /^\s*/.exec(line)[0].length < indent.length) break;
        if (line.includes("pm:not-a-flag")) continue;
        for (const hit of line.matchAll(re)) {
          // A camelCase read of a hyphenated flag: `f.externalId` is never how the parsed object
          // is keyed (parseFlags keys on the literal flag text), so this only normalizes reads
          // that are already declared under their hyphenated spelling.
          const name = (hit[1] || hit[2]).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
          if (!declared.has(name)) undeclared.push(`${rel}:${i + 1} --${name}`);
        }
      }
    }
  }
  assert.ok(regions >= 15, `the region reader found only ${regions} parseFlags sites — it is broken`);
  assert.deepEqual([...new Set(undeclared)].sort(), [],
    "the engine reads a flag no registry row declares, so #152's rule cannot reach it. Declare " +
    "it in EPIC_FLAGS or VERB_FLAGS, or mark the line `pm:not-a-flag` if the read is not a flag");
});

test("gh-152: every command VERB_FLAGS names has a baseline invocation here", async () => {
  const { VERB_FLAGS } = await import(CONSTANTS);
  const commands = [...new Set(VERB_FLAGS.flatMap(r => r.commands))].sort();
  assert.deepEqual(commands.filter(c => !(c in VERB_BASELINE)), [],
    "a command added to VERB_FLAGS with no baseline here would be swept by nothing");
});

test("gh-152: every VERB_FLAGS baseline actually succeeds, so a non-zero exit below means the flag", async () => {
  const { VERB_FLAGS } = await import(CONSTANTS);
  for (const command of [...new Set(VERB_FLAGS.flatMap(r => r.commands))].sort()) {
    const cwd = sweepRepo();
    run(VERB_BASELINE[command](cwd), { cwd });
  }
});

test("gh-152: every value-bearing flag, on every verb outside EPIC_FLAGS, refuses a valueless occurrence", async () => {
  const { VERB_FLAGS } = await import(CONSTANTS);
  // ONE fixture for every refusal: a refusal that wrote nothing leaves the next case's
  // preconditions intact by definition, and the final byte-comparison is what proves it.
  const cwd = sweepRepo();
  const before = stateOf(cwd);
  let checked = 0;
  for (const row of VERB_FLAGS) {
    if (row.valueless) continue;
    for (const command of row.commands) {
      for (const args of [[`--${row.flag}`], [`--${row.flag}`, "   "]]) {
        const err = expectFail(() => run([...VERB_BASELINE[command](cwd), ...args], { cwd }));
        assert.ok(err, `${command} ${args.join(" ")} must exit non-zero — a blank value is the ` +
          "same silent drop as a missing one, one step further on");
        assert.match(String(err.stderr || err.message), new RegExp(`--${row.flag} requires `),
          `${command} --${row.flag}'s refusal must name the flag`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 40, `expected the sweep to exercise the whole table, ran ${checked}`);
  assert.equal(stateOf(cwd), before, "not one refusal may leave a write behind");
});

test("gh-152: `set-autonomy --level` with no value writes no autonomy block — the issue's sharpest case", () => {
  // It used to exit 0 having written an autonomy block with the level silently absent, on the
  // verb whose entire purpose is recording how much trust an epic has been granted.
  const cwd = sweepRepo();
  const err = expectFail(() => run(["set-autonomy", "e1", "--level"], { cwd }));
  assert.ok(err, "a valueless --level must fail");
  assert.match(String(err.stderr || err.message), /--level requires a value/);
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").autonomy, undefined,
    "the autonomy block must not exist at all — an epic recorded as having been granted " +
    "something, with no record of what, is worse than no record");
});

test("gh-152: the two verbs that ALREADY answered by hand keep their own stricter checks", () => {
  // `triage --limit` and `verify-specs --root` each invented the right answer independently.
  // The shared rule now runs first; their bespoke checks must survive it, because neither is
  // subsumed — `--limit abc` carries a value and is still not a positive integer.
  const cwd = sweepRepo();
  for (const argv of [["--limit", "abc"], ["--limit", "0"], ["--limit", "-3"]]) {
    const err = expectFail(() => run(["triage", "a caching bug", ...argv], { cwd }));
    assert.match(String(err.stderr || err.message), /--limit/,
      `\`triage … ${argv.join(" ")}\` must still be refused by triage's own integer check`);
  }
  // `--headers` is the OPPOSITE direction — a boolean arm that must refuse a value. The
  // valueless rule marks it exempt; it must not have made it permissive.
  const err = expectFail(() => run(["verify-specs", "--headers", "docs"], { cwd }));
  assert.match(String(err.stderr || err.message), /--headers takes no value/);
});

test("gh-152: VERB_FLAGS' valueless rows are a short closed list", async () => {
  const { VERB_FLAGS } = await import(CONSTANTS);
  const valueless = VERB_FLAGS.filter(f => f.valueless).map(f => `${f.commands.join("/")} --${f.flag}`).sort();
  assert.deepEqual(valueless, [
    "push-detour --no-reconcile",
    "push-detour --reconcile",
    "remove-epic --cascade",
    "render --diff-summary",
    "set-lane-routing --clear",
    "set-tracker --remove",
    "verify-specs --headers",
  ], "a flag marked valueless is EXEMPT from the guard — widening this list silently reopens #152");
});

test("gh-152: `--remove` is value-bearing on set-lane-routing and valueless on set-tracker", async () => {
  // The reason rows are SCOPED rather than global: the same spelling is a match string on one
  // verb and a boolean on the other. A single global row for `--remove` would have to pick one,
  // and either choice is wrong somewhere.
  const cwd = sweepRepo();
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  run(["set-lane-routing", "--add", "cache:claude-code"], { cwd });
  const err = expectFail(() => run(["set-lane-routing", "--remove"], { cwd }));
  assert.match(String(err.stderr || err.message), /--remove requires /);
  assert.equal(readState(cwd).laneRouting.overrides.length, 1, "the override must survive the refusal");
  // …and the boolean reading still works on the other verb.
  run(["set-tracker", "--role", "secondary", "--system", "jira", "--project", "AB"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "jira", "--project", "AB", "--remove"], { cwd });
});

// ═══════════════ #151: the detour PUSH and POP the engine was absent for ═══════════════

/** A repo with a parent epic and a detour epic registered, ready to be pushed. */
function detourRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "parent", "--lane", "openspec", "--status", "active"], { cwd });
  run(["add-epic", "--id", "fixit", "--lane", "claude-code", "--priority", "P0"], { cwd });
  return cwd;
}
const push = (cwd, extra = []) =>
  run(["push-detour", "parent", "--detour", "fixit", "--reason", "blocked on a bad cache key",
    ...extra], { cwd });

test("gh-151: push-detour writes the whole frame, both links, and the active pointer in one write", () => {
  const cwd = detourRepo();
  const out = push(cwd, ["--reconcile"]);
  const s = readState(cwd);

  assert.equal(s.detourStack.length, 1);
  const frame = s.detourStack[0];
  assert.equal(frame.pausedEpic, "parent");
  assert.equal(frame.spawnedDetour, "fixit");
  assert.equal(frame.reason, "blocked on a bad cache key");
  assert.equal(frame.reconcileOnResume, true);
  assert.ok(Date.parse(frame.pausedAt), "the frame must carry a parseable pausedAt");

  const parent = s.epics.find(e => e.id === "parent");
  const fixit = s.epics.find(e => e.id === "fixit");
  assert.equal(parent.status, "paused");
  assert.equal(s.active, "fixit");
  assert.equal(fixit.status, "active");
  // `role: "detour"` was part of the hand-edit and `add-epic` has no --role, so replacing the
  // hand-edit without it would leave every detour at `role: "epic"` — costing detourContext()'s
  // no-live-frame fallback and PROJECT.md's role column.
  assert.equal(fixit.role, "detour");
  // Both protocol links, in the documented directions: `may-invalidate` on the PARENT (which is
  // what record-reconcile hangs its verdict on) and `resolves-blocker-for` on the DETOUR.
  assert.ok(parent.links.some(l => l.type === "may-invalidate" && l.epic === "fixit"));
  assert.ok(fixit.links.some(l => l.type === "resolves-blocker-for" && l.epic === "parent"));

  // The Honcho line is EMITTED, not left as a separate step the agent has to remember.
  assert.match(out, /paused parent for blocked on a bad cache key/);
  const log = fs.readFileSync(path.join(cwd, ".conductor", "honcho-memories.log"), "utf8");
  assert.match(log, /paused parent for blocked on a bad cache key/);
});

test("gh-151: the reconcile decision must be SAID — neither flag, or both, is refused", () => {
  const cwd = detourRepo();
  const before = stateOf(cwd);
  for (const extra of [[], ["--reconcile", "--no-reconcile"]]) {
    const err = expectFail(() => push(cwd, extra));
    assert.ok(err, `push-detour ${extra.join(" ") || "(no reconcile flag)"} must be refused`);
    assert.match(String(err.stderr || err.message), /exactly one of --reconcile or --no-reconcile/);
  }
  assert.equal(stateOf(cwd), before, "a refused push must write nothing");
});

test("gh-151: --no-reconcile is honoured and arms no gate", () => {
  const cwd = detourRepo();
  push(cwd, ["--no-reconcile"]);
  const s = readState(cwd);
  assert.equal(s.detourStack[0].reconcileOnResume, false);
  assert.equal(s.epics.find(e => e.id === "parent").reconcileNeeded, false);
});

test("gh-151: push-detour validates what only the engine can — the guarantees the hand-edit had none of", () => {
  const cwd = detourRepo();
  const before = stateOf(cwd);
  const cases = [
    [["push-detour", "ghost", "--detour", "fixit", "--reason", "x", "--reconcile"], /epic 'ghost' not found/],
    [["push-detour", "parent", "--detour", "ghost", "--reason", "x", "--reconcile"], /detour epic 'ghost' not found/],
    [["push-detour", "parent", "--detour", "parent", "--reason", "x", "--reconcile"], /cannot be the same epic/],
    // The #149 rule reaching this verb through the shared registry: `--reason` inherits
    // REASON_REQUIRES from the same constant `update-epic --reason` and `release --reason` read.
    [["push-detour", "parent", "--detour", "fixit", "--reason", "--reconcile"], /--reason requires a non-empty reason/],
    [["push-detour", "parent", "--detour", "fixit", "--reason", "   ", "--reconcile"], /--reason requires a non-empty reason/],
    [["push-detour", "parent", "--detour", "--reason", "x", "--reconcile"], /--detour requires a value/],
  ];
  for (const [argv, re] of cases) {
    const err = expectFail(() => run(argv, { cwd }));
    assert.ok(err, `${argv.join(" ")} must be refused`);
    assert.match(String(err.stderr || err.message), re);
  }
  assert.equal(stateOf(cwd), before, "not one refusal may leave a write behind");
});

test("gh-151: an archived epic cannot be paused, and an archived detour cannot be pushed to", () => {
  const cwd = detourRepo();
  run(["add-epic", "--id", "dead", "--lane", "claude-code"], { cwd });
  run(["update-epic", "dead", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  let err = expectFail(() => run(["push-detour", "dead", "--detour", "fixit", "--reason", "x", "--reconcile"], { cwd }));
  assert.match(String(err.stderr || err.message), /is archived/);
  err = expectFail(() => run(["push-detour", "parent", "--detour", "dead", "--reason", "x", "--reconcile"], { cwd }));
  assert.match(String(err.stderr || err.message), /is archived/);
});

test("gh-151: the same epic cannot be pushed onto the stack twice", () => {
  const cwd = detourRepo();
  push(cwd, ["--reconcile"]);
  run(["add-epic", "--id", "second", "--lane", "claude-code"], { cwd });
  const err = expectFail(() =>
    run(["push-detour", "parent", "--detour", "second", "--reason", "again", "--reconcile"], { cwd }));
  assert.match(String(err.stderr || err.message), /already on the detour stack/);
  assert.equal(readState(cwd).detourStack.length, 1);
});

test("gh-151: pop-detour removes the frame, resumes the epic, and SURVIVES a render", () => {
  // THE ORDERING TRAP. reconcileArchived() clears `reconcileNeeded` for any epic with no live
  // frame that is not `state.active`, and POP removes the frame BEFORE reconciliation runs — so
  // the obligation survives only because the resumed epic is made active in the SAME write. A
  // pop that set the active pointer separately, or rendered in between, would erase the flag it
  // had just created, and every assertion except the render one here would still pass.
  const cwd = detourRepo();
  push(cwd, ["--reconcile"]);
  const out = runCombined(["pop-detour"], { cwd });
  let s = readState(cwd);
  assert.equal(s.detourStack.length, 0, "the frame must be gone");
  assert.equal(s.active, "parent");
  assert.equal(s.epics.find(e => e.id === "parent").status, "active");
  assert.equal(s.epics.find(e => e.id === "parent").reconcileNeeded, true);
  // No Honcho POP line yet: "reconciled vs X" is not true until the verdict exists.
  assert.doesNotMatch(out, /resumed parent, reconciled/);
  assert.match(out, /RECONCILE GATE/);

  run(["render"], { cwd });
  s = readState(cwd);
  assert.equal(s.epics.find(e => e.id === "parent").reconcileNeeded, true,
    "render's archive-drift self-heal must not clear the obligation the pop just created");

  // …and record-reconcile is still the thing that clears it, unchanged.
  run(["record-reconcile", "parent", "--detour", "fixit", "--verdict", "valid"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "parent").reconcileNeeded, false);
});

test("gh-151: a --no-reconcile pop needs no gate and emits its Honcho line immediately", () => {
  const cwd = detourRepo();
  push(cwd, ["--no-reconcile"]);
  const out = run(["pop-detour"], { cwd });
  assert.match(out, /resumed parent, reconciled vs fixit; no reconcile was required/);
  assert.equal(readState(cwd).epics.find(e => e.id === "parent").reconcileNeeded, false);
});

test("gh-151: pop-detour refuses an empty stack and a mis-named top frame", () => {
  const cwd = detourRepo();
  let err = expectFail(() => run(["pop-detour"], { cwd }));
  assert.match(String(err.stderr || err.message), /detour stack is empty/);
  push(cwd, ["--reconcile"]);
  const before = stateOf(cwd);
  err = expectFail(() => run(["pop-detour", "fixit"], { cwd }));
  assert.match(String(err.stderr || err.message), /top of the detour stack is 'parent'/);
  assert.equal(stateOf(cwd), before, "a refused pop must write nothing");
  // The positional as an ASSERTION that passes.
  run(["pop-detour", "parent"], { cwd });
  assert.equal(readState(cwd).detourStack.length, 0);
});

test("gh-151: pop-detour WARNS about an unarchived detour rather than refusing", () => {
  // Refusing would leave a stack whose detour epic was removed or renamed with no CLI way out,
  // which re-creates the hand-edit this verb exists to remove.
  const cwd = detourRepo();
  push(cwd, ["--no-reconcile"]);
  const out = runCombined(["pop-detour"], { cwd });
  // The status named is the one AFTER activate() demotes the detour off `active` — `queued`, not
  // `active`. Asserted loosely for that reason: what matters is that the unfinished detour is
  // named, not which non-terminal status it happens to land in.
  assert.match(out, /detour 'fixit' is still \w+, not archived/);
  assert.equal(readState(cwd).detourStack.length, 0, "the warning must not have blocked the pop");
});

test("gh-151: the detour verbs go through the guarded write path, not a hand-edit", () => {
  // The point of the verb, mechanically: a hand-edit had no conflict guard, so a second writer's
  // change was silently discarded. saveState()'s revision check is what these inherit for free.
  const cwd = detourRepo();
  const statePath = path.join(cwd, ".conductor", "state.json");
  const before = JSON.parse(fs.readFileSync(statePath, "utf8"));
  push(cwd, ["--reconcile"]);
  const after = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.ok(after.revision > (before.revision || 0),
    "push-detour must advance state.json's revision — that counter IS the conflict guard");
});

test("gh-151: the deferral disclosure fires at the PUSH, counting the push being made", () => {
  // gh#94 shipped this on `honcho-memory push`, which ran AFTER the hand-edit. It now fires at
  // the transition. Silent on a first deferral: the first detour is the mechanism working.
  const cwd = detourRepo();
  run(["add-epic", "--id", "second", "--lane", "claude-code"], { cwd });
  const first = runCombined(["push-detour", "parent", "--detour", "fixit",
    "--reason", "one", "--reconcile"], { cwd });
  assert.doesNotMatch(first, /deferral of this epic/, "a first deferral must stay silent");
  run(["pop-detour"], { cwd });
  run(["record-reconcile", "parent", "--detour", "fixit", "--verdict", "valid"], { cwd });
  const second = runCombined(["push-detour", "parent", "--detour", "second",
    "--reason", "two", "--reconcile"], { cwd });
  assert.match(second, /2nd deferral of this epic/);
});
