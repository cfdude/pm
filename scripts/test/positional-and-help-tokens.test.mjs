// scripts/test/positional-and-help-tokens.test.mjs
// gh-186 and gh-187 — the two argv paths #182's fix could not reach.
//
// #182 made a FLAG VALUE able to begin with `--`. Two other places still refuse or swallow such a
// token, and both fail the same way: silently, with a zero exit or a message pointing at the wrong
// thing.
//
//   #186  `triage` takes its ask as a POSITIONAL, so #182's "a value-position token is the value"
//         rule has no preceding flag to establish the position. It refused any ask starting with
//         `--` — and CLAUDE.md makes `/pm:triage "<the ask, in its own words>"` STEP 1 of intake,
//         before any add-epic. An ask whose own words start with a flag name is exactly the case,
//         and rewording it defeats the lexical matching triage exists to do.
//
//   #187  A token exactly `--help` or `-h` ANYWHERE in argv short-circuits pre-dispatch and exits
//         0, so a command carrying it as a value prints help and writes nothing while looking like
//         it succeeded.
//
// Both fixes reuse `isFlagToken` from #182 rather than inventing a second rule. That predicate
// matches a token shaped EXACTLY like a flag (`--name` or `--name=…`), which is why an ask reading
// "--story <n> is 1-indexed" is text while a bare `--limit` is still a flag.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, runCombined, readState } from "./helpers.mjs";

const initialized = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };

/** The real title from cfdude/pm#176 — the ask that sent this whole thread off. */
const FLAG_LEADING_ASK = "--story <n> is 1-indexed but --help says only '<a value>'";

test("gh-186: triage accepts an ask whose own words begin with two dashes", () => {
  const cwd = initialized();
  const out = runCombined(["triage", FLAG_LEADING_ASK], { cwd });
  assert.doesNotMatch(out, /usage: conductor\.mjs triage/,
    "the ask is a POSITIONAL and triage takes exactly one, so a leading `--` is not ambiguous — " +
    "and CLAUDE.md makes this call step 1 of intake, before any add-epic");
  const parsed = JSON.parse(out.split("\n").filter(l => !l.startsWith("conductor:")).join("\n"));
  assert.equal(parsed.ask, FLAG_LEADING_ASK, "the ask survives verbatim — its flag names are the distinctive tokens triage matches on");
});

test("gh-186: a bare flag is still not an ask — the guard that made this hard is kept, narrowed", () => {
  const cwd = initialized();
  // `triage --limit 5` supplies no ask at all. Dropping the guard outright would read `--limit`
  // as the ask and return a scored, confident, meaningless result.
  const out = runCombined(["triage", "--limit", "5"], { cwd });
  assert.match(out, /usage: conductor\.mjs triage/,
    "a token shaped exactly like a flag is a flag, not an ask — this is what the original guard " +
    "was for, and narrowing it must not lose it");
});

test("gh-187: a --help in a value position REFUSES loudly instead of exiting 0 having written nothing", () => {
  const cwd = initialized();
  // The defect was never "the epic is not created" — under gh-182's shipped rule a token shaped
  // exactly like a flag IS a flag wherever it sits, so `--title --help` correctly leaves --title
  // with no value and must be refused. The defect was HOW it failed: the pre-dispatch
  // short-circuit printed help and exited 0, so a caller could not tell a refusal from a no-op,
  // and neither could a script. That is the silent-success shape, not a parsing question.
  const out = runCombined(["add-epic", "--id", "h1", "--title", "--help", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.doesNotMatch(out, /^usage: conductor\.mjs init\|render/m,
    "the global usage banner means the help short-circuit swallowed a token from a value position");
  assert.equal(readState(cwd).epics.length, 0, "and nothing was written, which is correct here");
  assert.match(out, /--help/, "the refusal names the token it could not use as a value");
});

test("gh-187: the `=` form is the escape, and it writes the value verbatim", () => {
  const cwd = initialized();
  runCombined(["add-epic", "--id", "h1", "--title=--help", "--lane", "claude-code",
               "--priority", "P2"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "h1");
  assert.ok(epic, "gh-182's `=` form reaches a value the bare form cannot");
  assert.equal(epic.title, "--help", "verbatim — this is the whole point of having an escape");
});

test("gh-187: help is still reachable, and still cannot be consumed as data by a subcommand", () => {
  const cwd = initialized();
  const first = runCombined(["--help"], { cwd });
  assert.match(first, /usage: conductor\.mjs/, "the bare global form still prints usage");
  const verbScoped = runCombined(["update-epic", "--help"], { cwd });
  assert.match(verbScoped, /update-epic/, "a help flag FIRST after the verb is still verb-scoped help (#158)");
});
