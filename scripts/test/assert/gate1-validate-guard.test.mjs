// gh#243 — `record-gate-review --gate 1 --verdict pass` refuses while the change it names fails
// `openspec validate --strict`. The assertion half spawns nothing, so the answer comes from the
// PM_OPENSPEC_VALIDATE seam; the functional twin (same ids) drives a real `openspec` on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo, readState, expectFail } from "../fixtures/assert-harness.mjs";

const write = (cwd, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), text);
};
function repo({ project = true } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  if (project) write(cwd, "openspec/config.yaml", "schema: spec-driven\n");
  write(cwd, "openspec/changes/e/proposal.md", "# proposal\n");
  return cwd;
}
const G1 = (extra = []) => ["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--reviewer", "r",
  "--artifact", "openspec/changes/e", ...extra];
const recorded = (cwd) => readState(cwd).epics[0].gateReview;
const stderrOf = (err) => String(err.stderr || err.message);

test("243.1 a failing validate refuses the Gate 1 pass, shows validate's output, and writes nothing", () => {
  const cwd = repo();
  const err = expectFail(() => run(G1(), { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:requirement over 500 characters" } }));
  assert.ok(err, "refused");
  const text = stderrOf(err);
  assert.match(text, /a gate 1 'pass' cannot be recorded/);
  assert.match(text, /requirement over 500 characters/, "the hidden failure is shown");
  assert.match(text, /UNPIPED/);
  assert.match(text, /Nothing was written/);
  assert.equal(recorded(cwd), undefined);
});

test("243.2 a passing validate records the verdict as before", () => {
  const cwd = repo();
  run(G1(), { cwd, env: { PM_OPENSPEC_VALIDATE: "pass" } });
  assert.equal(recorded(cwd).gate1.verdict, "pass");
});

test("243.3 CANNOT-TELL never refuses: no CLI, a timeout, a signal all read unknown", () => {
  const cwd = repo();
  run(G1(), { cwd, env: { PM_OPENSPEC_VALIDATE: "unknown" } });
  assert.equal(recorded(cwd).gate1.verdict, "pass");
});

test("243.4 no OpenSpec project (no openspec/config.yaml) means nothing to validate: not asked, not refused", () => {
  const cwd = repo({ project: false });
  run(G1(), { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:would refuse if asked" } });
  assert.equal(recorded(cwd).gate1.verdict, "pass");
});

test("243.5 the guard binds a PASS only: a Gate 1 fail is evidence of a failed review and is always recordable", () => {
  const cwd = repo();
  run(["record-gate-review", "e", "--gate", "1", "--verdict", "fail", "--reviewer", "r", "--artifact", "openspec/changes/e"],
    { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:x" } });
  assert.equal(recorded(cwd).gate1.verdict, "fail");
});

test("243.6 only LIVE change paths are validated: an archived path or a non-openspec artifact is not asked", () => {
  const cwd = repo();
  write(cwd, "docs/plan.md", "# plan\n");
  write(cwd, "openspec/changes/archive/2026-01-02-old/proposal.md", "# old\n");
  const env = { PM_OPENSPEC_VALIDATE: "fail:would refuse if asked" };
  run(["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--artifact", "docs/plan.md",
    "--artifact", "openspec/changes/archive/2026-01-02-old/proposal.md"], { cwd, env });
  assert.equal(recorded(cwd).gate1.verdict, "pass");
});

test("243.7 a file artifact inside a live change is enough to name the change", () => {
  const cwd = repo();
  const err = expectFail(() => run(["record-gate-review", "e", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/e/proposal.md"], { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:bad" } }));
  assert.ok(err);
});

test("243.8 a change directory that is not on disk is not validated (nothing to fail)", () => {
  const cwd = repo();
  fs.rmSync(path.join(cwd, "openspec/changes/e"), { recursive: true });
  run(["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--artifact", "openspec/changes/e/proposal.md"],
    { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:bad" } });
  assert.equal(recorded(cwd).gate1.verdict, "pass");
});

test("243.9 validate's output is control-escaped and capped before it reaches the terminal", () => {
  const cwd = repo();
  const long = "escape \u001b[31mred\n" + Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const err = expectFail(() => run(G1(), { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:" + long } }));
  const text = stderrOf(err);
  assert.match(text, /more lines omitted/);
  assert.doesNotMatch(text, /\u001b\[31m/);
});

test("243.10 validate is spawned with telemetry disabled whatever the user's environment says", async () => {
  const { validateSpawnEnv } = await import("../../lib/tool-currency.mjs");
  const env = validateSpawnEnv({ PATH: "/bin", OPENSPEC_TELEMETRY: "1", DO_NOT_TRACK: "0" });
  assert.equal(env.OPENSPEC_TELEMETRY, "0");
  assert.equal(env.DO_NOT_TRACK, "1");
  assert.equal(env.PATH, "/bin", "the rest of the environment is passed through");
  const bare = validateSpawnEnv({});
  assert.equal(bare.OPENSPEC_TELEMETRY, "0");
  assert.equal(bare.DO_NOT_TRACK, "1");
});
test("243.11 an absolute artifact path inside the live change still names it", () => {
  const cwd = repo();
  const abs = fs.realpathSync(cwd) + "/openspec/changes/e/proposal.md";
  const err = expectFail(() => run(["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--artifact", abs],
    { cwd, env: { PM_OPENSPEC_VALIDATE: "fail:bad" } }));
  assert.ok(err, "refused");
});

test("243.12 an artifact-less Gate 1 pass (the legacy range-only shape) validates the epic's own live change", async () => {
  const { validationTargets } = await import("../../lib/openspec-validate.mjs");
  assert.deepEqual(validationTargets([], "e"), ["e"], "no artifact: the epic's own change");
  assert.deepEqual(validationTargets(["docs/plan.md"], "e"), [], "an artifact outside any change names none, and is not second-guessed");
  assert.deepEqual(validationTargets(["openspec/changes/other/proposal.md"], "e"), ["other"], "an artifact wins over the epic id");
});

test("243.13 an unrecognised PM_OPENSPEC_VALIDATE value fails loudly instead of silently disabling the guard", () => {
  const cwd = repo();
  const err = expectFail(() => run(G1(), { cwd, env: { PM_OPENSPEC_VALIDATE: "bogus" } }));
  assert.ok(err);
  assert.match(stderrOf(err), /PM_OPENSPEC_VALIDATE/);
});
