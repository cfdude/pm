// scripts/test/gate-guard-write-paths.test.mjs
// the-guard-covers-every-write-path — the gate guard covers Bash write shapes.
//
// The guard was registered for `Edit|Write|NotebookEdit` only, so an agent blocked on `Edit` wrote
// the same file with `cat > f <<EOF`, `sed -i` or `tee` in one hop, and the block's own message
// claimed "Completing the reconcile gate is the only way through" while that was false as shipped.
//
// What this file pins, in three layers:
//   1. the closed write-shape list and its exclusions, over the exported function directly;
//   2. the hook's behaviour end to end, over a real fixture repo that owes a reconcile;
//   3. the shipped matcher, and that the list has exactly one definition site.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeShape, isEngineInvocation, WRITE_SHAPE_LABELS } from "../lib/gate-guard.mjs";

const LABELS = Object.values(WRITE_SHAPE_LABELS);

// ─────────────── 1.1 — the closed list and its exclusions (design D2) ───────────────

/** Commands that MUST match a shape. A write performed by any of these is a write the reconcile
 *  gate exists to stop, and each was reproduced on the prototype battery before it shipped. */
const BLOCKS = [
  // redirection into a file, in every spelling the shell offers
  "cat > src/x.js <<EOF",
  "printf x >> f",
  "awk '{print}' f > out.txt",
  "cmd &> out.txt",
  "cmd &>> out.txt",
  "cmd >| out.txt",
  "node --test >& out.txt",
  // multi-digit file descriptors: the fd was one optional digit behind a negated class that also
  // excluded digits, so every one of these passed until the cross-spec fix
  "cmd 10>out.txt",
  "exec 10>lockfile",
  "cmd 12>>out.txt",
  "cmd 1>out.txt",
  // in-place stream editors, short and long spellings
  "sed -i '' s/a/b/ f.js",
  "sed --in-place s/a/b/ f.js",
  "sed --in-place=.bak s/a/b/ f.js",
  "perl -i -pe s/a/b/ f.js",
  // tee, copiers, patchers
  "tee -a notes.txt",
  "cp a b",
  "mv a b",
  "truncate -s 0 f",
  "git apply p.patch",
  // destroying the conductor record turns the guard OFF, which is larger than the write it stands
  // in for: gateGuardCheck() returns at isInitialized() once the file is gone
  "rm .conductor/state.json",
  "rm -rf .conductor",
  "rm -rf .conductor/*",
  "rm '.conductor/state.json'",
  'rm "/Users/r/Repos/pm/.conductor/state.json"',
  "rm -rf /Users/r/Repos/pm/.conductor",
  "mv .conductor/state.json /tmp/x",
  "truncate -s 0 .conductor/state.json",
  // a TRAILING GLOB names the record among its expansions — the discriminator is the WRITTEN
  // ARGUMENT, not the file it reaches. The first fix matched the quoted, absolute and `/*` forms
  // and let these through, which turns the guard off just as thoroughly.
  "rm -rf .conductor/state.json*",
  "rm .conductor/state.json*",
  "rm -rf .conductor*",
];

/** Commands that MUST NOT match. A guard that blocks these is a guard that gets routed around. */
const ALLOWS = [
  "rg foo 2>/dev/null",
  "cmd >&2",
  "cmd >&-",
  "cmd > /dev/null 2>&1",
  "node --test 2>&1 | tail",
  "cmd 10>&1",                       // a multi-digit fd DUPLICATION stays a duplication
  "git status --short",
  "diff <(a) <(b)",
  "for f in *; do echo $f; done",
  "curl -s url | jq .",
  "tee /dev/null",
  "[ 3 -gt 2 ] && echo yes",
  // the arrow: this repository mandates `rg`, whose patterns carry it routinely
  "rg 'foo->bar' src/",
  "git log --format='%h -> %s'",
  'echo "a -> b"',
  // the lock remedy the engine itself prints, and the glob that cannot expand to the record
  "rm .conductor/state.json.lock",
  "rm -r .conductor/state.json.lock",
  "rm '.conductor/state.json.lock'",
  "rm .conductor/state.json.*",
  "rm -rf .conductor/state.json.*",
  "rm -rf .conductorish",
  // touch and mkdir create without content — not the skip this gate exists to stop
  "touch src/x.js",
  "mkdir -p src",
  // every engine invocation the gate names as its own exit, in BOTH spellings pm emits
  'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile p --detour d --verdict valid --amendments none',
  "node scripts/conductor.mjs pop-detour p",
  'node "$ENGINE" drop-detour p --reason "stale frame"',
  'node "$ENGINE" record-gate-review e --gate 2 --verdict pass',
  'node scripts/conductor.mjs update-epic e --notes "lane: claude-code not openspec -> small"',
  'node scripts/conductor.mjs record-reconcile p --detour d --verdict invalidated --amendment "story 3 -> story 4"',
];

test("1.1 every recognized write shape is matched", () => {
  for (const cmd of BLOCKS) {
    const label = writeShape(cmd);
    assert.ok(label, `expected a write shape for: ${cmd}`);
    assert.ok(LABELS.includes(label),
      `the return value must be a FIXED label from the closed list, got ${JSON.stringify(label)} for: ${cmd}`);
  }
});

test("1.1 no read-only command, lock remedy or engine invocation is matched", () => {
  for (const cmd of ALLOWS) {
    assert.equal(writeShape(cmd), null, `expected no write shape for: ${cmd}`);
  }
});

test("1.1 the return value carries no text taken from the command", () => {
  // A "no substring of the input" assertion is unsatisfiable — a single character of the command is
  // a substring of it. What is checkable is that the label is one of the closed set's members, and
  // that it holds neither the target path nor the unusual sequence written into it.
  const odd = "zq7-marker-zq7";
  const label = writeShape(`cat > src/${odd}/x.js <<EOF`);
  assert.equal(label, WRITE_SHAPE_LABELS.redirect);
  assert.ok(!label.includes(odd), "the label must not carry the command's own text");
  assert.ok(!label.includes("src/"), "the label must not carry the target path");
  for (const cmd of BLOCKS) assert.ok(LABELS.includes(writeShape(cmd)));
});

test("1.1 the labels are a frozen closed set", () => {
  assert.ok(Object.isFrozen(WRITE_SHAPE_LABELS), "the label table is the closed list's single site");
  assert.ok(LABELS.every(l => typeof l === "string" && l.length > 0));
  assert.equal(new Set(LABELS).size, LABELS.length, "no two rows share a label");
});

// ─────────────── 1.1b — the engine-invocation exemption's only falsifiable surface ───────────────
//
// Under the list as it stands NO command-word row is reachable from a `node`-led segment: the arm
// reads the segment's LEADING word, which for an engine invocation is always the runtime. So the
// exemption cannot change any command's outcome today and a case-based check of the guard's exit
// codes cannot fail when its CALL SITE is removed. The predicate itself is therefore asserted
// directly, so that DELETING it is detectable — and the `gate-integrity` delta carries the forward
// commitment that any future row keyed on something other than the leading command word must
// re-establish reachability before it ships.

test("1.1b the engine-invocation predicate recognizes both spellings pm emits", () => {
  assert.equal(typeof isEngineInvocation, "function",
    "the predicate is EXPORTED because it is the exemption's only falsifiable surface");
  const engine = [
    ["node", ['"${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs"', "pop-detour", "p"]],
    ["node", ['"$ENGINE"', "record-reconcile", "p", "--detour", "d"]],
    ["node", ["${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs", "update-epic", "e"]],
    ["node", ["scripts/conductor.mjs", "status"]],
  ];
  for (const [word, rest] of engine) {
    assert.equal(isEngineInvocation(word, rest), true, `expected an engine invocation: node ${rest.join(" ")}`);
  }
});

test("1.1b the predicate is not an exemption for a spelling pm never emits", () => {
  const notEngine = [
    ["node", ["--test", "scripts/test/x.test.mjs"]],       // a test flag, not a verb
    ["node", ["-e", "require('fs').writeFileSync('x','q')"]],
    ["node", ['"$ENGINE"']],                                // no verb follows
    ["rm", ['"$ENGINE"', "status"]],                        // not a runtime
    ["node", ["other.mjs", "status"]],                      // not the engine
  ];
  for (const [word, rest] of notEngine) {
    assert.equal(isEngineInvocation(word, rest), false, `expected NOT an engine invocation: ${word} ${rest.join(" ")}`);
  }
});

test("1.1b the exemption covers the command-word arm only — a redirection still blocks", () => {
  assert.equal(writeShape("node scripts/conductor.mjs status > out.txt"), WRITE_SHAPE_LABELS.redirect,
    "an exemption that swallowed redirections would make prefixing a command with an engine " +
    "invocation a one-line bypass of the whole gate");
  assert.equal(writeShape('node "$ENGINE" drop-detour p --reason "x" >> log.txt'), WRITE_SHAPE_LABELS.redirect);
});

test("1.1b an UNFILLED command template blocks, and the filled command passes", () => {
  // Accepted and PRE-EXISTING (design D7): `<id>`/`<sha>` are input redirections, so an unfilled
  // template is already broken at the shell. The block removes nothing that would otherwise run.
  assert.ok(writeShape('node "$ENGINE" update-epic <id> --attribute-commit <sha>'));
  assert.equal(writeShape('node "$ENGINE" update-epic e --attribute-commit abc1234'), null);
});
