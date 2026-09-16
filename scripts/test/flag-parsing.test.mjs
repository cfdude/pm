// gh#182 — a flag VALUE that begins with `--`.
//
// The reported failure: an issue whose TITLE begins with a flag name could not be mirrored.
// `add-epic --title "--story <n> is 1-indexed but --help says only '<a value>'"` died with
// `unknown flag(s) --story <n> is 1-indexed …` — the message named the VALUE as though it were
// a flag, the run continued, and the item was silently absent from the backlog. The documented
// inward tracker-sync line in this repo's own CLAUDE.md is exactly that shape, and a bug report
// ABOUT a flag is exactly the kind of item titled that way.
//
// THREE RULES, and the third is what keeps the first two from costing a guard:
//   1. `--flag=value` is accepted everywhere, split on the FIRST `=` so a value may contain one.
//   2. A token in a VALUE position is taken as the value unless it is FLAG-SHAPED — see
//      isFlagToken() in constants.mjs. So a title with a space is rescued; `--title --status`
//      still refuses, because a value position that looks exactly like a flag is genuinely
//      ambiguous and `=` is the escape for it.
//   3. The refusal in that ambiguous case NAMES the flag it was filling and shows the `=` form,
//      instead of reporting the value as an unknown flag name.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { expectFail, fixtureCommits, readState, run, runCombined, tmpRepo } from "./helpers.mjs";

const TITLE = "--story <n> is 1-indexed but --help says only '<a value>'";

function repo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ───────────────────────── 1. the value position ─────────────────────────

test("gh-182: a --title whose value begins with -- registers, instead of being read as a flag", () => {
  const cwd = repo();
  run(["add-epic", "--id", "gh-176", "--title", TITLE, "--lane", "claude-code"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "gh-176").title, TITLE,
    "the documented tracker-sync line must survive an issue title that starts with a flag name");
});

test("gh-182: the value position is honoured for every value-bearing flag, not just --title", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
    "--notes", "--lane was wrong here", "--description", "--priority is unset"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes.at(-1).text, "--lane was wrong here");
  assert.equal(e.description, "--priority is unset");
});

// ───────────────────────── 2. the `=` form ─────────────────────────

test("gh-182: --flag=value is accepted, and is the escape for a value that IS flag-shaped", () => {
  const cwd = repo();
  run(["add-epic", "--id=e1", `--title=${TITLE}`, "--lane=claude-code"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").title, TITLE);

  // The residual case the value-position rule deliberately does NOT take: a value that is
  // exactly a flag token. `=` is the only way to say it, which is why it must work.
  run(["add-epic", "--id=e2", "--title=--no-deferrals", "--lane=claude-code"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e2").title, "--no-deferrals");
});

test("gh-182: --flag=value splits on the FIRST = only, so a value may contain one", () => {
  const cwd = repo();
  run(["add-epic", "--id=e1", "--title=a=b=c", "--lane=claude-code"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").title, "a=b=c");
});

test("gh-182: --flag= with nothing after it is refused, exactly as --flag \"\" is", () => {
  const cwd = repo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["add-epic", "--id=e1", "--title=", "--lane=claude-code"], { cwd }));
  assert.match(String(err.stderr || err.message), /--title requires/);
  assert.equal(stateBytes(cwd), before, "a refusal writes nothing");
});

test("gh-182: the = form reaches a REPEATABLE flag as a repeat, not as an overwrite", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  run(["update-epic", "e1", `--attribute-commit=${a}`, `--attribute-commit=${b}`], { cwd });
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "e1").attributedCommits,
    [a, b]);
});

// ───────────────────────── 3. the guards that must NOT weaken ─────────────────────────

test("gh-182: a genuinely unknown flag is still refused by name", () => {
  const cwd = repo();
  run(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"], { cwd });
  const before = stateBytes(cwd);
  for (const argv of [
    ["update-epic", "a", "--titel", "Typo'd flag name"],
    ["update-epic", "a", "--titel=Typo'd flag name"],
    // The discriminating case: a typo'd flag standing where a value could have been. The
    // value-position rule must NOT swallow it, or the fix trades one silent failure for another.
    ["update-epic", "a", "--title", "--titel"],
  ]) {
    const err = expectFail(() => run(argv, { cwd }));
    assert.match(String(err.stderr || err.message), /unknown flag/,
      `\`${argv.join(" ")}\` must still be refused by name`);
    assert.match(String(err.stderr || err.message), /titel/);
  }
  assert.equal(stateBytes(cwd), before, "not one refusal may leave a write behind");
});

test("gh-182: --foo --bar (both known) still refuses rather than taking --bar as --foo's value", () => {
  const cwd = repo();
  run(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "a", "--title", "--status", "queued"], { cwd }));
  const msg = String(err.stderr || err.message);
  assert.match(msg, /--title requires/, "the refusal must name the flag whose value was missing");
  // Item 3: "this looks like a flag but arrived where a value was expected" is a DIFFERENT
  // message from "this flag name is unknown", and it names the flag it was filling plus the
  // escape. Reporting `--status` as an unknown flag is the bug this issue is about, pointed the
  // other way.
  assert.match(msg, /'--status'/, "…and quote the token that arrived in the value position");
  assert.match(msg, /--title=--status/, "…and show the = form that says it unambiguously");
  assert.doesNotMatch(msg, /unknown flag/, "a known flag in a value position is not an unknown flag");
  assert.equal(stateBytes(cwd), before);
  assert.equal(readState(cwd).epics.find(e => e.id === "a").title, "Original");
});

test("gh-182: a value-bearing flag with NO value at all is still refused", () => {
  const cwd = repo();
  run(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "a", "--plan"], { cwd }));
  assert.match(String(err.stderr || err.message), /--plan requires/);
  assert.equal(stateBytes(cwd), before);
});

test("gh-182: valueless flags are unaffected, adjacent to each other and to the = form", () => {
  const cwd = repo();
  run(["add-epic", "--id", "a", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--link", "relates-to:b:x"], { cwd });
  run(["update-epic", "a", "--clear-links", "--status=archived",
    "--outcome=delivered", "--no-deferrals"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "a");
  assert.deepEqual(e.links, []);
  assert.equal(e.status, "archived");
});

test("gh-182: a repeatable flag still repeats when its values begin with --", () => {
  const cwd = repo();
  run(["add-epic", "--id", "a", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "--story <n> is 1-indexed",
    "--add-story=--help says only <a value>"], { cwd });
  const titles = readState(cwd).epics.find(x => x.id === "a").stories.map(s => s.title);
  assert.deepEqual(titles, ["--story <n> is 1-indexed", "--help says only <a value>"],
    "both occurrences must land, in order — one form must not clobber the other");
});

// ─────────────── 4. the identical sibling: the unknown-flag scan (now the pre-dispatch check) ───────────────

test("gh-182: the unknown-flag scan reads a --value as a value, on the verbs requireKnownFlags() once guarded", () => {
  // THE DOMINANT DEFECT CLASS. `requireKnownFlags()` (add-epic.mjs) is a SECOND raw-argv scanner
  // and a flat for…of with no index, so it could not skip a value token — it re-emitted the
  // exact bug this issue reports on the five verbs that call it, long after parseFlags was
  // fixed. No existing test caught it because every one of them puts the unknown flag LAST.
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["claim", "e1", "--session", "--weird session name"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").claim.session, "--weird session name");

  // …and the = form on the same scan.
  run(["unclaim", "e1", "--session=--weird session name"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").claim, undefined);

  // …while the unknown-flag refusal those five verbs exist to make still fires.
  for (const argv of [
    ["claim", "e1", "--session", "s", "--bogus"],
    ["owners", "--bogus"],
    ["owners", "--bogus=x"],
    ["purge-logs", "--keep", "5", "--bogus"],
  ]) {
    const err = expectFail(() => run(argv, { cwd }));
    assert.match(String(err.stderr || err.message), new RegExp(`unknown flag --bogus for ${argv[0]}`),
      `\`${argv.join(" ")}\` must be refused by name`);
  }
});

test("gh-182: owners' positional scan skips a --value instead of reading it as an epic id", () => {
  // positionalArgs() in claims.mjs says in its own docstring that it "mirrors parseFlags' own
  // scan exactly". Two scanners, one rule: if it stops mirroring, a value lands in the id list.
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["claim", "e1", "--session", "s"], { cwd });
  const out = runCombined(["owners", "--json=x"], { cwd });
  // --json is valueless, so its = form is refused by name (verb-surface) rather than accepted with
  // the value ignored — which still proves it parsed as a FLAG, not as a positional.
  assert.match(out, /--json takes no value/,
    "the = form must at least parse into a flag rather than a positional");
});

test("gh-182: update-epic's --id diagnosis reads the = form, and keeps the flags it did not consume", () => {
  // The FOURTH raw-argv scanner. It rewrites the line the caller meant, so a form it cannot read
  // produces a suggestion that is wrong in a way the caller has no way to see.
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });

  const eq = String(expectFail(() => run(["update-epic", "--id=e1", "--priority", "P1"], { cwd })).stderr);
  assert.match(eq, /update-epic e1 --priority P1/, "the = form must be recognised and rewritten");

  // …and when `--id` carried NO value, at+1 is the next FLAG, not this flag's value. Dropping it
  // unconditionally silently deleted `--priority P1` from the suggested line.
  const none = String(expectFail(() => run(["update-epic", "--id", "--priority", "P1"], { cwd })).stderr);
  assert.match(none, /update-epic <id> --priority P1/,
    "a valueless --id must not eat the next flag out of the suggestion");
});

// ─────────────── 5. the predicate itself, against the registry ───────────────

test("gh-182: every registered flag name is recognised by isFlagToken", async () => {
  // The parser decides "value or flag?" with isFlagToken(). If a row is ever declared with a
  // capital, an underscore or a leading digit, that predicate silently reclassifies it as NOT a
  // flag and the parser starts EATING it as the previous flag's value — a wrong measurement that
  // looks correct everywhere downstream. Asserted against the registry so the row is what fails.
  const c = await import(new URL("../lib/constants.mjs", import.meta.url).href);
  const names = [...new Set([...c.EPIC_FLAGS, ...c.VERB_FLAGS].map(f => f.flag))];
  assert.ok(names.length > 50, `the registry projection is broken — only ${names.length} flags`);
  for (const n of names) {
    assert.ok(c.isFlagToken(`--${n}`), `--${n} must read as a flag token`);
    assert.ok(c.isFlagToken(`--${n}=v`), `--${n}=v must read as a flag token`);
  }
  // …and the shapes that must NOT read as flags, or the value position is useless.
  for (const t of [TITLE, "--story <n> is wrong", "-x", "plain", "--", "--a b"]) {
    assert.equal(c.isFlagToken(t), false, `'${t}' must not read as a flag token`);
  }
});
