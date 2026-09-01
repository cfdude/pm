// #158 / the rules-block help pointer — help that answers the question actually asked.
//
// #158: `--help` was VERB-BLIND. conductor.mjs short-circuited on any `--help` ANYWHERE in argv
// and printed the global 48-verb USAGE line, so `update-epic --help` and a bare `--help` were
// byte-identical. The only way to learn a verb's flags was to read `scripts/lib/<verb>.mjs`, and
// a session upgrading another repo did exactly that. The short-circuit itself is load-bearing and
// stays: it fixed `log-detour --help` writing a real detour entry with "--help" as its
// description, so a help flag must still reach no subcommand.
//
// THE PROJECTION IS THE WHOLE DESIGN. Help reads the SAME registry rows the unknown-flag
// allowlists read, so it cannot advertise a flag the parser refuses — a hand-written help table
// would be #152's shape one question over. But `flagsFor()` is the wrong projection to reuse
// blind: it answers "which rows NAME this command", and `add-many`'s 14 EPIC_FLAGS rows exist so
// `epicBatchKeys()` can derive JSON STATE keys (`externalId`, not `--external-id`) while its
// parser takes exactly one flag, `--from`. Deriving help from `flagsFor()` would confidently
// advertise 14 flags add-many ignores — an authoritative wrong answer, worse than no help.
//
// So the ACCEPTANCE MODE is declared per COMMAND, not per row, exactly as FLAGLESS_VERBS already
// declares "this verb takes no flags" rather than leaving it an inferred remainder.
//
// The pointer half: the emitted rules block carried NO route to any of this. Measured across all
// 408 emitted lines and all three platform variants: 0 occurrences of `conductor.mjs`, of any
// http(s) URL, of `MCP`, of `--help`, of `pm-plugin.dev`, of `SKILL.md`, of `commands/`, of
// `README`. Meanwhile the block hardcodes eight flags in one add-epic recipe — it teaches flags
// by worked example and gives no way to enumerate them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, detourLog } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The verb names the engine actually dispatches. Third copy of this reader (conductor-25,
 *  conductor-31); duplicated for the same stated reason — nine lines, and the alternative edits a
 *  file every test module imports. Deriving the help sweep from the DISPATCH TABLE rather than
 *  from the registry is the point: a verb added later cannot quietly opt out of having help. */
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

// ═══════════════ the projection ═══════════════

test("cliFlagsFor: add-many's CLI surface is --from, not its 14 batch-document keys", async () => {
  const { cliFlagsFor, flagsFor } = await import(CONSTANTS);
  const cli = cliFlagsFor("add-many");
  assert.deepEqual(cli, ["from"],
    "add-many parses exactly one flag; its EPIC_FLAGS rows are batch STATE keys");
  // The regression this test exists for: the old projection returned 15.
  assert.ok(flagsFor("add-many").length > cli.length,
    "flagsFor must still answer the ALLOWLIST question — this test is about not reusing it for help");
});

test("cliFlagsFor: a normal verb is unchanged by the batch carve-out", async () => {
  const { cliFlagsFor, flagsFor } = await import(CONSTANTS);
  for (const verb of ["update-epic", "add-epic", "set-tracker", "purge-logs", "release"]) {
    assert.deepEqual(cliFlagsFor(verb).sort(), flagsFor(verb).sort(),
      `${verb} is not a batch-key command; its CLI surface is its whole registry surface`);
  }
});

test("every batch-key command is a real dispatched verb", async () => {
  const { BATCH_KEY_COMMANDS } = await import(CONSTANTS);
  const dispatched = dispatchedVerbs();
  for (const c of BATCH_KEY_COMMANDS) {
    assert.ok(dispatched.has(c), `BATCH_KEY_COMMANDS names '${c}', which the engine does not dispatch`);
  }
});

// ═══════════════ the rendered help ═══════════════

test("<verb> --help prints THAT verb's flags, not the global usage line", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["update-epic", "--help"], { cwd });
  assert.match(out, /update-epic/);
  for (const flag of ["--outcome", "--no-deferrals", "--attribute-commit", "--description"]) {
    assert.ok(out.includes(flag), `update-epic --help must list ${flag}`);
  }
  assert.ok(!out.includes("init|render|brief"),
    "a verb-scoped --help must NOT fall back to the global 48-verb usage blob");
});

test("--help still answers globally when no verb is named", () => {
  const cwd = tmpRepo();
  const out = run(["--help"], { cwd });
  assert.ok(out.includes("init|render|brief"), "bare --help keeps the global usage line");
});

test("help declares a flagless verb explicitly rather than printing an empty list", async () => {
  const { FLAGLESS_VERBS } = await import(CONSTANTS);
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const verb of ["integrity", "snapshot", "set-active"]) {
    assert.ok(FLAGLESS_VERBS.includes(verb), `fixture assumes ${verb} is flagless`);
    const out = run([verb, "--help"], { cwd });
    assert.match(out, /takes no flags/i,
      `${verb} --help must SAY it takes none — an empty list reads as "nobody declared this yet"`);
  }
});

// ═══════════════ the ghost sweep — EVERY verb, not one ═══════════════

test("no verb's help advertises a flag that verb's parser refuses", async () => {
  // Gate 2 found this the moment it was written mechanically: `add-epic --help` printed
  // `--clear-links`, which add-epic refuses. The cause was `requires` doing double duty as both
  // the refusal tail and the help signature — `--link`'s ends "...say so with --clear-links" —
  // so the ghost was TEXT inside another flag's placeholder, which no per-verb spot check would
  // ever have been shaped to catch.
  //
  // The previous version of this test hardcoded four ghost names on ONE verb. That is the
  // sibling-miss this repo's gate procedure names as its dominant defect class: a guard at one
  // call site while 47 identical ones go unchecked. This asserts the INVARIANT over the whole
  // dispatch table, so a row added later is covered without anyone remembering to extend a list.
  const { cliFlagsFor } = await import(CONSTANTS);
  const { verbHelp } = await import(new URL("../lib/help.mjs", import.meta.url).href);
  const ghosts = [];
  for (const verb of dispatchedVerbs()) {
    const accepted = new Set(cliFlagsFor(verb));
    for (const m of new Set([...verbHelp(verb).matchAll(/--([a-z][a-z0-9-]*)/g)].map(x => x[1]))) {
      if (!accepted.has(m)) ghosts.push(`${verb} --help advertises --${m}, which it refuses`);
    }
  }
  assert.deepEqual(ghosts, [], ghosts.join("\n"));
});

test("add-many --help does not advertise the 14 flags its parser ignores", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["add-many", "--help"], { cwd });
  assert.ok(out.includes("--from"), "add-many's one real flag");
  for (const ghost of ["--external-id", "--priority", "--lane", "--add-story"]) {
    assert.ok(!out.includes(ghost),
      `add-many --help must not advertise ${ghost}; the parser refuses it`);
  }
});

test("help marks valueless and repeatable flags so a reader can invoke them correctly", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["update-epic", "--help"], { cwd });
  const line = (f) => out.split("\n").find(l => l.includes(f)) || "";
  assert.match(line("--no-deferrals"), /no value/i, "--no-deferrals takes no value");
  assert.match(line("--attribute-commit"), /repeatable/i, "--attribute-commit is repeatable");
});

test("every dispatched verb renders help, exits 0, and names itself", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const verb of dispatchedVerbs()) {
    const out = run([verb, "--help"], { cwd });
    assert.ok(out.trim().length > 0, `${verb} --help produced nothing`);
    // `out.includes(verb)` ALONE is vacuous: the global USAGE line names all 48 verbs, so it
    // would pass for every verb even with this fix reverted. Asserting the global blob is ABSENT
    // is what makes this a real sweep — neutered by removing the verb-scoped branch, it fails 48
    // times rather than 0.
    assert.ok(!out.includes("init|render|brief"),
      `${verb} --help fell through to the global usage blob`);
    assert.ok(out.includes(verb), `${verb} --help must name the verb it describes`);
  }
});

test("help still has NO side effect — the #158 short-circuit's original reason", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["log-detour", "--help"], { cwd });
  assert.ok(!detourLog(cwd).includes("--help"),
    "`log-detour --help` must never write a detour entry — the bug the short-circuit fixed");
});

test("help works before /pm:init — an uninitialized repo is exactly where you need it", () => {
  const cwd = tmpRepo();
  const out = run(["update-epic", "--help"], { cwd });
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

test("the emitted rules block routes a reader to help, on every platform", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const platform of ["claude-code", "hermes", "codex"]) {
    const out = run(["rules", "--platform", platform], { cwd });
    for (const [re, what] of POINTER_PATTERNS) {
      assert.match(out, re, `${platform}: rules block must point at ${what}`);
    }
  }
});

test("the pointer warns about version skew WITHOUT embedding a version", () => {
  // It must not name a number. conductor-15's 7.2 requires the block a repo reads to be identical
  // before and after an upgrade — a migration records behavior, it does not alter what anyone
  // reads — and any embedded version breaks that whichever source it comes from. An embedded
  // version is also a snapshot that goes stale the moment the plugin updates without /pm:upgrade
  // running here, which is the very skew the sentence exists to warn about. So it points at
  // `changelog`, which COMPUTES the answer.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  const start = out.split("\n").findIndex(l => /getting help/i.test(l));
  const section = out.split("\n").slice(start, start + 14).join("\n");
  assert.match(section, /latest/i, "it must say the site documents the latest release");
  assert.match(section, /changelog/, "it must route to the verb that computes the real answer");
  assert.ok(!/\b\d+\.\d+\.\d+\b/.test(section),
    `the pointer must embed no version number; found one in:\n${section}`);
});

test("the pointer cites the index and never llms-full.txt", () => {
  // A pure inverse assertion cannot tell "correct" from "absent": Gate 2 deleted the entire
  // pointer section and this test still passed. It now asserts the section is THERE and that the
  // thing it must not cite is not, so it can only pass for the right reason.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.ok(out.includes("llms.txt"), "the pointer must cite the index");
  assert.ok(!out.includes("llms-full"),
    "llms-full.txt is ~360KB — citing it hands the reader a context bomb");
});

test("the emitted pointer stays small — it is paid for in every session of every repo", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  const start = out.split("\n").findIndex(l => /getting help/i.test(l));
  assert.notEqual(start, -1, "the pointer must be a findable section");
  const section = out.split("\n").slice(start).findIndex((l, i) => i > 0 && /^#{1,4} /.test(l));
  const lines = section === -1 ? out.split("\n").length - start : section;
  assert.ok(lines <= 12, `the help pointer is ${lines} lines; budget is 12`);
});

test("the engine still opens no network connection — the pointer is an INSTRUCTION", () => {
  const engineSrc = fs.readdirSync(path.join(REPO, "scripts", "lib"))
    .filter(f => f.endsWith(".mjs"))
    .map(f => fs.readFileSync(path.join(REPO, "scripts", "lib", f), "utf8")).join("\n")
    + fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  for (const forbidden of [/\bfetch\s*\(/, /node:https?\b/, /require\(['"]https?['"]\)/]) {
    assert.ok(!forbidden.test(engineSrc),
      `the engine must never open a connection (matched ${forbidden}) — pm is an instruction layer`);
  }
});

test("every enum placeholder still matches the constant the engine enforces", async () => {
  // Four placeholders interpolate their constant directly; the rest are literals ONLY because
  // their constant is declared BELOW the flag tables and a template reference would hit the TDZ
  // at module load. A literal that cannot interpolate can still drift, so it is checked here —
  // binding the rule to a check rather than to whoever remembers.
  const c = await import(CONSTANTS);
  const rows = [...c.EPIC_FLAGS, ...c.VERB_FLAGS];
  const spec = {
    lane: c.KNOWN_LANES, status: c.KNOWN_STATUSES, platform: c.KNOWN_PLATFORMS,
    mode: c.KNOWN_REVIEW_MODES, level: c.KNOWN_AUTONOMY_LEVELS,
    direction: c.KNOWN_TRACKER_DIRECTIONS,
  };
  for (const [flag, values] of Object.entries(spec)) {
    const row = rows.find(r => r.flag === flag && r.placeholder);
    assert.ok(row, `${flag} lost its placeholder`);
    assert.deepEqual(row.placeholder.split("|"), values,
      `--${flag}'s placeholder has drifted from the constant the engine validates against`);
  }
});

test("a flag claimed by BOTH tables for one command would resolve silently — assert none is", async () => {
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

test("USAGE and the dispatch table agree in BOTH directions", () => {
  // conductor.mjs derives the help-eligible verb list by splitting USAGE, so a verb listed there
  // but no longer dispatched would render help from its rows and then fail on real invocation.
  // The forward direction (dispatched but absent from USAGE) is covered by the sweep above; this
  // is the reverse, which nothing checked.
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const usage = src.match(/const USAGE = "usage: conductor\.mjs ([^\\]+)/)[1].split("|");
  const dispatched = dispatchedVerbs();
  assert.deepEqual(usage.filter(v => !dispatched.has(v)), [],
    "USAGE names a verb the engine no longer dispatches");
  assert.deepEqual([...dispatched].filter(v => !usage.includes(v)), [],
    "the engine dispatches a verb USAGE does not name");
});
