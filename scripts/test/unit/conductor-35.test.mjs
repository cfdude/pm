// scripts/test/unit/conductor-35.test.mjs
// 4.1's migration of `assert/conductor-35.test.mjs` — 15 of its 20 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// #158 / the rules-block help pointer — help that answers the question actually asked.
//
// #158: `--help` was VERB-BLIND. conductor.mjs short-circuited on any `--help` ANYWHERE in argv
// and printed the global 48-verb USAGE line, so `update-epic --help` and a bare `--help` were
// byte-identical. The short-circuit itself is load-bearing and stays: it fixed `log-detour --help`
// writing a real detour entry with "--help" as its description, so a help flag must still reach no
// subcommand — which is why the no-side-effect test is here and asserted against the STORE's log.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIFTEEN moved: the two `cliFlagsFor` projection tests, the rendered-help family (verb-scoped help,
// global help, the flagless declaration, add-many's ghost check, the valueless/repeatable markers,
// help-before-init), the no-side-effect test, the whole emitted-pointer family, and the two pure
// registry invariants (the enum placeholders and the both-tables collision).
//
// FIVE STAY, and every one of them derives its population by READING `scripts/conductor.mjs`: the
// `dispatchedVerbs()` reader itself (a source scan of the dispatch table), the two sweeps built on
// it, the network-connection scan over every lib file, and the USAGE-vs-dispatch cross-check. That
// is the same reader conductor-25 and conductor-31 keep a copy of — nine lines, derived from the
// dispatch table on purpose so a verb added later cannot opt out of having help.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `detourLog(cwd)`                        →  `engine.store.exists("detours.log") ? store.read(…).text : ""`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;
const detourLog = (engine) =>
  engine.store.exists("detours.log") ? engine.store.read("detours.log").text : "";

// ═══════════════ the projection ═══════════════

unitTest("cliFlagsFor: add-many's CLI surface is --from, not its 14 batch-document keys", async () => {
  const { cliFlagsFor, flagsFor } = await import(CONSTANTS);
  const cli = cliFlagsFor("add-many");
  // `--force` is the argv-level row every mutating verb accepts (verb-surface D5) — the save
  // layer's flag, not add-many's parser's — so it is here too and is not a batch key.
  assert.deepEqual(cli, ["from", "force"],
    "add-many parses exactly one flag of its own; its EPIC_FLAGS rows are batch STATE keys");
  // The regression this test exists for: the old projection returned 15.
  assert.ok(flagsFor("add-many").length > cli.length,
    "flagsFor must still answer the ALLOWLIST question — this test is about not reusing it for help");
});

unitTest("cliFlagsFor: a normal verb is unchanged by the batch carve-out", async () => {
  const { cliFlagsFor, flagsFor } = await import(CONSTANTS);
  for (const verb of ["update-epic", "add-epic", "set-tracker", "purge-logs", "release"]) {
    assert.deepEqual(cliFlagsFor(verb).sort(), flagsFor(verb).sort(),
      `${verb} is not a batch-key command; its CLI surface is its whole registry surface`);
  }
});

// ═══════════════ the rendered help ═══════════════

unitTest("<verb> --help prints THAT verb's flags, not the global usage line", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["update-epic", "--help"]);
  assert.match(out, /update-epic/);
  for (const flag of ["--outcome", "--no-deferrals", "--attribute-commit", "--description"]) {
    assert.ok(out.includes(flag), `update-epic --help must list ${flag}`);
  }
  assert.ok(!out.includes("init|render|brief"),
    "a verb-scoped --help must NOT fall back to the global 48-verb usage blob");
});

unitTest("--help still answers globally when no verb is named", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["--help"]);
  assert.ok(out.includes("init|render|brief"), "bare --help keeps the global usage line");
});

unitTest("help declares a flagless verb explicitly rather than printing an empty list", async () => {
  const { FLAGLESS_VERBS } = await import(CONSTANTS);
  const engine = memoryEngine(emptyRecord());
  for (const verb of ["integrity", "verify-worktrees", "verify-state"]) {
    assert.ok(FLAGLESS_VERBS.includes(verb), `fixture assumes ${verb} is flagless`);
    const out = engine([verb, "--help"]);
    assert.match(out, /takes no flags/i,
      `${verb} --help must SAY it takes none — an empty list reads as "nobody declared this yet"`);
  }
});

unitTest("add-many --help does not advertise the 14 flags its parser ignores", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["add-many", "--help"]);
  assert.ok(out.includes("--from"), "add-many's one real flag");
  for (const ghost of ["--external-id", "--priority", "--lane", "--add-story"]) {
    assert.ok(!out.includes(ghost),
      `add-many --help must not advertise ${ghost}; the parser refuses it`);
  }
});

unitTest("help marks valueless and repeatable flags so a reader can invoke them correctly", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["update-epic", "--help"]);
  const line = (f) => out.split("\n").find(l => l.includes(f)) || "";
  assert.match(line("--no-deferrals"), /no value/i, "--no-deferrals takes no value");
  assert.match(line("--attribute-commit"), /repeatable/i, "--attribute-commit is repeatable");
});

unitTest("help still has NO side effect — the #158 short-circuit's original reason", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["log-detour", "--help"]);
  assert.ok(!detourLog(engine).includes("--help"),
    "`log-detour --help` must never write a detour entry — the bug the short-circuit fixed");
});

unitTest("help works before /pm:init — an uninitialized repo is exactly where you need it", () => {
  const engine = memoryEngine();
  const out = engine(["update-epic", "--help"]);
  assert.ok(out.includes("--outcome"), "help must not require an initialized repo");
});

// ═══════════════ the emitted pointer ═══════════════

const POINTER_PATTERNS = [
  [/--help/, "the local, version-exact channel"],
  [/pm-plugin\.dev\/llms\.txt/, "the docs index"],
  [/pm-plugin\.dev\/mcp/, "the no-auth MCP"],
  // Gate 2: the block previously said `conductor.mjs <verb> --help`, which is NOT runnable — a
  // bare binary name with no resolution, in a block that names no path anywhere. It now routes
  // through $ENGINE like every command doc, so THAT is what must be present.
  [/\$ENGINE/, "a resolvable engine invocation, not a bare binary name"],
  [/&lt;verb&gt;|<verb>/, "the verb placeholder the reader substitutes"],
];

unitTest("the emitted rules block routes a reader to help, on every platform", () => {
  const engine = memoryEngine(emptyRecord());
  for (const platform of ["claude-code", "hermes", "codex"]) {
    const out = engine(["rules", "--platform", platform]);
    for (const [re, what] of POINTER_PATTERNS) {
      assert.match(out, re, `${platform}: rules block must point at ${what}`);
    }
  }
});

unitTest("the pointer warns about version skew WITHOUT embedding a version", () => {
  // It must not name a number. conductor-15's 7.2 requires the block a repo reads to be identical
  // before and after an upgrade — a migration records behavior, it does not alter what anyone
  // reads — and any embedded version breaks that whichever source it comes from. An embedded
  // version is also a snapshot that goes stale the moment the plugin updates without /pm:upgrade
  // running here, which is the very skew the sentence exists to warn about. So it points at
  // `changelog`, which COMPUTES the answer.
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  const start = out.split("\n").findIndex(l => /getting help/i.test(l));
  const section = out.split("\n").slice(start, start + 14).join("\n");
  assert.match(section, /latest/i, "it must say the site documents the latest release");
  assert.match(section, /changelog/, "it must route to the verb that computes the real answer");
  assert.ok(!/\b\d+\.\d+\.\d+\b/.test(section),
    `the pointer must embed no version number; found one in:\n${section}`);
});

unitTest("the pointer cites the index and never llms-full.txt", () => {
  // A pure inverse assertion cannot tell "correct" from "absent": Gate 2 deleted the entire
  // pointer section and this test still passed. It now asserts the section is THERE and that the
  // thing it must not cite is not, so it can only pass for the right reason.
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  assert.ok(out.includes("llms.txt"), "the pointer must cite the index");
  assert.ok(!out.includes("llms-full"),
    "llms-full.txt is ~360KB — citing it hands the reader a context bomb");
});

unitTest("the emitted pointer stays small — it is paid for in every session of every repo", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  const start = out.split("\n").findIndex(l => /getting help/i.test(l));
  assert.notEqual(start, -1, "the pointer must be a findable section");
  const section = out.split("\n").slice(start).findIndex((l, i) => i > 0 && /^#{1,4} /.test(l));
  const lines = section === -1 ? out.split("\n").length - start : section;
  assert.ok(lines <= 12, `the help pointer is ${lines} lines; budget is 12`);
});

unitTest("every enum placeholder still matches the constant the engine enforces", async () => {
  // Four placeholders interpolate their constant directly; the rest are literals ONLY because
  // their constant is declared BELOW the flag tables and a template reference would hit the TDZ
  // at module load. A literal that cannot interpolate can still drift, so it is checked here —
  // binding the rule to a check rather than to whoever remembers.
  const c = await import(CONSTANTS);
  const { AGENT_OUTCOMES } = await import(new URL("../../lib/archive-gate.mjs", import.meta.url).href);
  const rows = [...c.EPIC_FLAGS, ...c.VERB_FLAGS];
  const spec = {
    lane: c.KNOWN_LANES, status: c.KNOWN_STATUSES, platform: c.KNOWN_PLATFORMS,
    mode: c.KNOWN_REVIEW_MODES, level: c.KNOWN_AUTONOMY_LEVELS,
    direction: c.KNOWN_TRACKER_DIRECTIONS,
    // `--outcome`'s constant lives OUTSIDE constants.mjs (archive-gate.mjs derives it from
    // disposition.mjs's KNOWN_OUTCOMES), so this row could never interpolate and was the one
    // enum placeholder nothing guarded. `declined` reached the engine and this literal in the
    // same release; the next growth is now caught here instead of by a reader.
    outcome: AGENT_OUTCOMES,
  };
  for (const [flag, values] of Object.entries(spec)) {
    const row = rows.find(r => r.flag === flag && r.placeholder);
    assert.ok(row, `${flag} lost its placeholder`);
    assert.deepEqual(row.placeholder.split("|"), values,
      `--${flag}'s placeholder has drifted from the constant the engine validates against`);
  }
});

unitTest("a flag claimed by BOTH tables for one command would resolve silently — assert none is", async () => {
  // flagSpecsFor resolves with rows.find() over [...EPIC_FLAGS, ...VERB_FLAGS], so a name claimed
  // by both tables for the same command takes the EPIC_FLAGS row's valueless/repeats/placeholder
  // with no error and no warning. Zero collisions today; this is what keeps it that way.
  const { EPIC_FLAGS, VERB_FLAGS } = await import(CONSTANTS);
  const seen = new Map();
  for (const [table, rows] of [["EPIC_FLAGS", EPIC_FLAGS], ["VERB_FLAGS", VERB_FLAGS]]) {
    for (const r of rows) for (const cmd of r.commands) {
      const key = `${cmd} --${r.flag}`;
      assert.ok(!seen.has(key), `${key} is declared in both ${seen.get(key)} and ${table}`);
      seen.set(key, table);
    }
  }
});
