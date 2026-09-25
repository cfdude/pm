// scripts/test/unit/runtime-support.test.mjs
// 0.49.0 task 3.1 — THE SUPPORT FLOOR'S ONE LINE IN THE SESSIONSTART BRIEF, over an in-memory record.
//
// WHAT IT PROVES (runtime-support's third requirement, engine-invocation's per-call runtime version):
//   * below the support floor, `brief` carries exactly ONE line naming the running version and the
//     floor, and everything else it prints is what it prints on a supported Node;
//   * at or above the floor — an unsupported odd major above it included — and on a version that
//     cannot be parsed, there is no line;
//   * the line is `brief`'s alone: the rendered PROJECT.md and the PreCompact snapshot never carry it;
//   * the version is the INVOCATION's: two invocations in one process under two different versions
//     each see their own, and an invocation that supplies none carries the process's own version
//     while the call is in progress (not an absent value, which would print the same brief on a
//     supported Node and so could not be told apart by the output alone).
//
// No old Node is needed for any of it: the version is a per-call value the harness supplies.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
// A NAMESPACE import, so a missing accessor fails ONE test by assertion rather than the whole file
// at link time.
import * as invocation from "../../lib/invocation.mjs";

const BELOW = "v20.20.2";
const AT = "v22.23.3";

/** The brief's `additionalContext`, under the given runtime version. */
function briefUnder(engine, nodeVersion) {
  const r = engine.result(["brief", "--platform", "claude-code"], { nodeVersion });
  assert.equal(r.status, 0, `brief must exit 0 under ${nodeVersion}: ${r.stderr}`);
  return { status: r.status, context: JSON.parse(r.stdout).hookSpecificOutput.additionalContext };
}

const LINE = /^⚠ Node .* is below pm's support floor \(Node \d+, the oldest supported LTS line\)/m;

// ─────────────────────────────── RED today: there is no seam and no line ───────────────────────────────

unitTest("below the support floor, brief's context STARTS with one line naming the version and the floor", () => {
  const engine = memoryEngine(emptyRecord());
  const below = briefUnder(engine, BELOW);
  const at = briefUnder(engine, AT);
  const first = below.context.split("\n")[0];
  assert.match(first, /20\.20\.2/, `the first line must name the running version: ${first}`);
  assert.match(first, /\bNode 22\b/, `the first line must name the support floor: ${first}`);
  assert.match(first, /still runs/, `the line must say pm still runs — a warning, not a refusal: ${first}`);
  assert.equal(below.context.match(new RegExp(LINE.source, "gm"))?.length, 1, "exactly ONE such line");
  assert.equal(below.status, at.status, "the exit status is the one a supported Node gets");
  assert.equal(below.context.split("\n").slice(1).join("\n"), at.context,
    "everything after the line is exactly what a supported Node prints");
});

unitTest("two invocations in one process under two different below-floor versions each name their own", () => {
  const engine = memoryEngine(emptyRecord());
  const a = briefUnder(engine, BELOW).context.split("\n")[0];
  const b = briefUnder(engine, "v18.20.8").context.split("\n")[0];
  assert.match(a, /20\.20\.2/, `the first invocation names its own version: ${a}`);
  assert.doesNotMatch(a, /18\.20\.8/, "and not the other's");
  assert.match(b, /18\.20\.8/, `the second invocation names its own version: ${b}`);
  assert.doesNotMatch(b, /20\.20\.2/, "and not the other's");
});

unitTest("no supplied version: the invocation carries the PROCESS's version while the call is in progress", () => {
  const engine = memoryEngine(emptyRecord());
  const seen = [];
  const readRecord = engine.store.readRecord;
  engine.store.readRecord = (...args) => { seen.push(invocation.runtimeVersion?.()); return readRecord(...args); };
  const r = engine.result(["brief", "--platform", "claude-code"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(seen.length > 0, "brief never loaded the record, so nothing observed the version mid-call");
  assert.deepEqual([...new Set(seen)], [process.version],
    "an invocation that supplies no version must carry the running process's own, not an absent value");
});

// ───────────── REGRESSION GUARDS: each passes today, because nothing prints a line yet ─────────────
// Each is proven by a mutation in a scratch copy after 3.2 (mutation-3.1.txt).

unitTest("at or above the support floor — an unsupported odd major above it included — there is no line", () => {
  const engine = memoryEngine(emptyRecord());
  for (const v of ["v22.23.3", "v25.0.0", "v26.10.0"]) {
    assert.doesNotMatch(briefUnder(engine, v).context, LINE, `no runtime-support line under ${v}`);
  }
});

unitTest("a version that cannot be parsed gets no line — cannot tell is not below the floor", () => {
  const engine = memoryEngine(emptyRecord());
  assert.doesNotMatch(briefUnder(engine, "garbage").context, LINE);
});

unitTest("an uninitialized repository stays silent below the support floor", () => {
  const engine = memoryEngine();
  const r = engine.result(["brief", "--platform", "claude-code"], { nodeVersion: BELOW });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "", `brief must print nothing before /pm:init, whatever the Node: ${r.stdout}`);
});

unitTest("the rendered PROJECT.md and the PreCompact snapshot never carry the line", () => {
  const engine = memoryEngine(emptyRecord());
  const r = engine.result(["render"], { nodeVersion: BELOW });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(engine.store.read("PROJECT.md").text, LINE,
    "PROJECT.md is a tracked file: one machine's runtime must never be written into it");
  const s = engine.result(["snapshot", "--platform", "claude-code"], { nodeVersion: BELOW });
  assert.equal(s.status, 0, s.stderr);
  assert.doesNotMatch(engine.store.read("brief.txt").text, LINE,
    "the PreCompact snapshot reaches no session, so the line must not be there either");
});
