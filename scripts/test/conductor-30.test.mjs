// gh-149 / gh-148 — one rule for "this flag needs a value", and the header a design document
// already carries.
//
// #149: `update-epic --plan` with no value was REFUSED; `add-epic --plan` with no value was
// SILENTLY DROPPED — exit 0, epic created, field absent. Same flag, same registry row, two
// behaviours, because each command carried its own hand-written list of which flags it happened
// to check. Every such list is a stale enumeration waiting for the next field.
//
// The decision: REFUSE ON BOTH — on every surface, from the shared declaration. Accepting on
// both is the only reading that REMOVES a working catch, and the mistake it catches (a flag
// whose value was eaten by a shell, a trailing flag with nothing after it) is silent and
// unrecoverable in exactly the way #79 and #136 were.
//
// The guard is GENERAL by construction: `EPIC_FLAGS` marks the three rows that legitimately take
// no value (`--clear-links`, `--no-deferrals`, `--done`), and every other row is value-bearing.
// So the tests below are written as a SWEEP over the registry — every command it names, every
// value-bearing flag on that command — rather than as a list of flags somebody remembered. A row
// added tomorrow is covered the moment it is declared, and a command added tomorrow FAILS this
// file until it declares a baseline invocation, which is the only way a sweep can stay honest.
//
// See docs/lessons/a-guard-can-check-the-wrong-half.md: the pre-existing registry guard proved a
// flag was DECLARED, not that anything HONOURED it. Everything here runs the CLI.
//
// #148: `verify-specs` reported 0 of 10 documents covered and the documents had named their own
// epics in a header the whole time. The engine must not ASSOCIATE — a header is prose an author
// can typo — so this is the `triage` split: mechanical candidate set, agent's verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, expectFail } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;

// ═══════════════ #149: one rule for a valueless flag ═══════════════

/** A minimal invocation of each registry command that EXITS 0 on the fixture below, so that
 *  appending one valueless flag and seeing a non-zero exit is attributable to that flag and to
 *  nothing else. Keyed by command name; the sweep asserts this table covers every command
 *  EPIC_FLAGS names, so adding a command to the registry without a baseline here fails loudly
 *  instead of quietly going unswept. */
const BASELINE = {
  "add-epic": () => ["add-epic", "--id", "fresh", "--lane", "claude-code"],
  "update-epic": () => ["update-epic", "e1", "--title", "t"],
  "record-gate-review": () => ["record-gate-review", "e1", "--gate", "1", "--verdict", "pass",
    "--base-sha", "aaa", "--head-sha", "bbb"],
  "record-cross-spec-review": () => ["record-cross-spec-review", "0.1.0", "--verdict", "pass"],
  release: () => ["release", "0.1.0", "--intent", "why"],
  // `add-many` takes no epic flags on argv at all — its surface is the batch DOCUMENT's keys,
  // swept separately below because the shape of the mistake is a key with a non-string value.
  "add-many": null,
};

/** A repo with two epics, a release holding two spec files, and a spec on disk — enough for
 *  every baseline above to succeed. */
function sweepRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const specs = path.join(cwd, "docs", "superpowers", "specs");
  fs.mkdirSync(specs, { recursive: true });
  fs.writeFileSync(path.join(specs, "a-design.md"), "# a\n");
  fs.writeFileSync(path.join(specs, "b-design.md"), "# b\n");
  // record-cross-spec-review's gate applies at two or more spec FILES, counted from disk under
  // each member's openspec change — so the fixture has to carry them or that baseline refuses
  // for a reason that has nothing to do with the flag being swept.
  for (const [id, name] of [["e1", "alpha"], ["other", "beta"]]) {
    const d = path.join(cwd, "openspec", "changes", id, "specs", name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "spec.md"), `## ADDED Requirements\n### Requirement: ${name}\n`);
  }
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "openspec",
    "--spec", "docs/superpowers/specs/a-design.md"], { cwd });
  run(["update-epic", "other", "--spec", "docs/superpowers/specs/b-design.md"], { cwd });
  run(["release", "0.1.0", "--intent", "why", "--member", "e1", "--member", "other"], { cwd });
  return cwd;
}

const stateOf = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

test("gh-149: the registry declares which flags take no value, and it is a short closed list", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const valueless = EPIC_FLAGS.filter(f => f.valueless).map(f => f.flag).sort();
  assert.deepEqual(valueless, ["clear-links", "done", "no-deferrals"],
    "a flag marked valueless is EXEMPT from the guard — widening this list silently reopens #149");
  // The discriminator is `valueless`, never `key`. Ten value-bearing rows carry `key: null`
  // because the command owns the write (`--gate`, `--reviewer`, `--wont-do`, …); projecting the
  // guard off `key` would exempt every one of them.
  const nullKeyed = EPIC_FLAGS.filter(f => f.key === null && !f.valueless).map(f => f.flag);
  assert.ok(nullKeyed.length >= 8,
    `expected value-bearing rows with key:null to exist (found ${nullKeyed.length}) — ` +
    "if this ever reaches 0 the key-vs-valueless distinction has quietly collapsed");
});

test("gh-149: EVERY command in the registry has a baseline invocation, so the sweep covers all of them", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const commands = [...new Set(EPIC_FLAGS.flatMap(f => f.commands))].sort();
  const declared = Object.keys(BASELINE).sort();
  assert.deepEqual(commands.filter(c => !declared.includes(c)), [],
    "a command added to EPIC_FLAGS with no BASELINE entry here would be swept by nothing");
});

test("gh-149: every value-bearing flag, on every command, refuses a valueless occurrence", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // ONE fixture for every refusal: a refusal that wrote nothing leaves the next case's
  // preconditions intact by definition, and the final byte-comparison is what proves it. The
  // baselines get their own throwaway repos because they SUCCEED — and each one must, or a
  // non-zero exit below would prove nothing about the flag that was appended to it.
  const cwd = sweepRepo();
  const before = stateOf(cwd);
  let checked = 0;
  for (const [command, baseline] of Object.entries(BASELINE)) {
    if (!baseline) continue;
    run(baseline(), { cwd: sweepRepo() });
    for (const row of EPIC_FLAGS) {
      if (!row.commands.includes(command) || row.valueless) continue;
      for (const args of [[`--${row.flag}`], [`--${row.flag}`, "   "]]) {
        const err = expectFail(() => run([...baseline(), ...args], { cwd }));
        assert.ok(err, `${command} ${args.join(" ")} must exit non-zero — a blank value is the ` +
          "same silent drop as a missing one, one step further on");
        assert.match(String(err.stderr || err.message), new RegExp(`--${row.flag} requires `),
          `${command} --${row.flag}'s refusal must name the flag`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 80, `expected the sweep to exercise the whole registry, ran ${checked}`);
  assert.equal(stateOf(cwd), before, "not one refusal may leave a write behind");
});

test("gh-149: a REPEATABLE flag is refused when ANY occurrence is valueless, not just the first", () => {
  // parseFlags pushes repeatable flags into an array, so a valueless one arrives as `[true]` —
  // never as bare `true`. A guard testing `f[flag] === true` passes every test above that uses a
  // non-repeatable flag and covers none of the eight repeatable rows. The MIXED shape below
  // (`[good, true]`) is the case a guard reading only `vals[0]` survives.
  const cwd = sweepRepo();
  const before = stateOf(cwd);
  const err = expectFail(() => run(
    ["update-epic", "e1", "--attribute-commit", "aaaaaaa", "--attribute-commit"], { cwd }));
  assert.ok(err, "a trailing valueless --attribute-commit must be refused, not silently skipped");
  assert.match(String(err.stderr || err.message), /--attribute-commit requires /);
  assert.equal(stateOf(cwd), before, "and the good occurrence must not land on its own");

  const cwd2 = sweepRepo();
  const err2 = expectFail(() => run(
    ["update-epic", "e1", "--add-story", "real one", "--add-story"], { cwd: cwd2 }));
  assert.ok(err2, "the same for --add-story");
  assert.equal(readState(cwd2).epics.find(e => e.id === "e1").stories, undefined,
    "no story may land from a refused invocation");
});

test("gh-149: the refusal lands BEFORE any state is loaded or written, on every surface", () => {
  const cwd = sweepRepo();
  const before = stateOf(cwd);
  const cases = [
    ["add-epic", "--id", "n", "--lane", "claude-code", "--plan"],
    ["update-epic", "e1", "--plan"],
    ["record-gate-review", "e1", "--gate", "1", "--verdict", "pass",
      "--base-sha", "a", "--head-sha", "b", "--reviewer"],
    ["release", "0.1.0", "--target"],
    ["record-cross-spec-review", "0.1.0", "--verdict", "pass", "--reviewer"],
  ];
  for (const args of cases) {
    // Asserted as a REFUSAL, not merely as "state did not change". `release 0.1.0 --target` with
    // the guard removed exits 0 having written nothing, which a state comparison alone reads as
    // success — that is the exact exit-0-write-nothing shape this issue is about.
    assert.ok(expectFail(() => run(args, { cwd })), `${args.join(" ")} must exit non-zero`);
  }
  assert.equal(stateOf(cwd), before);
  assert.equal(readState(cwd).epics.some(e => e.id === "n"), false);
});

test("gh-149: add-epic --plan with no value is refused — the asymmetry this issue is about", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--lane", "superpowers", "--plan"], { cwd }));
  assert.ok(err, "add-epic used to exit 0 and create the epic with no planPath at all");
  assert.match(String(err.stderr || err.message), /--plan requires a value/);
  assert.equal(readState(cwd).epics.some(e => e.id === "e1"), false,
    "and it must not create the epic — a successful-looking epic with the field missing is the defect");
  // update-epic already refused; both surfaces must now say the SAME thing.
  run(["add-epic", "--id", "e1", "--lane", "superpowers"], { cwd });
  const err2 = expectFail(() => run(["update-epic", "e1", "--plan"], { cwd }));
  assert.equal(String(err.stderr || err.message).trim(), String(err2.stderr || err2.message).trim(),
    "the same mistake at creation and at update must produce the same refusal");
});

test("gh-149: a flag carrying its own `requires` phrase keeps that wording on every surface", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // The wording lives on the ROW, so a bespoke refusal one command had (`--link` pointing at
  // `--clear-links`) reaches every other command that accepts the flag, instead of being a
  // second behaviour on a second surface — which is the whole shape of this issue.
  const link = EPIC_FLAGS.find(f => f.flag === "link");
  assert.ok(link.requires && link.requires.includes("--clear-links"),
    "--link's refusal must still point at the flag that DOES clear links");
  const cwd = sweepRepo();
  const a = expectFail(() => run(["add-epic", "--id", "n", "--lane", "claude-code", "--link"], { cwd }));
  assert.match(String(a.stderr || a.message), /--clear-links/,
    "add-epic silently created an epic with empty links; it must now refuse, with update-epic's wording");
  const u = expectFail(() => run(["update-epic", "e1", "--link"], { cwd }));
  assert.equal(String(a.stderr || a.message).trim(), String(u.stderr || u.message).trim());
});

// ─────────────── #149: add-many, the surface nobody remembers ───────────────

function batch(cwd, doc) {
  const p = path.join(cwd, "batch.json");
  fs.writeFileSync(p, JSON.stringify(doc));
  return p;
}

test("gh-149: add-many refuses a batch key whose value is not a usable string, and creates nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const bad of [true, 7, "", "   ", {}]) {
    const p = batch(cwd, { epics: [{ id: "b1", lane: "claude-code", planPath: bad }] });
    const err = expectFail(() => run(["add-many", "--from", p], { cwd }));
    assert.ok(err, `planPath: ${JSON.stringify(bad)} must be refused, not copied-if-string and dropped otherwise`);
    assert.match(String(err.stderr || err.message), /planPath/);
    assert.equal(readState(cwd).epics.length, 0, "a batch with one offender creates none of its entries");
  }
});

test("gh-149: add-many still accepts the array-valued keys it validates itself", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const p = batch(cwd, {
    epics: [{ id: "b1", lane: "claude-code", links: [], stories: ["one", { title: "two", done: true }] }],
  });
  run(["add-many", "--from", p], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "b1");
  assert.equal(e.stories.length, 2, "`links` and `stories` are array-valued by design and must survive");
});

