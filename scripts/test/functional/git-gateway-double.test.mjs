// scripts/test/git-gateway-double.test.mjs
// 4.3 — the fake, injected — and 4.4 — the fake-versus-live byte check (design D4/D5).
//
// THE TWO HALVES ARE ONE SUBJECT. A double is worth having only while it answers what git answers,
// and the way that stops being true is silently: the assertion half runs on every commit against the
// fake, and the functional half it would have to agree with runs on a trigger that may fire months
// later. So the fake's answers are FROZEN CAPTURES (fixtures/git-gateway-capture.json), and this file
// proves them byte-identical to the real git's for the same invocations against a deterministic
// repository — every case, every operation, on the machine running the check.
//
// 4.5 DECIDES THE GIT-VERSION QUESTION, and the decision is the loud one. A live output that changes
// with the git version FAILS the check rather than being absorbed: the differing FIELD is reported, so
// a porcelain key git renamed and a commit whose content moved are distinguishable before anyone
// touches the capture. Refreshing the capture is a deliberate edit — `PM_REFRESH_GIT_CAPTURE=1`
// rewrites the file AND fails the run that did it, so the new bytes are always reviewed as a diff and
// the assertion half never silently re-baselines itself onto a machine's git.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run } from "../fixtures/functional-harness.mjs";
import { GIT_OPERATIONS, realGit } from "../../lib/git-gateway.mjs";
import {
  buildFixture, casesFor, callReal, rootsOf, rootToToken, buildCapture, REQUIRED_OPERATIONS,
  CAPTURE_PATH, ROOT_TOKEN, NO_REPO_TOKEN,
} from "../fixtures/git-gateway-repo.mjs";
import { fakeGit, loadCapture } from "../fixtures/fake-git.mjs";

// ─────────────────────────── 4.4 — the byte check ───────────────────────────

/** Name the FIRST difference between the canned answer and git's, as the field it is. Line-oriented
 *  output (procelain, ls-files, the batch-check stream) names its line and, where the line has a
 *  `key value` shape, the KEY — because "the porcelain format changed" and "the fixture gained a
 *  worktree" are different diagnoses and a bare offset tells them apart badly. */
function describeDifference(expected, actual) {
  const a = expected === null || expected === undefined ? "" : String(expected);
  const b = actual === null || actual === undefined ? "" : String(actual);
  if (a === b) return null;
  // A NUL is a field end too: `worktreeList` reads `--porcelain -z`, and a field the check names must
  // still be a field there.
  const linesA = a.split(/[\n\0]/), linesB = b.split(/[\n\0]/);
  for (let i = 0; i < Math.max(linesA.length, linesB.length); i++) {
    if (linesA[i] === linesB[i]) continue;
    const key = /^([a-z][a-z-]*) /.exec(linesB[i] ?? "") || /^([a-z][a-z-]*) /.exec(linesA[i] ?? "");
    return `line ${i + 1}${key ? ` (the "${key[1]}" field)` : ""} — canned ${JSON.stringify(linesA[i] ?? "<absent>")}, live ${JSON.stringify(linesB[i] ?? "<absent>")}`;
  }
  // Same line count, so the difference is inside a line: report the column and the neighbourhood.
  let col = 0;
  while (col < a.length && a[col] === b[col]) col++;
  return `byte ${col + 1} of one line — canned ${JSON.stringify(a.slice(Math.max(0, col - 10), col + 30))}, ` +
    `live ${JSON.stringify(b.slice(Math.max(0, col - 10), col + 30))}`;
}

/** Call the double the way the engine would, and report its answer in the same shape `callReal`
 *  reports the real one's — so the comparison is answer-to-answer, not throw-to-value. */
function callFake(gateway, op, args) {
  try {
    const r = gateway[op](...args);
    return { status: 0, value: r === undefined || r === null ? null : String(r) };
  } catch (e) {
    return { status: e && typeof e.status === "number" ? e.status : -1, value: null, stderr: String(e && e.stderr || "") };
  }
}

test("4.4 every gateway operation's canned answer is byte-identical to the real git's", () => {
  const fx = buildFixture();
  const roots = rootsOf(fx);

  // THE COVERAGE IS ASSERTED FIRST, so "no differences" cannot be reached by holding no cases.
  const opsWithCases = new Set(casesFor(fx).map(c => c.op));
  assert.deepEqual([...REQUIRED_OPERATIONS].sort().filter(o => !opsWithCases.has(o)), [],
    "every operation in the gateway needs at least one case, or it is never compared against git");
  assert.deepEqual([...opsWithCases].sort(), [...REQUIRED_OPERATIONS].sort(),
    "and no case may name an operation the gateway does not have");

  const real = realGit(() => ({ root: fx.attached.root, env: process.env }));
  const fake = fakeGit({ roots });

  const differences = [];
  for (const c of casesFor(fx)) {
    const live = callReal(real, c.op, c.args);
    const canned = callFake(fake, c.op, c.args);
    const where = `${c.op}(${c.args.map(a => JSON.stringify(a)).join(", ")})`;
    if (canned.status !== live.status) {
      differences.push(`${where}: the canned answer exits ${canned.status} and git exits ${live.status}`);
      continue;
    }
    const diff = describeDifference(
      rootToToken(live.value, roots), rootToToken(canned.value, roots));
    if (diff) differences.push(`${where}: ${diff}`);
  }

  if (process.env.PM_REFRESH_GIT_CAPTURE === "1") {
    // THE DELIBERATE REFRESH, and it FAILS the run that performs it. A path that quietly rewrote the
    // capture on a mismatch would be a double that re-baselines itself onto whatever this machine's
    // git does — the exact drift the frozen capture exists to prevent. So: rewrite, then report, so
    // the new bytes are always read as a diff.
    fs.writeFileSync(CAPTURE_PATH, JSON.stringify(buildCapture(fx), null, 2) + "\n");
    const over = differences.length
      ? differences.join("\n  ")
      : "(none — the refresh was unconditional, which is still a deliberate edit to review as a diff)";
    assert.fail("the capture was REFRESHED because PM_REFRESH_GIT_CAPTURE=1; the differences it was " +
      "refreshed over were:\n  " + over);
  }

  assert.deepEqual(differences, [],
    "the assertion half's git double must answer exactly what the real git answers for the same " +
    "invocation. A difference here is either a git release changing an output (refresh the capture " +
    "DELIBERATELY, having read the field named below) or the fixture having moved underneath it");
});

test("4.4 the NO-REPOSITORY answers are the real git's too, operation by operation", () => {
  // The assertion half's invocations run against a temporary directory that is not a repository, so
  // the double has a SECOND world to get right. It is checked the same way and against the same live
  // git: the fixture's plain root, one real call per operation, byte-compared to the frozen answer.
  // Without this the no-repository section would be the one part of the capture nothing proves.
  const fx = buildFixture();
  const real = realGit(() => ({ root: fx.plain, env: process.env }));
  const fake = fakeGit({ noRepository: true });
  const section = loadCapture().noRepository;
  assert.deepEqual(Object.keys(section).sort(), [...REQUIRED_OPERATIONS].sort(),
    "the no-repository section covers exactly the gateway's operations");

  const aSha = "0".repeat(40);
  const argsFor = {
    headRef: [fx.plain], commitWatchGit: [["rev-parse", "--git-dir"], fx.plain],
    abbreviateCommit: [aSha], verifyCommitName: [aSha], mergeBaseIsAncestor: [aSha, aSha],
    committerDate: [aSha], commitExists: [aSha], refsContaining: [aSha],
    diffNamesAgainstHead: [["README.md"]], batchCheckCommits: [`${aSha}^{commit}\n`],
    revListNotReached: [[aSha], aSha], gitPath: ["shallow"], logPickaxe: ["x", ".conductor/state.json"],
    diffTreeNames: [aSha], commitSubject: [aSha], mergeBaseIsAncestorOfHead: [aSha],
    lsFiles: [[".claude/skills"]],
  };
  const roots = { root: fx.plain, token: NO_REPO_TOKEN };
  const differences = [];
  for (const op of REQUIRED_OPERATIONS) {
    const live = callReal(real, op, argsFor[op] ?? []);
    const canned = callFake(fake, op, argsFor[op] ?? []);
    if (canned.status !== live.status) {
      differences.push(`${op}: the canned answer exits ${canned.status} and git exits ${live.status}`);
      continue;
    }
    const diff = describeDifference(rootToToken(live.value, roots), rootToToken(canned.value, roots));
    if (diff) differences.push(`${op}: ${diff}`);
  }
  assert.deepEqual(differences, [],
    "the double's no-repository answers must be the real git's in a directory that is not a " +
    "repository — the assertion half asserts against this world on every commit");
});

test("4.4 the check DISCRIMINATES: one byte of the double changed is one reported field", () => {
  // The verification the task list requires, kept as a test rather than left to a one-off run — a
  // check nobody has seen fail is a check that may be comparing nothing. `worktreeList`'s answer is
  // chosen on purpose: it is line-oriented porcelain, so the mutation lands on a named FIELD rather
  // than on a byte offset in a single blob.
  const fx = buildFixture();
  const roots = rootsOf(fx);
  const capture = loadCapture();
  const entry = capture.operations.worktreeList.cases[0];
  const pristine = entry.value;
  entry.value = pristine.replace("branch refs/heads/wt-branch", "branch refs/heads/wt-branchh");
  assert.notEqual(entry.value, pristine, "the mutation must actually change the capture");

  const live = callReal(realGit(() => ({ root: fx.attached.root, env: process.env })), "worktreeList", []);
  const canned = callFake(fakeGit({ capture, roots }), "worktreeList", []);
  const diff = describeDifference(rootToToken(live.value, roots), rootToToken(canned.value, roots));
  assert.ok(diff, "the mutation MUST produce a reported difference — an insensitive check would pass here");
  assert.match(diff, /the "branch" field/, `the failure must NAME the field it differs on, got: ${diff}`);
  assert.match(diff, /wt-branchh/, "and show what the canned side holds");
});

// ─────────────────────────── 4.3 — the double, injected ───────────────────────────

test("4.3 the capture answers every operation, and an invocation it does not hold THROWS", () => {
  const capture = loadCapture();
  const fake = fakeGit({ roots: [{ root: "/nowhere", token: ROOT_TOKEN }] });
  assert.deepEqual(Object.keys(capture.operations).sort(), [...REQUIRED_OPERATIONS].sort(),
    "the capture covers exactly the gateway's operations");
  for (const op of REQUIRED_OPERATIONS) {
    const c = capture.operations[op].cases[0];
    assert.ok(c, `${op} has at least one case`);
    assert.ok(capture.operations[op].asks, `${op} records what it asks git`);
    // 4.3's own requirement: each says WHEN it may be refreshed.
    assert.ok(capture.operations[op].refreshWhen.length > 60,
      `${op} says WHEN its capture may be refreshed, in a sentence rather than a word`);
  }
  // An invocation the capture does not hold — the same operation, a different argument. The failure
  // mode this guards against is a double that answers SOMETHING plausible instead.
  assert.throws(() => fake.gitPath("logs/HEAD"), /no captured answer/,
    "an uncaptured call must fail loudly rather than answer something plausible");
  assert.throws(() => fake.commitWatchGit(["status"], "/nowhere"), /no captured answer/,
    "and matching is on the ARGUMENTS, not the operation alone");
  assert.equal(fake.shortHead(), capture.operations.shortHead.cases[0].value);
});

test("4.3 the ENGINE runs against the double: a verb's git answer comes from the capture", async () => {
  // The injection, end to end and through `main()`: the same call a slash command or a hook makes.
  // `log-detour` is chosen because its OUTPUT is a git answer — the row it appends carries the
  // abbreviated HEAD — so the assertion is on a byte the engine wrote, not on an internal call.
  const { main } = await import("../../conductor.mjs");
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });

  const captured = loadCapture().operations.shortHead.cases[0].value;
  const io = {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true }, stderr: { write: () => true },
    // The ONLY substitution: the invocation's root is this test's temporary directory, while the
    // capture holds the fixture's token — the one normalization the capture states.
    git: fakeGit({ roots: [{ root: cwd, token: ROOT_TOKEN }] }),
  };
  assert.equal(await main(["log-detour", "a minimal detour, doubled"], io), 0);

  const rows = fs.readFileSync(path.join(cwd, ".conductor", "detours.log"), "utf8").split("\n").filter(Boolean);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split("\t")[1], captured,
    "the logged sha is the CAPTURE's — this repository has no commit at all, so a real gateway would " +
    "have answered `-` and the row would prove nothing about the injection");
});

test("4.3 nothing else in the engine reaches git past the injected gateway", () => {
  // The counterpart of 4.1's derivation, from the other side: the gateway the engine is HANDED is the
  // one it uses. `gitOps()` returns `ctx.git` whenever the invocation carries one, so a module that
  // held its own reference could still bypass it — this asserts the accessor is the only route.
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "lib", "invocation.mjs"), "utf8");
  assert.match(src, /export function gitOps\(ctx = invocation\(\)\) \{[\s\S]{0,400}if \(ctx\.git\) return ctx\.git;/,
    "the invocation's gateway wins over any default — that is what makes `io.git` an injection");
});
