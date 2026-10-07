// scripts/test/functional/flake-retry.test.mjs
// flaky-test-quarantine-and-targeted-rerun — THE RETRY OVER REAL PROCESSES. Its assertion twin is
// scripts/test/unit/flake-retry.test.mjs, which holds every decision as a value with the filesystem
// injected; what only a real run shows is here:
//
//   * the real certify runner, over a fixture repository whose one functional test FAILS ONCE (a marker
//     file makes the second run pass), retries that file, and — listed or unlisted — records the pass,
//     names the flake, and appends one JSON line to the repository's `.test-flakes.log`;
//   * a test that fails on both runs fails the certification and records nothing;
//   * the real `.githooks/pre-commit`, over a fixture whose assertion-half file fails once, passes the
//     commit AFTER the retry, and a test that fails twice still fails it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo } from "../fixtures/functional-harness.mjs";
import { runHookAgainstFixture } from "../fixtures/helpers.mjs";
import { RECORD_DIR } from "../certification.mjs";
import { certifyMachinery, copyInto } from "../fixtures/hook-machinery.mjs";

const MODULE = "scripts/lib/m.mjs";
const STUB_PATH = "scripts/test/functional/stub.test.mjs";
const FLAKY = "flaky stub";
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The fixture's one functional test. PM_STUB_MARKER names a file: absent, the test creates it and FAILS;
 *  present, it passes — so the retry (a second run of this file) is what passes. PM_STUB_ALWAYS fails it
 *  on every run. */
const STUB = `import { test } from "node:test";
import fs from "node:fs";
import { touch } from "../../lib/m.mjs";
void touch;
test("${FLAKY}", () => {
  if (process.env.PM_STUB_ALWAYS) throw new Error("fails on every run");
  const marker = process.env.PM_STUB_MARKER;
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "first run"); throw new Error("fails on the first run only"); }
});
`;

function fixture({ known } = {}) {
  const cwd = tmpRepo();
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  const files = {
    "scripts/conductor.mjs": "export const main = () => 0;\n",
    [MODULE]: "export const touch = () => gitOps();\n",
    [STUB_PATH]: STUB,
    "scripts/test/assert/stub.test.mjs": 'import { test } from "node:test";\ntest("stub twin", () => {});\n',
    "scripts/test/sweeps/output-interpolations.test.mjs": 'import { test } from "node:test";\ntest("sweep", () => {});\n',
    ...(known ? { "scripts/test/known-flakes.json": JSON.stringify(known) } : {}),
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), body);
  }
  copyInto(cwd, certifyMachinery());
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "fixture");
  return cwd;
}

function certify(cwd, extra) {
  const env = { ...process.env, TMPDIR: tmpRepo(), ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  const r = spawnSync(process.execPath, [path.join(cwd, "scripts/test/certify.mjs"), "functional"], { cwd, encoding: "utf8", env });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const ledgerOf = (cwd) => {
  const file = path.join(cwd, ".test-flakes.log");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const recorded = (cwd) => {
  const dir = path.join(cwd, ".git", RECORD_DIR, "functional");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")).length : 0;
};
const marker = () => path.join(tmpRepo(), "marker");

test("a listed flake passes on retry: certify records the run, says 'known flake', and the ledger gets one line", () => {
  const cwd = fixture({ known: [{ file: STUB_PATH, test: FLAKY, owningEpic: null, note: "fixture" }] });
  const r = certify(cwd, { PM_STUB_MARKER: marker() });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /known flake \(passed on retry, not to be diagnosed\)/);
  assert.doesNotMatch(r.out, /UNLISTED/);
  assert.match(r.out, /passed \(\d+\/\d+, after retrying 1 failed file once/, "the pass line says the pass came through a retry");
  assert.equal(recorded(cwd), 1, "the recovered run is recorded");
  const lines = ledgerOf(cwd);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].file, STUB_PATH);
  assert.equal(lines[0].test, FLAKY);
  assert.equal(lines[0].outcome, "passed-on-retry");
  assert.equal(typeof lines[0].load1, "number", "the load average is recorded");
  assert.ok(!Number.isNaN(Date.parse(lines[0].at)), "an ISO time is recorded");
});

test("an UNLISTED flake still passes on retry but is named loudly with its file and test", () => {
  const cwd = fixture();
  const r = certify(cwd, { PM_STUB_MARKER: marker() });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, new RegExp(`UNLISTED flake: ${STUB_PATH} ${FLAKY}`));
  assert.equal(recorded(cwd), 1);
});

test("a test that fails on both runs fails the certification, records nothing, and the ledger says failed-on-retry", () => {
  const cwd = fixture({ known: [{ file: STUB_PATH, test: FLAKY, owningEpic: null, note: "listed, but listing never excuses a second failure" }] });
  const r = certify(cwd, { PM_STUB_ALWAYS: "1", PM_STUB_MARKER: marker() });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /failed twice/);
  assert.equal(recorded(cwd), 0);
  assert.deepEqual(ledgerOf(cwd).map((l) => l.outcome), ["failed-on-retry"]);
});

test("a passing run never writes the ledger", () => {
  const cwd = fixture();
  const m = marker();
  fs.writeFileSync(m, "already there");
  const r = certify(cwd, { PM_STUB_MARKER: m });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(ledgerOf(cwd), []);
});

// ───────────────────────────── the real pre-commit hook ─────────────────────────────

const FLAKY_ASSERT_FILE = `
  import { test } from "node:test";
  import fs from "node:fs";
  test("steady", () => {});
  test("flaky once", () => {
    if (process.env.PM_STUB_ALWAYS) throw new Error("fails on every run");
    const m = process.env.PM_STUB_MARKER;
    if (!fs.existsSync(m)) { fs.writeFileSync(m, "first run"); throw new Error("fails on the first run only"); }
  });
`;

test("pre-commit passes a commit whose assertion-half file failed once, AFTER the retry, naming the flake", () => {
  const r = runHookAgainstFixture(FLAKY_ASSERT_FILE, { env: { PM_STUB_MARKER: marker() } });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(out, /UNLISTED flake: scripts\/test\/assert\/fixture\.test\.mjs flaky once/);
  assert.match(out, /pre-commit: 2\/2 passing AFTER a retry of the failed files/);
  const ledger = ledgerOf(r.cwd);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].outcome, "passed-on-retry");
});

test("pre-commit lists a known flake as such and still fails a test that fails twice", () => {
  const known = { "scripts/test/known-flakes.json": JSON.stringify([
    { file: "scripts/test/assert/fixture.test.mjs", test: "flaky once", owningEpic: null, note: "fixture" }]) };
  const once = runHookAgainstFixture(FLAKY_ASSERT_FILE, { env: { PM_STUB_MARKER: marker() }, extraFiles: known });
  assert.equal(once.status, 0, `${once.stdout}${once.stderr}`);
  assert.match(`${once.stdout}${once.stderr}`, /known flake \(passed on retry, not to be diagnosed\)/);
  assert.doesNotMatch(`${once.stdout}${once.stderr}`, /UNLISTED/);

  const twice = runHookAgainstFixture(FLAKY_ASSERT_FILE, { env: { PM_STUB_ALWAYS: "1", PM_STUB_MARKER: marker() }, extraFiles: known });
  assert.notEqual(twice.status, 0, "a test that fails on the retry too is a real failure");
  assert.match(`${twice.stdout}${twice.stderr}`, /tests FAILED -- full output follows/);
  assert.doesNotMatch(`${twice.stdout}${twice.stderr}`, /^pre-commit: \d+\/\d+ passing/m);
});
