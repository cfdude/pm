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
import { tmpRepo, run, runCombined, detourLog } from "../fixtures/assert-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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
  // THE INDENT IS PART OF THE SHAPE, and 0.47.0 (task 2.3) moved the dispatch table two spaces to
  // the right by wrapping conductor.mjs's module body in `main(argv, io)`. A reader pinned to
  // EXACTLY two spaces found nothing, and the guard that exists to catch a missing VERB_EFFECTS
  // row went green against an EMPTY set — caught by its own "the reader is broken, not the table"
  // assertion, which is why that assertion exists. The band `2,4` accepts either shape and refuses
  // anything deeper, so a table nested one level further down still fails rather than silently
  // matching a handler's own line.
  for (const m of table.matchAll(/^ {2,4}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2,4}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

// 4.1 (0.48.0) moved FIFTEEN of this file's twenty tests to
// `scripts/test/unit/conductor-35.test.mjs`: the projection pair, the rendered-help family, the
// emitted pointer family and the two pure registry invariants. THE FIVE BELOW STAY because every one
// of them derives its population by READING `scripts/conductor.mjs` — the `dispatchedVerbs()` source
// scan of the dispatch table (and the two sweeps built on it), the network-connection scan over every
// lib file, and the USAGE-vs-dispatch cross-check. That reader is deliberately duplicated rather than
// shared: nine lines, and the alternative edits a file every test module imports.

// ═══════════════ the projection ═══════════════

test("every batch-key command is a real dispatched verb", async () => {
  const { BATCH_KEY_COMMANDS } = await import(CONSTANTS);
  const dispatched = dispatchedVerbs();
  for (const c of BATCH_KEY_COMMANDS) {
    assert.ok(dispatched.has(c), `BATCH_KEY_COMMANDS names '${c}', which the engine does not dispatch`);
  }
});

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
  const { verbHelp } = await import(new URL("../../lib/help.mjs", import.meta.url).href);
  const ghosts = [];
  for (const verb of dispatchedVerbs()) {
    const accepted = new Set(cliFlagsFor(verb));
    for (const m of new Set([...verbHelp(verb).matchAll(/--([a-z][a-z0-9-]*)/g)].map(x => x[1]))) {
      if (!accepted.has(m)) ghosts.push(`${verb} --help advertises --${m}, which it refuses`);
    }
  }
  assert.deepEqual(ghosts, [], ghosts.join("\n"));
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

test("the engine still opens no network connection — the pointer is an INSTRUCTION", () => {
  const engineSrc = fs.readdirSync(path.join(REPO, "scripts", "lib"))
    .filter(f => f.endsWith(".mjs"))
    .map(f => fs.readFileSync(path.join(REPO, "scripts", "lib", f), "utf8")).join("\n")
    + fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  // WIDENED IN 0.49.0 (task 3.3): the set named only `fetch(` and the HTTP modules, and a raw socket
  // (`node:net`), a TLS socket (`node:tls`), a datagram (`node:dgram`) or HTTP/2 (`node:http2`) opens
  // a connection just as surely. It was widened in the change that added `runtime-support.mjs`, a
  // module whose subject is an external schedule — exactly the temptation this law guards against.
  const NET = "https?|http2|net|tls|dgram";
  for (const forbidden of [/\bfetch\s*\(/, new RegExp(`node:(?:${NET})\\b`), new RegExp(`require\\(['"](?:node:)?(?:${NET})['"]\\)`)]) {
    assert.ok(!forbidden.test(engineSrc),
      `the engine must never open a connection (matched ${forbidden}) — pm is an instruction layer`);
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
