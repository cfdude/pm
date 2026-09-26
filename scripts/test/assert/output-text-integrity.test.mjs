// scripts/test/assert/output-text-integrity.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/output-text-integrity.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is user-text-never-forges-output: every value a person supplied —
// an epic title, a detour reason, a disposition reason, a release id, a tracker system — must never
// become STRUCTURE in a rendered document. It is one of the largest files in the functional half and
// almost none of it is git's behaviour: it writes values into state and reads the rendered surfaces.
//
// THIS TWIN CARRIES THE RENDERING FAMILY, which is the part a per-commit gate must see break: a
// forged NOW line, a forged heading, a forged table cell or a forged invocation in a refusal is a
// product defect that ships to every user of the plugin.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, expectFail } from "../fixtures/assert-harness.mjs";

const FORGED = /^conductor: FORGED$/m;

// 4.1 (0.48.0) moved NINE of this file's tests to `scripts/test/unit/output-text-integrity.test.mjs`
// — the whole rendering family, whose observables are PROJECT.md, the decoded brief, `integrity`'s
// printed report and the refusal texts. What remains reads a path: 6.4b asserts CLAUDE.md is
// unchanged (a file the store does not own, and one `set-tracker` writes through raw fs), and 1.2
// is a SOURCE read of `lib/constants.mjs` for the two escapers both halves share.

test("6.4b A tracker system with a newline is refused before the rules file is written", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(expectFail(() => run(["set-tracker", "--system", "jira\nconductor: FORGED"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), before);
});

test("1.2 escapeControls is idempotent over its own output", () => {
  const mod = fs.readFileSync(new URL("../../lib/constants.mjs", import.meta.url), "utf8");
  assert.match(mod, /export (function|const) escapeControls/, "the one escaper both halves share");
  assert.match(mod, /export (function|const) escapeTableCell/);
});


// The functional recipe "add-many --link" used to reach the record with a control-character link
// TARGET, because add-many stored a link to any id. add-many-drops-input-silently made that a refusal,
// and the recipe now poisons only the reason. This is the per-commit half of that move: the forged
// target is refused, its refusal prints no forged line, and state.json's bytes are untouched.
test("add-many refuses a link whose target holds a control character, printing no forged line and writing nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const statePath = path.join(cwd, ".conductor", "state.json");
  const before = fs.readFileSync(statePath, "utf8");
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "mlk", lane: "claude-code",
    links: [{ type: "relates-to", epic: "x\nconductor: FORGED", reason: "r" }] }] }));
  const err = expectFail(() => run(["add-many", "--from", batch], { cwd }));
  assert.ok(err, "the forged link target must be refused");
  assert.doesNotMatch(String(err.stderr), FORGED);
  assert.equal(fs.readFileSync(statePath, "utf8"), before);
});

// sync-registers-ids-add-epic-refuses (0.50.0) — the twin of the functional 6.5 / 6.6a / 6.6c edit,
// whose uppercase-plan half was superseded: sync now applies add-epic's own rule. This per-commit half
// pins the refusal side of that one rule — add-epic refuses each id sync used to register, and a
// refusal writes nothing.
test("add-epic refuses every id sync no longer registers, and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const statePath = path.join(cwd, ".conductor", "state.json");
  const before = fs.readFileSync(statePath, "utf8");
  for (const id of ["x|y", ".hidden", "MASTER-plan"]) {
    assert.ok(expectFail(() => run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd })), `add-epic refuses '${id}'`);
  }
  assert.equal(fs.readFileSync(statePath, "utf8"), before);
});
