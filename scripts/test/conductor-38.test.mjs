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
// is a different BLOCK, not a short read. And its "193 pass" is ~55 below the static floor for
// those five files, so that run did not execute all of their tests at all. The likeliest
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

test("#162: the handoff hands the child the SAME fd, so it cannot buffer or drop output", () => {
  // `stdio: "inherit"` is the whole argument. The child writes to the parent's own descriptor —
  // the parent never captures and re-emits — and spawnSync blocks until the child has exited and
  // flushed. A parent that captured stdout and re-wrote it WOULD be losable, which is why this
  // asserts the mechanism rather than trusting the comment beside it.
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "self-hosting.mjs"), "utf8");
  assert.match(src, /spawnSync\([\s\S]{0,400}stdio:\s*"inherit"/,
    "the delegation handoff must stay stdio:inherit — capturing and re-emitting could lose output");
  assert.doesNotMatch(src, /spawnSync\([\s\S]{0,400}encoding:\s*"utf8"/,
    "capturing the child's output would reintroduce exactly the loss #162 imagined");
});

// ═══════════════ the truncation that IS real, and is not delegation's ═══════════════

test("no verb writes enough to stdout before process.exit to hit the pipe buffer", async () => {
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
