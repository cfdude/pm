// scripts/test/unit/gate-guard-write-paths.test.mjs
// 4.1's migration of `assert/gate-guard-write-paths.test.mjs` — 27 of its 33 tests, moved from the
// file rung to the unit rung with every assertion unchanged.
//
// the-guard-covers-every-write-path — the gate guard covers Bash write shapes.
//
// The guard was registered for `Edit|Write|NotebookEdit` only, so an agent blocked on `Edit` wrote
// the same file with `cat > f <<EOF`, `sed -i` or `tee` in one hop, and the block's own message
// claimed "Completing the reconcile gate is the only way through" while that was false as shipped.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWENTY-SEVEN moved — layer 1 (the closed list and its exclusions, over the exported function), the
// whole layer 2 (the hook end to end), the tracker-refresh arm, both "nothing today's behaviour
// moves" guards, the two through-the-hook scenarios and the marker remedy's own row.
//
// THE FIXTURE IS WHY THE HOOK FAMILY COULD MOVE AT ALL. `owingRepo()` was `fixtureOnce`-snapshotted
// because it cost 133 ms to build — an init plus five verbs — and this file called it a dozen times.
// Over the memory store the same five verbs cost about a millisecond, and the state they build is the
// state the guard READS: a live active epic that owes a reconcile. Nothing in the tree is the
// observable; the exit code and the block's text are.
//
// SIX STAY: the two 1.3 source scans (the closed list must appear in `gate-guard.mjs` and nowhere
// else, which is a walk over the engine's sources), the three 2.5 tests (an unreadable record is RAW
// BYTES with a conflict marker in front, which the memory store cannot hold), and 3.1 (the shipped
// `hooks/hooks.json` matcher).

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { writeShape, isEngineInvocation, WRITE_SHAPE_LABELS } from "../../lib/gate-guard.mjs";

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
  // 4.8 (G2-M1): every DECLARED command word gets a behavioural case. Removing `"rsync"` from the
  // list used to be caught only by 1.3's source scan, which asserts the row is declared and not
  // that anything honours it — the half-checked guard of docs/lessons/a-guard-can-check-the-wrong-half.
  "install -m 644 a b",
  "rsync -a src/ dst/",
  "dd if=a of=b",
  "patch -p1 -i p.diff",
  // 4.7 (G2-I2): the scan is PER SEGMENT, and the segment carrying the write is not the first. This
  // is pm's own emitted marker remedy, and slicing `segments()` to the first segment left the whole
  // suite green until this row existed.
  "rg foo && sed -i.bak '7d' CLAUDE.md",
  "git status --short; cat > src/x.js <<EOF",
  "cat notes\nsed -i '' s/a/b/ src/x.js",
  // 4.6 (G2-I1): destroying the record through git. `rm` alone left `git rm -f .conductor/state.json`
  // allowed, and a removed record leaves the guard DORMANT — the whole gate off, not one write past
  // it. `-C` is this repo's own mandated spelling, so the subcommand is read after git's globals.
  "git rm -f .conductor/state.json",
  "git rm .conductor/state.json",
  "git -C /Users/r/Repos/pm rm -f .conductor/state.json",
  "git -c commit.gpgsign=false rm .conductor/state.json",
  "git --git-dir=/tmp/g rm .conductor/state.json",
  "git -p rm .conductor/state.json",              // `-p` takes no value: it must not swallow `rm`
  "git rm -r .conductor",
  "git mv .conductor/state.json /tmp/x",
  // …and the same reader closes `git -C <path> apply`, which evaded the shipped `git apply` row
  "git -C /Users/r/Repos/pm apply p.patch",
  "git -c user.name=x apply p.patch",
  // the record's own removers under their other names
  "unlink .conductor/state.json",
  "shred -u .conductor/state.json",
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
  // 4.6: a path that is git's GLOBAL OPTION VALUE is not a file the subcommand acts on. Reading the
  // record rows over the whole of `rest` would block a read of the record's own directory.
  "git -C .conductor status",
  "git -C .conductor log --oneline",
  "git -C /Users/r/Repos/pm status --short",
  "git rm src/x.js",                              // `git rm` is on the list for the RECORD only
  "git mv src/a src/b",
  "git -p rm .conductor/state.json.lock",         // the lock remedy, through a valueless global flag
  "unlink src/x.js",
  "shred -u src/x.js",
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

unitTest("1.1 every recognized write shape is matched", () => {
  for (const cmd of BLOCKS) {
    const label = writeShape(cmd);
    assert.ok(label, `expected a write shape for: ${cmd}`);
    assert.ok(LABELS.includes(label),
      `the return value must be a FIXED label from the closed list, got ${JSON.stringify(label)} for: ${cmd}`);
  }
});

unitTest("1.1 no read-only command, lock remedy or engine invocation is matched", () => {
  for (const cmd of ALLOWS) {
    assert.equal(writeShape(cmd), null, `expected no write shape for: ${cmd}`);
  }
});

unitTest("1.1 the return value carries no text taken from the command", () => {
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

unitTest("1.1 the labels are a frozen closed set", () => {
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

unitTest("1.1b the engine-invocation predicate recognizes both spellings pm emits", () => {
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

unitTest("1.1b the predicate is not an exemption for a spelling pm never emits", () => {
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

unitTest("1.1b the exemption covers the command-word arm only — a redirection still blocks", () => {
  assert.equal(writeShape("node scripts/conductor.mjs status > out.txt"), WRITE_SHAPE_LABELS.redirect,
    "an exemption that swallowed redirections would make prefixing a command with an engine " +
    "invocation a one-line bypass of the whole gate");
  assert.equal(writeShape('node "$ENGINE" drop-detour p --reason "x" >> log.txt'), WRITE_SHAPE_LABELS.redirect);
});

unitTest("1.1b an UNFILLED command template blocks, and the filled command passes", () => {
  // Accepted and PRE-EXISTING (design D7): `<id>`/`<sha>` are input redirections, so an unfilled
  // template is already broken at the shell. The block removes nothing that would otherwise run.
  assert.ok(writeShape('node "$ENGINE" update-epic <id> --attribute-commit <sha>'));
  assert.equal(writeShape('node "$ENGINE" update-epic e --attribute-commit abc1234'), null);
});

// ─────────────── 2 — the guard reads the payload it used to drain and discard ───────────────

const guard = (engine, payload) => {
  return engine.result(["gate-guard"], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
};
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

/** A record whose live active epic `p` owes a reconcile — pushed `--reconcile`, then popped.
 *
 *  THIS IS THE FIXTURE THE FILE RUNG SNAPSHOTTED. There it was `fixtureOnce`-built because an init
 *  plus five verbs cost 133 ms and the file called it a dozen times; over the memory store the same
 *  five verbs build the same RECORD, which is the whole of what the guard reads. Each call returns a
 *  FRESH engine, so a test that mutates the record cannot reach the next test's — the property the
 *  snapshot's per-test copy was there to provide. */
const owingRepo = () => {
  const engine = memoryEngine(emptyRecord());
  for (const id of ["p", "d"]) engine(["add-epic", "--id", id, "--lane", "claude-code", "--title", id]);
  engine(["set-active", "p"]);
  engine(["push-detour", "p", "--detour", "d", "--reason", "it touched shared code", "--reconcile"]);
  engine(["pop-detour", "p"]);
  return engine;
};

unitTest("2.1 a heredoc redirection is blocked while a reconcile is owed, and the block names the shape", () => {
  const engine = owingRepo();
  const r = guard(engine, bash("cat > src/x.js <<EOF\nq\nEOF"));
  assert.equal(r.status, 2, `expected a block, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /still owes a reconcile/);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.redirect),
    `the block must name the matched shape's fixed label; stderr was:\n${r.stderr}`);
});

unitTest("4.7 the hook reads the WHOLE command, not its first line", () => {
  // `lessons.mjs` reads line one only, by an explicit precision decision; this reader must not.
  // Reducing the read to line one left the entire suite green — `writeShape` splits on `\n` itself,
  // so no UNIT row can reach that mutant. Only a payload whose write is on a later line can.
  const engine = owingRepo();
  const r = guard(engine, bash("rg foo src/\nsed -i '' s/a/b/ src/x.js"));
  assert.equal(r.status, 2, `a write on line 2 must block; got ${r.status}: ${r.stderr}`);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.inPlace), r.stderr);
});

unitTest("4.6 destroying the record through git is blocked, and a git read of it is not", () => {
  // The demonstrated end-to-end bypass: `rm` blocked, `git rm` allowed, and with the record gone the
  // guard returns at isInitialized() so every previously-blocked shape passes.
  const engine = owingRepo();
  for (const command of [
    "git rm -f .conductor/state.json",
    "git -C /Users/r/Repos/pm rm -f .conductor/state.json",
    "unlink .conductor/state.json",
  ]) {
    const r = guard(engine, bash(command));
    assert.equal(r.status, 2, `expected a block for ${command}: ${r.stderr}`);
    assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.record), r.stderr);
  }
  const ok = guard(engine, bash("git -C .conductor status --short"));
  assert.equal(ok.status, 0, `a read of the record's directory must stay runnable: ${ok.stderr}`);
});

unitTest("2.1 an in-place stream editor is blocked", () => {
  const engine = owingRepo();
  const r = guard(engine, bash("sed -i '' s/a/b/ src/x.js"));
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.inPlace), r.stderr);
});

unitTest("2.1 the block message carries a label, not the command", () => {
  const engine = owingRepo();
  const odd = "zq7-marker-zq7";
  const r = guard(engine, bash(`cat > src/${odd}/x.js <<EOF`));
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.redirect), r.stderr);
  assert.ok(!r.stderr.includes(odd), "no text taken from the command reaches the message");
  assert.ok(!r.stderr.includes("src/"), "not the target path either");
});

unitTest("2.1 the block states the obligation the check cannot enforce", () => {
  // The check is incomplete by construction — `eval`, a variable-built path, a script by name and an
  // interpreter given inline source all pass — so the message carries the instruction the mechanism
  // cannot. Today's "Completing the reconcile gate is the only way through" is DROPPED: this change
  // does not make it true either.
  const engine = owingRepo();
  const r = guard(engine, bash("cat > src/x.js <<EOF"));
  assert.match(r.stderr, /Bash write is forbidden/i);
  assert.ok(!/only way through/.test(r.stderr),
    "the sentence this change does not make true must be gone, not re-justified");
});

unitTest("2.8b REGRESSION GUARD: the guard setting does not reach the Bash arm of the reconcile block", () => {
  // Pins the property against the natural wrong implementation, in which the reconcile and tracker
  // arms share one flag-gated shape check. A switch that silenced Bash writes here would be a bypass
  // for the whole reconcile gate — which is the defect this change closes.
  const engine = owingRepo();
  engine(["set-gate-guard", "off"]);
  assert.equal(guard(engine, bash("cat > src/x.js <<EOF")).status, 2, "`set-gate-guard off` must not reach it");
  assert.equal(guard(engine, { tool_name: "Edit", tool_input: {} }).status, 2);
});

unitTest("2.8c a payload naming Bash with no readable command blocks", () => {
  // An undecidable Bash call takes the block, never the allow — the same principle that governs an
  // unidentifiable tool. Fails against the natural wrong implementation, in which
  // `tool_name === "Bash"` alone selects the allow path.
  const engine = owingRepo();
  for (const payload of [
    { tool_name: "Bash" },
    { tool_name: "Bash", tool_input: null },
    { tool_name: "Bash", tool_input: "rg foo" },
    { tool_name: "Bash", tool_input: { command: 7 } },
    { tool_name: "Bash", tool_input: { command: null } },
  ]) {
    const r = guard(engine, payload);
    assert.equal(r.status, 2, `expected a block for ${JSON.stringify(payload)}: ${r.stderr}`);
    assert.match(r.stderr, /still owes a reconcile/);
  }
});

unitTest("2.3 a read-only Bash command is not blocked while a reconcile is owed", () => {
  const engine = owingRepo();
  for (const command of [
    "rg foo 2>/dev/null",
    "cmd > /dev/null 2>&1",
    "git status --short",
    "node --test 2>&1 | tail",
    "rg 'foo->bar' src/",
    "rm .conductor/state.json.lock",
  ]) {
    const r = guard(engine, bash(command));
    assert.equal(r.status, 0, `expected an allow for ${command}: ${r.stderr}`);
    assert.equal(r.stderr, "", `an allow prints nothing; got: ${r.stderr}`);
    assert.equal(r.stdout, "", "gate-guard's stdout is protocol surface — an allow is silence");
  }
});

unitTest("2.3 every engine invocation the gate names as its own exit stays runnable", () => {
  // The gate names engine invocations as the way through it, so a gate that blocked one would have
  // no exit — and the sibling change's frame-drop verb relies on that holding as the list grows.
  const engine = owingRepo();
  for (const command of [
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile p --detour d --verdict valid --amendments none',
    'node "$ENGINE" pop-detour p',
    'node "$ENGINE" update-epic p --notes "lane: claude-code not openspec -> small"',
    'node "$ENGINE" record-gate-review p --gate 2 --verdict pass',
  ]) {
    assert.equal(guard(engine, bash(command)).status, 0, `the gate must not block its own exit: ${command}`);
  }
  // …and the exemption is not a bypass: a redirection in the same segment still blocks.
  assert.equal(guard(engine, bash('node "$ENGINE" status > out.txt')).status, 2);
});

// ─────────────── 2.7 / 2.8 — the tracker-refresh arm, which KEEPS its inverse ───────────────

/** A record whose live active epic owes a tracker refresh — the fixture's own record, verbatim. */
function refreshRepo() {
  return memoryEngine({ version: 1, active: "a", detourStack: [],
    epics: [{ id: "a", title: "A", priority: "P1", status: "active", role: "epic",
      lane: "claude-code", links: [], externalId: "7", trackerRefreshNeeded: true }] });
}

unitTest("2.7 the refresh block covers a Bash write on the same terms, and names the shape", () => {
  const engine = refreshRepo();
  engine(["set-gate-guard", "on"]);
  const blocked = guard(engine, bash("cat > src/x.js <<EOF"));
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /refresh/i);
  assert.ok(blocked.stderr.includes(WRITE_SHAPE_LABELS.redirect),
    `the refresh block names the matched shape too; stderr was:\n${blocked.stderr}`);
  assert.equal(guard(engine, bash("rg foo 2>/dev/null")).status, 0, "a non-write passes");
});

unitTest("2.7 the refresh arm KEEPS its inverse — set-gate-guard off silences it, Bash included", () => {
  // The asymmetry with the reconcile block is deliberate and is the release's own theme: the
  // reconcile arm ships no inverse because a switch that silenced Bash writes there would bypass
  // the whole gate, while here the escape hatch is the point — an agent that cannot reach its
  // tracker must be able to proceed honestly rather than record a blind `unchanged`.
  const engine = refreshRepo();
  engine(["set-gate-guard", "off"]);
  assert.equal(guard(engine, bash("cat > src/x.js <<EOF")).status, 0);
  assert.equal(guard(engine, bash("rg foo 2>/dev/null")).status, 0);
  assert.equal(guard(engine, { tool_name: "Edit", tool_input: {} }).status, 0);
});

// ─────────────── 2.9 / 2.10 — nothing today's behaviour moves ───────────────

unitTest("2.9 REGRESSION GUARD: an unidentified tool blocks exactly as it does today", () => {
  // Treating an unidentifiable call as a Bash call would convert a malformed payload into a silent
  // hole in the one block this plugin makes unconditional — and it would change the behaviour every
  // existing test exercises, since the suite invokes this hook with `"{}"` and with a bare
  // `{"tool_input":{}}`.
  const engine = owingRepo();
  for (const payload of ["{}", "", "not json", "[]", "null", JSON.stringify({ tool_name: "Frobnicate" }),
    JSON.stringify({ tool_input: {} })]) {
    const r = guard(engine, payload);
    assert.equal(r.status, 2, `an unidentified tool must block: ${JSON.stringify(payload)}`);
    assert.match(r.stderr, /still owes a reconcile/);
  }
});

unitTest("2.9 REGRESSION GUARD: an editing tool is unaffected by any command text in the payload", () => {
  const engine = owingRepo();
  for (const tool of ["Edit", "Write", "NotebookEdit"]) {
    // `rg foo` matches no shape; an editing tool must not be decided by the shape list at all.
    const r = guard(engine, { tool_name: tool, tool_input: { command: "rg foo", file_path: "src/x.js" } });
    assert.equal(r.status, 2, `${tool} blocks regardless of command text: ${r.stderr}`);
    assert.ok(!r.stderr.includes("matched a recognized write shape"),
      "no shape is named for an editing tool — the label is a decision about a Bash command");
  }
});

unitTest("2.10 REGRESSION GUARD: nothing owed — a Bash write shape is not blocked at all", () => {
  // The guard needs a LIVE active epic that owes something. `on` alone never means a call is
  // blocked, and neither does a recognized write shape: this change adds no obligation of its own.
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "q", "--lane", "claude-code", "--title", "q"]);
  engine(["set-active", "q"]);
  for (const setting of ["on", "off"]) {
    engine(["set-gate-guard", setting]);
    for (const command of ["cat > src/x.js <<EOF", "rm .conductor/state.json", "sed -i '' s/a/b/ f.js"]) {
      const r = guard(engine, bash(command));
      assert.equal(r.status, 0, `nothing is owed, so nothing blocks (guard ${setting}): ${command}`);
      assert.equal(r.stderr, "");
    }
    assert.equal(guard(engine, { tool_name: "Edit", tool_input: {} }).status, 0);
  }
});

unitTest("2.10 REGRESSION GUARD: an ARCHIVED active epic still owes nothing, Bash included", () => {
  // An epic that has ENDED owes nothing — the filter is at the resolution, so this arm inherits it
  // rather than having to remember it, and a stale `reconcileNeeded` cannot wedge Bash either.
  const engine = owingRepo();
  engine(["update-epic", "p", "--status", "archived", "--outcome", "abandoned",
    "--reason", "ended while the obligation still stood", "--no-deferrals"]);
  assert.equal(guard(engine, bash("cat > src/x.js <<EOF")).status, 0);
  assert.equal(guard(engine, { tool_name: "Edit", tool_input: {} }).status, 0);
});

// ─────────── spec scenarios asserted THROUGH THE HOOK, not only over the function ───────────

unitTest("2.1 destroying the conductor record is blocked through the hook, trailing globs included", () => {
  const engine = owingRepo();
  for (const command of [
    "rm .conductor/state.json",
    "rm -rf .conductor",
    "rm -rf .conductor/*",
    "rm .conductor/state.json*",
    "rm -rf .conductor*",
  ]) {
    const r = guard(engine, bash(command));
    assert.equal(r.status, 2, `deleting the record turns the guard OFF, so it is a shape: ${command}`);
    assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.record), r.stderr);
    assert.ok(r.stderr.includes("'p'"), "the block names the epic that owes the reconcile");
  }
});

unitTest("2.3 removing the state lock stays runnable through the hook, glob spelling included", () => {
  // The engine's own lock refusal prints the LITERAL path; `.conductor/state.json.*` cannot expand
  // to the record, so it stays the runnable glob spelling for lock cleanup.
  const engine = owingRepo();
  for (const command of [
    "rm .conductor/state.json.lock",
    "rm -r .conductor/state.json.lock",
    "rm .conductor/state.json.*",
  ]) {
    const r = guard(engine, bash(command));
    assert.equal(r.status, 0, `a remedy pm itself prints must stay runnable: ${command}\n${r.stderr}`);
    assert.equal(r.stderr, "");
  }
});

unitTest("the marker refusal's own `sed` remedy is a recognized write shape", async () => {
  // The managed-rules-block delta's scenario, in the suite rather than only in a sweep
  // (a-one-off-sweep-certifies-only-the-day-it-ran). The command is EXTRACTED FROM THE EMITTED
  // MESSAGE, never hardcoded: that is what makes this fail if either module is reworded, which is
  // the interaction the requirement now states normatively — the remedy is blocked while a
  // reconcile is owed, and that is accepted, not a defect.
  const { rulesBlockAmbiguousMessage, RulesBlockAmbiguousError } =
    await import("../../lib/rules.mjs");
  const err = new RulesBlockAmbiguousError("/tmp/x/CLAUDE.md",
    [{ line: 7, kind: "BEGIN" }, { line: 9, kind: "BEGIN" }], false);
  const line = rulesBlockAmbiguousMessage(err).split("\n").map(l => l.trim()).find(l => l.startsWith("sed "));
  assert.ok(line, "the refusal must still name a `sed` remedy for this guard to be about anything");

  // The requirement's substance: this remedy IS a recognized write shape and is blocked while a
  // reconcile is owed. Accepted — a damaged marker arrangement is not time-critical and is not the
  // guard's own escape hatch, and the way through is completing the reconcile gate.
  assert.ok(writeShape(line), `pm's own marker fix must be recognized as a write: ${line}`);

  // WHICH ROW MATCHES DEPENDS ON WHETHER `<N>` IS FILLED IN, and the delta's scenario names the
  // in-place row, so both spellings are pinned. As EMITTED the placeholder's `>` reaches the
  // redirection arm first — the pre-existing unfilled-template class (design D7), where the
  // template is already broken at the shell and only the filled spelling ever ran.
  assert.equal(writeShape(line), WRITE_SHAPE_LABELS.redirect,
    "as emitted, `<N>` is an input redirection and the redirection arm matches first");
  assert.equal(writeShape(line.replace("<N>", "7")), WRITE_SHAPE_LABELS.inPlace,
    "FILLED IN — the only spelling that ever ran — it matches as an in-place stream editor, which " +
    "is the row the managed-rules-block delta's scenario names");
});
