// scripts/test/autonomy-revocation.test.mjs
// `epic-autonomy` — the inverse `--preauthorize` never shipped, and the two rules that come with it:
// a grant names something, and re-arming autonomy says what it restores.
//
// WHERE THE SPEC PUTS THEM. Every test below is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/epic-autonomy/spec.md, named for it, so a
// reader can go from the requirement to the assertion without a search. The measured instance the
// capability exists for: on 0.45.0, `set-autonomy a1 --preauthorize "rm -rf build/:it is
// regenerated"` then `--level off` exits 0 with the grant intact and nothing able to take it back,
// so turning autonomy back on silently restores every prior grant.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// NINETEEN of its twenty tests moved to `scripts/test/unit/autonomy-revocation.test.mjs` — every one
// whose observable is a VALUE: a grant's shape on the record, a refusal's text, or what
// `set-autonomy` PRINTED.
//
// WHAT STAYS is `1.10`'s first test, and its subject is a DOCUMENT: it reads the three shipped
// mirrors (`skills/conductor/SKILL.md`, `commands/epic.md`, `commands/status.md`) with
// `readFileSync`, alongside the rendered block, and asserts on the PROSE of all four. Its sibling —
// the decision-rule test — asserts on the RENDERED block alone and moved with the rest.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, tmpRepo } from "../fixtures/assert-harness.mjs";
import fs from "node:fs";
import path from "node:path";

// ───────── 1.10 The emitted instruction text: the third surface, and the falsified claim ─────────
//
// `epic-autonomy` names exactly three surfaces that discharge "a grant already on disk that names
// nothing authorises nothing": the re-arm report, the integrity check
// (stored-value-integrity.test.mjs), and THE EXECUTION-TIME DECISION RULE THIS PROJECT EMITS — the
// one an agent, not the engine, applies. No engine code path evaluates a grant against a candidate
// action, so there is no fourth reader to bind.
//
// The rules block also carried the very claim this change falsifies, as a live present-tense
// statement of how pm behaves. REWORD, NEVER DELETE: the measured evidence is what makes the
// required task item stick, and `gate-integrity`'s sweep requirement cites the same instance as a
// PAST measurement, which stays true. What stops being true is the present tense.

const REPO_ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const shippedText = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
/** The four surfaces that carry the item: the RENDERED block, plus the three shipped mirrors. */
const MIRRORS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];

function repoWithEpic(id = "a") {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd });
  return cwd;
}

test("1.10: the emitted inverse item states the grants instance as PAST measured evidence", () => {
  const cwd = repoWithEpic();
  const surfaces = [["rules block", run(["rules"], { cwd })], ...MIRRORS.map(m => [m, shippedText(m)])];
  for (const [name, text] of surfaces) {
    const flat = text.replace(/\s+/g, " ");
    assert.ok(!/grants accumulate with no revoke/.test(flat),
      `${name} still states the falsified claim in the present tense — pm ships --revoke now`);
    assert.ok(!/turning it back on silently restores all of them/.test(flat),
      `${name} still claims the restore is silent — --level autonomous reports what it arms`);
    assert.match(flat, /accumulated with no revoke/,
      `${name} must KEEP the instance as past measured evidence — deleting it removes what makes ` +
      "the required item stick, and a practice recorded without its evidence reads as a preference");
    assert.match(flat, /safety surface/, `${name} must keep the finding's classification`);
    assert.match(flat, /--revoke/, `${name} must name the inverse that closed it`);
  }
});
