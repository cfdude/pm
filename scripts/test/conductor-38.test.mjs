// #162 — the delegation stdout loss that does not exist, and the one that could.
//
// #162 reported that with PM_ENGINE_DELEGATION set, the suite intermittently saw truncated or
// absent engine stdout, and named a mechanism: helpers.mjs passes process.env into every child,
// so each run() spawns "an extra delegated process layer" that loses output under parallel load.
//
// THAT MECHANISM IS IMPOSSIBLE, and this file makes saying so again a test failure rather than an
// argument. Measured during the investigation: 0 reproductions in 34 full-suite runs across two
// trees, plus 200 delegating runs at 24-way parallelism against a 1 MB payload with one distinct
// output length and a byte-exact terminator every time.
//
// The issue's own evidence does not support its headline either: it recorded no output LENGTH, so
// "a missing heading" was never distinguished from "truncation" — a missing heading at full length
// is a different BLOCK, not a short read. And its "193 pass" is ~67 below the static floor for
// those five files (260 static declarations at 820a303; the first published figure, ~67, omitted
// conductor-34 — the correction strengthens the conclusion), so that run did not execute all of their tests at all. The likeliest
// explanation left standing is docs/lessons/measuring-under-concurrent-writes.md: the issue was
// filed in a window where two of the files under test carried uncommitted in-progress edits.
//
// I filed it. The lesson was already written down here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "./helpers.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF_HOSTING = new URL("../lib/self-hosting.mjs", import.meta.url).href;

// ═══════════════ the claim, made false by construction ═══════════════

test("#162: delegation never fires from either shape the test harness can produce", async () => {
  // helpers.mjs run() has exactly two shapes, and BOTH resolve to no delegation:
  //   run(args, { cwd })  — CLAUDE_PROJECT_DIR is the tmp repo, so the authorization check fails.
  //   run(args)           — CLAUDE_PROJECT_DIR is absent, ROOT is the checkout, so the delegation
  //                         target IS this engine and the `target === self` short-circuit fires.
  // Either way there is no extra process layer, so there is nothing that could lose a child's
  // output. Asserted here so the mechanism cannot be re-derived from the issue text later.
  const { delegateToCheckout } = await import(SELF_HOSTING);
  const cwd = tmpRepo();
  run(["init"], { cwd });

  const shapes = [
    ["run(args, { cwd })", { ...process.env, PM_ENGINE_DELEGATION: REPO, CLAUDE_PROJECT_DIR: cwd }],
    ["run(args)", (() => { const e = { ...process.env, PM_ENGINE_DELEGATION: REPO }; delete e.CLAUDE_PROJECT_DIR; return e; })()],
  ];
  // selfPath is what the `target === self` short-circuit compares against, and conductor.mjs
  // supplies its own path (conductor.mjs:126). Omitting it here made the second shape delegate
  // for real — a defect in this test, not in the engine, and worth the comment because the same
  // omission would make a future reader believe the short-circuit does not work.
  const selfPath = path.join(REPO, "scripts", "conductor.mjs");
  for (const [label, env] of shapes) {
    const root = env.CLAUDE_PROJECT_DIR || REPO;
    assert.equal(delegateToCheckout({ selfPath, root, env }), null,
      `${label}: delegation must not fire from the harness — #162's mechanism depends on it doing so`);
  }
});

test("#162: the handoff cannot silently truncate or drop the child's output", () => {
  // THIS GUARD WAS RE-POINTED BY 2.6, and the reversal is deliberate rather than a weakening.
  // It used to assert `stdio: "inherit"` — the child writes to the parent's own descriptor, so
  // there is nothing to lose — and that mechanism is what 2.6 removed: the child inheriting the
  // PROCESS's descriptors is the one route by which the engine's output still reached the process's
  // own streams whatever `io` a caller supplied, which engine-invocation forbids as a SHALL.
  //
  // The property #162 is about — output is not lost — is unchanged; only the mechanism is. It is
  // now carried by THREE things, and all three are asserted here because a capture without them
  // IS the losable parent this guard exists to prevent:
  //   1. the child's output is captured from pipes and written to the INVOCATION's streams;
  //   2. the capture is BOUNDED far above anything the engine can produce, so a child that
  //      exceeded it would be killed and reported rather than quietly cut off;
  //   3. a child that started is never fallen back from, so an over-bound child cannot have the
  //      engine run a second time on top of it.
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "self-hosting.mjs"), "utf8");
  assert.match(src, /stdio:\s*realStdin\s*\?\s*\["inherit",\s*"pipe",\s*"pipe"\]\s*:\s*\["pipe",\s*"pipe",\s*"pipe"\]/,
    "both of the child's output streams are captured — fd 2 as well as fd 1, or a warning goes astray");
  assert.match(src, /if \(r\.stdout\) outStream\(\)\.write\(r\.stdout\);/,
    "and what was captured is re-emitted on the INVOCATION's stdout");
  assert.match(src, /if \(r\.stderr\) errStream\(\)\.write\(r\.stderr\);/,
    "and on the invocation's stderr");
  const bound = /maxBuffer:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(src);
  assert.ok(bound, "the capture is bounded explicitly rather than left at spawnSync's 1 MB default");
  const bytes = Number(bound[1]) * Number(bound[2]) * Number(bound[3]);
  assert.ok(bytes >= 8 * 1024 * 1024,
    `the capture bound is ${bytes} bytes — the largest write path the engine has is ~9 KB, so a ` +
    "bound within an order of magnitude of that is a truncation waiting to happen");
  assert.match(src, /const started = typeof r\.pid === "number" && r\.pid > 0;/,
    "an unborn child and one that ran are told apart, so only the first can degrade to running locally");
  assert.match(src, /if \(!started\) \{[\s\S]{0,400}return null;/,
    "a child that never started is the ONLY fallback — falling back after a mutating child ran " +
    "would perform the verb twice");
});

// ═══════════════ the truncation that IS real, and is not delegation's ═══════════════

test("no verb's EXITING --help path writes enough to hit the pipe buffer", async () => {
  // The one genuine truncation mechanism found: a process that writes a large payload to a PIPE
  // and then calls process.exit() truncates at the buffer, because exit skips the flush. Measured
  // at 65536 bytes, and IDENTICAL with and without the delegating parent — so it is Node's exit
  // behaviour, not the handoff.
  //
  // It is unreachable today: the largest write-then-exit path is `update-epic --help` at ~1.3 KB
  // against a 64 KB buffer. This guard exists because that is a property of today's output sizes
  // and nothing was holding it — the day someone adds a paged report or a large --help on an
  // exiting path, this fails instead of silently truncating for a user with a piped stdout.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const usage = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const verbs = usage.match(/const USAGE = "usage: conductor\.mjs ([^\\]+)/)[1].split("|");

  const BUDGET = 8 * 1024;  // an eighth of the smallest pipe buffer seen; ample headroom
  const over = [];
  for (const verb of verbs) {
    // --help is the exiting path: the short-circuit writes and calls process.exit() directly.
    const out = run([verb, "--help"], { cwd });
    if (Buffer.byteLength(out) > BUDGET) over.push(`${verb} --help: ${Buffer.byteLength(out)} bytes`);
  }
  assert.deepEqual(over, [],
    `these write more than ${BUDGET} bytes and then exit, which truncates at the pipe buffer:\n` +
    over.join("\n"));
});

test("and no NON-help path writes large stdout then exits — the sibling the loop cannot reach", () => {
  // Gate 2's finding: the test above is named for all verbs and exercises only `--help`, so the
  // identical sibling class — any verb that writes big output on a normal path and then exits —
  // sat unguarded, and would never appear in a diff. Invoking all 48 verbs for real is not
  // available (most need arguments and most mutate), so this asserts the property STATICALLY:
  // every `process.exit` in the engine must not sit close after a stdout write, which is the
  // shape that truncates.
  //
  // The sweep found no live instance — `rules` (28 KB), `integrity`, `activity`, `verify-specs`
  // and `owners` all write and RETURN — so this holds the property rather than fixing a bug.
  const files = [path.join(REPO, "scripts", "conductor.mjs"),
    ...fs.readdirSync(path.join(REPO, "scripts", "lib"))
      .filter(f => f.endsWith(".mjs")).map(f => path.join(REPO, "scripts", "lib", f))];
  const risky = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/process\.exit\(/.test(line)) return;
      // A write within the preceding 3 lines is the truncation shape. Small literal writes are
      // fine; what this forbids is exiting right after emitting a VARIABLE payload, whose size
      // nothing here bounds.
      const before = lines.slice(Math.max(0, i - 3), i).join("\n");
      if (!/process\.stdout\.write\((?!"|`[^`$]*`)/.test(before)) return;
      // The help short-circuit is EXCLUDED here because the test above measures it directly, and
      // a measured byte count beats a static shape. Excluded by what it writes rather than by
      // line number, so it survives the file moving: any OTHER non-literal write before an exit
      // still fails. Together the two tests cover the whole class — the runtime one where it can
      // invoke, this one where it cannot.
      if (/verbHelp\(|write\(USAGE\)/.test(before)) return;
      risky.push(`${path.basename(file)}:${i + 1}`);
    });
  }
  assert.deepEqual(risky, [],
    "these write a non-literal payload to stdout and then exit, which truncates at the pipe " +
    `buffer for a caller with a piped stdout:\n${risky.join("\n")}`);
});
