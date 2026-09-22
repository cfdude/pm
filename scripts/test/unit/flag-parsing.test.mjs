// scripts/test/unit/flag-parsing.test.mjs
// 4.1's FIRST MIGRATED FILE — the assertion twin of `scripts/test/functional/flag-parsing.test.mjs`,
// moved from the file rung to the UNIT rung, with every assertion unchanged.
//
// WHAT MOVED, AND WHAT DID NOT. Nothing in this file asserts on BYTES the engine wrote to a path: it
// asserts on what the RECORD SAYS — a title, a story list, a link array, a claim — and on the TEXT
// of a refusal. Under 4.1's rule that is the unit rung's population, so the mechanism the values are
// obtained through changed and nothing else did:
//
//   `tmpRepo()` + `run(["init"], { cwd })`   →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                     →  `engine(args)`
//   `readState(cwd)`                         →  `engine.store.record()`
//   `stateBytes(cwd)` (readFileSync)         →  `engine.store.read("state.json").text`
//
// THE LAST ONE IS THE ONE THAT NEEDED THE SEAM TO BE COMPLETE. Several tests here assert that a
// refusal leaves the record BYTE-IDENTICAL, which reads like a file-rung assertion and is not one:
// what it observes is the record's VALUE, and the store answers it for the memory implementation by
// serialising the record exactly as the disk store would (`store.mjs`'s `memoryArtifact`). Without
// that, this file could not have moved — and the gap was found by moving it, not by reading the
// interface.
//
// WHAT IT BUYS, MEASURED: this file's 14 tests cost 937 ms of the assertion half's per-test time
// (worklist-4.1.md), and its engine invocations now cost 0.70–0.84 ms each with no tmpdir, no lock,
// no temp file, no fsync and no read-back. The `unitTest()` wrapper also asserts, on every one of
// them, that the filesystem was not touched at all.
//
// THE SUBJECT IS UNCHANGED. The functional file's subject is gh#182: a flag VALUE that begins with
// `--` — the value position, the `=` form, and the refusal that names the flag it was filling — plus
// the four sibling raw-argv scanners fixed with it. Nothing in it is git's behaviour except one test
// that needs two real commits, which stays on the functional side by design (D5).

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const TITLE = "--story <n> is 1-indexed but --help says only '<a value>'";

/** An initialized conductor and an engine bound to it. The build is free — a memory store is an
 *  object, not a directory — which is the whole reason this file can be on this rung. */
function repo() {
  return memoryEngine(emptyRecord());
}

/** The record's bytes, as the disk store would have written them. */
const stateBytes = (engine) => engine.store.read("state.json").text;

/** The throwing form, kept local because `unitTest()` bodies read it exactly as the file rung did. */
function expectFail(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

// ───────────────────────── 1. the value position ─────────────────────────

unitTest("gh-182: a --title whose value begins with -- registers, instead of being read as a flag", () => {
  const engine = repo();
  engine(["add-epic", "--id", "gh-176", "--title", TITLE, "--lane", "claude-code"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "gh-176").title, TITLE,
    "the documented tracker-sync line must survive an issue title that starts with a flag name");
});

unitTest("gh-182: the value position is honoured for every value-bearing flag, not just --title", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
    "--notes", "--lane was wrong here", "--description", "--priority is unset"]);
  const e = engine.store.record().epics.find(x => x.id === "e1");
  assert.equal(e.notes.at(-1).text, "--lane was wrong here");
  assert.equal(e.description, "--priority is unset");
});

// ───────────────────────── 2. the `=` form ─────────────────────────

unitTest("gh-182: --flag=value is accepted, and is the escape for a value that IS flag-shaped", () => {
  const engine = repo();
  engine(["add-epic", "--id=e1", `--title=${TITLE}`, "--lane=claude-code"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "e1").title, TITLE);
  engine(["add-epic", "--id=e2", "--title=--no-deferrals", "--lane=claude-code"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "e2").title, "--no-deferrals");
});

unitTest("gh-182: --flag=value splits on the FIRST = only, so a value may contain one", () => {
  const engine = repo();
  engine(["add-epic", "--id=e1", "--title=a=b=c", "--lane=claude-code"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "e1").title, "a=b=c");
});

unitTest("gh-182: --flag= with nothing after it is refused, exactly as --flag \"\" is", () => {
  const engine = repo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["add-epic", "--id=e1", "--title=", "--lane=claude-code"]));
  assert.match(String(err.stderr || err.message), /--title requires/);
  assert.equal(stateBytes(engine), before, "a refusal writes nothing");
});

// ───────────────────────── 3. the guards that must NOT weaken ─────────────────────────

unitTest("gh-182: a genuinely unknown flag is still refused by name", () => {
  const engine = repo();
  engine(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"]);
  const before = stateBytes(engine);
  for (const argv of [
    ["update-epic", "a", "--titel", "Typo'd flag name"],
    ["update-epic", "a", "--titel=Typo'd flag name"],
    ["update-epic", "a", "--title", "--titel"],
  ]) {
    const err = expectFail(() => engine(argv));
    assert.match(String(err.stderr || err.message), /unknown flag/,
      `\`${argv.join(" ")}\` must still be refused by name`);
    assert.match(String(err.stderr || err.message), /titel/);
  }
  assert.equal(stateBytes(engine), before, "not one refusal may leave a write behind");
});

unitTest("gh-182: --foo --bar (both known) still refuses rather than taking --bar as --foo's value", () => {
  const engine = repo();
  engine(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"]);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "a", "--title", "--status", "queued"]));
  const msg = String(err.stderr || err.message);
  assert.match(msg, /--title requires/, "the refusal must name the flag whose value was missing");
  assert.match(msg, /'--status'/, "…and quote the token that arrived in the value position");
  assert.match(msg, /--title=--status/, "…and show the = form that says it unambiguously");
  assert.doesNotMatch(msg, /unknown flag/, "a known flag in a value position is not an unknown flag");
  assert.equal(stateBytes(engine), before);
  assert.equal(engine.store.record().epics.find(e => e.id === "a").title, "Original");
});

unitTest("gh-182: a value-bearing flag with NO value at all is still refused", () => {
  const engine = repo();
  engine(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"]);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "a", "--plan"]));
  assert.match(String(err.stderr || err.message), /--plan requires/);
  assert.equal(stateBytes(engine), before);
});

unitTest("gh-182: valueless flags are unaffected, adjacent to each other and to the = form", () => {
  const engine = repo();
  engine(["add-epic", "--id", "a", "--title", "t", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "b", "--title", "t", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--link", "relates-to:b:x"]);
  engine(["update-epic", "a", "--clear-links", "--status=archived", "--outcome=delivered", "--no-deferrals"]);
  const e = engine.store.record().epics.find(x => x.id === "a");
  assert.deepEqual(e.links, []);
  assert.equal(e.status, "archived");
});

unitTest("gh-182: a repeatable flag still repeats when its values begin with --", () => {
  const engine = repo();
  engine(["add-epic", "--id", "a", "--title", "t", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "--story <n> is 1-indexed",
    "--add-story=--help says only <a value>"]);
  const titles = engine.store.record().epics.find(x => x.id === "a").stories.map(s => s.title);
  assert.deepEqual(titles, ["--story <n> is 1-indexed", "--help says only <a value>"],
    "both occurrences must land, in order — one form must not clobber the other");
});

// ─────────────── 4. the identical sibling: the unknown-flag scan (now the pre-dispatch check) ───────────────

unitTest("gh-182: the unknown-flag scan reads a --value as a value, on the verbs requireKnownFlags() once guarded", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"]);
  engine(["claim", "e1", "--session", "--weird session name"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "e1").claim.session, "--weird session name");

  engine(["unclaim", "e1", "--session=--weird session name"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "e1").claim, undefined);

  for (const argv of [
    ["claim", "e1", "--session", "s", "--bogus"],
    ["owners", "--bogus"],
    ["owners", "--bogus=x"],
    ["purge-logs", "--keep", "5", "--bogus"],
  ]) {
    const err = expectFail(() => engine(argv));
    assert.match(String(err.stderr || err.message), new RegExp(`unknown flag --bogus for ${argv[0]}`),
      `\`${argv.join(" ")}\` must be refused by name`);
  }
});

unitTest("gh-182: owners' positional scan skips a --value instead of reading it as an epic id", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"]);
  engine(["claim", "e1", "--session", "s"]);
  const r = engine.result(["owners", "--json=x"]);
  const out = r.stdout + r.stderr;
  assert.match(out, /--json takes no value/,
    "the = form must at least parse into a flag rather than a positional");
});

unitTest("gh-182: update-epic's --id diagnosis reads the = form, and keeps the flags it did not consume", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"]);

  const eq = String(expectFail(() => engine(["update-epic", "--id=e1", "--priority", "P1"])).stderr);
  assert.match(eq, /update-epic e1 --priority P1/, "the = form must be recognised and rewritten");

  const none = String(expectFail(() => engine(["update-epic", "--id", "--priority", "P1"])).stderr);
  assert.match(none, /update-epic <id> --priority P1/,
    "a valueless --id must not eat the next flag out of the suggestion");
});

// ─────────────── 5. the predicate itself, against the registry ───────────────

unitTest("gh-182: every registered flag name is recognised by isFlagToken", async () => {
  const c = await import(new URL("../../lib/constants.mjs", import.meta.url).href);
  const names = [...new Set([...c.EPIC_FLAGS, ...c.VERB_FLAGS].map(f => f.flag))];
  assert.ok(names.length > 50, `the registry projection is broken — only ${names.length} flags`);
  for (const n of names) {
    assert.ok(c.isFlagToken(`--${n}`), `--${n} must read as a flag token`);
    assert.ok(c.isFlagToken(`--${n}=v`), `--${n}=v must read as a flag token`);
  }
  for (const t of [TITLE, "--story <n> is wrong", "-x", "plain", "--", "--a b"]) {
    assert.equal(c.isFlagToken(t), false, `'${t}' must not read as a flag token`);
  }
});

// ───────────────────────── the deliberate omission ─────────────────────────
//
// "gh-182: the = form reaches a REPEATABLE flag as a repeat, not as an overwrite" uses
// `--attribute-commit=<sha>` twice, and the engine RESOLVES every recorded commit value at write
// time — so it needs two real commits, which NO assertion-half rung can make (design D5). Its
// repeatability is still proven here by the `--add-story` case, which is a repeatable flag with no
// git in it.
