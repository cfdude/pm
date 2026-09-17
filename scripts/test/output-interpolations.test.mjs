// The per-interpolation output sweep, run by the suite (user-text-never-forges-output, Gate 2 U2-I1).
// The method is in output-interpolations.mjs and the declared judgments in
// output-interpolations.judged.mjs. Before this test existed the sweep lived in the change directory,
// guarded nothing after the commit that ran it, and resolved its repository from a path that the
// change's own archive would have broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO, sweepInterpolations, sweptFiles } from "./output-interpolations.mjs";
import { JUDGED } from "./output-interpolations.judged.mjs";

const source = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
/** Sweep with ONE file's text replaced by `mutate(text)`; the replacement must apply exactly once. */
function sweepMutated(rel, from, to) {
  const text = source(rel);
  assert.equal(text.split(from).length - 1, 1, `mutation anchor occurs exactly once in ${rel}: ${from}`);
  return sweepInterpolations({ read: (r) => (r === rel ? text.replace(from, () => to) : source(r)) });
}

test("the sweep resolves the repository from scripts/test and reaches the engine's files", () => {
  const files = sweptFiles();
  assert.ok(files.includes("scripts/conductor.mjs") && files.includes("scripts/lib/claims.mjs"));
  for (const rel of files) assert.ok(fs.existsSync(path.join(REPO, rel)), rel);
});

test("every interpolation into engine output is escaped, literal, sunk or judged — no UNCLASSIFIED, STALE, EXCESS or WIDE", () => {
  const { rows, findings } = sweepInterpolations();
  assert.ok(rows.length > 1000, `the sweep saw ${rows.length} interpolations`);
  assert.deepEqual(findings, []);
});

test("mutant (Gate 2 U2-I1): a raw stored session in claim()'s takeover line is UNCLASSIFIED", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs",
    "from session '${escapeControls(held.session)}' ", "from session '${held.session}' ");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/claims\.mjs:\d+ \[claim\] \$\{\} held\.session$/.test(f)), findings.join("\n"));
});

test("mutant (Gate 2 U2-I1): a raw title added to supersedeAmended()'s withdrawal command is UNCLASSIFIED", () => {
  const { findings } = sweepMutated("scripts/lib/subcommands.mjs",
    "`update-epic ${printedId(epic.id)} --withdraw-commit", "`update-epic ${printedId(epic.id)} ${epic.title} --withdraw-commit");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/subcommands\.mjs:\d+ \[supersedeAmended\] \$\{\} epic\.title$/.test(f)), findings.join("\n"));
});

test("a second copy of a judged expression is EXCESS, and a judged expression that is gone is STALE", () => {
  const excess = sweepMutated("scripts/lib/claims.mjs", "claimExpiry(epic.claim)}", "claimExpiry(epic.claim)} ${claimExpiry(epic.claim)}");
  assert.ok(excess.findings.some(f => /^EXCESS scripts\/lib\/claims\.mjs \[claim\] "claimExpiry\(epic\.claim\)"/.test(f)), excess.findings.join("\n"));
  const stale = sweepMutated("scripts/lib/claims.mjs", "until ${claimExpiry(epic.claim)}", "until later");
  assert.ok(stale.findings.some(f => /^STALE scripts\/lib\/claims\.mjs \[claim\] "claimExpiry\(epic\.claim\)"/.test(f)), stale.findings.join("\n"));
});

test("only a sink-flow or json judgment may cover a whole declaration", () => {
  const wide = { file: "scripts/lib/claims.mjs", fn: "claim", re: /.*/, class: "engine", why: "a whole function" };
  const { findings } = sweepInterpolations({ judged: [...JUDGED, wide] });
  assert.ok(findings.some(f => /^WIDE scripts\/lib\/claims\.mjs \[claim\] \/\.\*\/: a engine judgment/.test(f)), findings.join("\n"));
  for (const jd of JUDGED) {
    if (jd.exact === undefined) assert.ok(["sink-flow", "json"].includes(jd.class), `${jd.file} [${jd.fn}] is function-wide as ${jd.class}`);
    assert.ok(typeof jd.why === "string" && jd.why.trim(), `${jd.file} [${jd.fn}] carries a reason`);
  }
});
