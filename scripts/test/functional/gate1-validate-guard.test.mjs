// gh#243 — the real spawn path behind the Gate 1 validate guard, against a fake `openspec` on PATH.
// The assertion twin (same id) pins the guard's behaviour through the PM_OPENSPEC_VALIDATE seam; this file
// proves the part that seam skips: the exact argv, and that the EXIT STATUS decides, not the last output line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo, fixtureCommits } from "../fixtures/functional-harness.mjs";

function repoWithFakeOpenspec(script) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "e"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "config.yaml"), "schema: spec-driven\n");
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "e", "proposal.md"), "# p\n");
  const bin = path.join(cwd, "fake-bin");
  fs.mkdirSync(bin);
  const argvLog = path.join(bin, "argv.log");
  if (script !== null) {
    fs.writeFileSync(path.join(bin, "openspec"), `#!/bin/sh\necho "$@" >> "${argvLog}"\n${script}\n`, { mode: 0o755 });
  }
  return { cwd, bin, argvLog, env: { PATH: bin, PM_OPENSPEC_VALIDATE: undefined, PM_OPENSPEC_VERSION: "" } };
}
const G1 = ["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--reviewer", "r", "--artifact", "openspec/changes/e"];
const gate1 = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).epics[0].gateReview;
const stderrOf = (e) => String(e.stderr || e.message);

test("243.1 a validate that exits non-zero refuses the pass even though its LAST line reads like success", () => {
  const { cwd, env, argvLog } = repoWithFakeOpenspec('echo "a requirement over 500 characters" >&2\necho "Totals: 1 failed"\necho "all done"\nexit 1');
  let err = null;
  try { run(G1, { cwd, env }); } catch (e) { err = e; }
  assert.ok(err, "refused");
  assert.match(stderrOf(err), /a requirement over 500 characters/);
  assert.equal(fs.readFileSync(argvLog, "utf8").trim(), "validate e --strict", "exactly this argv, no other");
  assert.equal(fs.existsSync(path.join(cwd, ".conductor", "state.json")) && gate1(cwd) !== undefined, false);
});

test("243.2 a validate that exits 0 records the verdict", () => {
  const { cwd, env } = repoWithFakeOpenspec("exit 0");
  run(G1, { cwd, env });
  assert.equal(gate1(cwd).gate1.verdict, "pass");
});

test("243.3 no openspec on PATH is cannot-tell: the verdict is recorded", () => {
  const { cwd, env } = repoWithFakeOpenspec(null);
  run(G1, { cwd, env });
  assert.equal(gate1(cwd).gate1.verdict, "pass");
});

test("243.9 a validate killed by a signal is cannot-tell, never a refusal", () => {
  const { cwd, env } = repoWithFakeOpenspec("kill -9 $$");
  run(G1, { cwd, env });
  assert.equal(gate1(cwd).gate1.verdict, "pass");
});

test("243.10 validate is spawned with telemetry disabled even when the user's environment enables it", () => {
  const { cwd, env, bin } = repoWithFakeOpenspec("exit 0");
  const envLog = path.join(bin, "env.log");
  fs.writeFileSync(path.join(bin, "openspec"), `#!/bin/sh\necho "T=$OPENSPEC_TELEMETRY D=$DO_NOT_TRACK" >> "${envLog}"\nexit 0\n`, { mode: 0o755 });
  run(G1, { cwd, env: { ...env, OPENSPEC_TELEMETRY: "1", DO_NOT_TRACK: "0" } });
  assert.match(fs.readFileSync(envLog, "utf8"), /T=0 D=1/);
});

test("243.12 a range-only Gate 1 pass (no --artifact) validates the epic's own live change", () => {
  const { cwd, env } = repoWithFakeOpenspec("echo bad >&2\nexit 1");
  const [base, head] = fixtureCommits(cwd, ["base", "head"]);
  let err;
  try { run(["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--reviewer", "r", "--base-sha", base, "--head-sha", head], { cwd, env: { ...env, PATH: `${env.PATH}:${process.env.PATH}` } }); } catch (e) { err = e; }
  assert.ok(err, "refused");
  assert.match(stderrOf(err), /a gate 1 'pass' cannot be recorded/);
  assert.equal(gate1(cwd), undefined);
});
