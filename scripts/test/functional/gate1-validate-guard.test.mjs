// gh#243 — the real spawn path behind the Gate 1 validate guard, against a fake `openspec` on PATH.
// The assertion twin (same id) pins the guard's behaviour through the PM_OPENSPEC_VALIDATE seam; this file
// proves the part that seam skips: the exact argv, and that the EXIT STATUS decides, not the last output line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo } from "../fixtures/functional-harness.mjs";

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
