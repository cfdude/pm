// scripts/test/assert/taxonomy-skills.test.mjs
// release-planning-taxonomy 7.1 (FILE rung; specs initiative-record, release-planning): the two skills carry the procedures the engine
// cannot run: derive-and-confirm in the project-boards skill, and the challenge-once rule, the orchestrating-agent-first order and the two
// destinations for a tweak in the conductor skill. Reads files only.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
/** The text from `## <heading>` to the next `## ` heading. */
const section = (text, heading) => {
  const i = text.indexOf(`\n## ${heading}`);
  assert.ok(i > -1, `${heading} exists`);
  const rest = text.slice(i + 1);
  const j = rest.slice(3).search(/\n## /);
  return j === -1 ? rest : rest.slice(0, j + 3);
};

test("7.1 project-boards First population: cluster the backlog, --source and UNGROUNDED, 'Does this make sense?', never ask the user to name one, nothing unconfirmed is written", () => {
  const s = section(read("skills", "project-boards", "SKILL.md"), "First population");
  assert.match(s, /clust/i);
  assert.match(s, /backlog/);
  assert.match(s, /initiative/i);
  assert.match(s, /initiative milestone/i);
  assert.match(s, /--source/);
  assert.match(s, /UNGROUNDED/);
  assert.match(s, /Does this make sense\?/);
  assert.match(s, /never (ask|has) the user to name|does not ask the user to name|never ask the user to name/i);
  assert.match(s, /nothing unconfirmed is written|writes nothing that the user did not confirm|only (what|answers) .*confirm/i);
  assert.match(s, /release-planning|primary initiative/i);
  assert.match(s, /`--kind`|epic kind|kind/);
});

test("7.1 project-boards documents the initiatives collection and the mission non-goals the release plan draws", () => {
  const t = read("skills", "project-boards", "SKILL.md");
  assert.match(t, /`initiatives\/<id>`/);
  assert.match(t, /\{"path":"initiatives","read":"view","write":"admin"\}/);
  assert.match(t, /missionNonGoals/);
  assert.match(t, /"Goal"/);
});

test("7.1 conductor Intake: both reason flags, once, initiatives as well as epics, the recorded reason first, the claude-code exemption, the orchestrating agent first", () => {
  const s = section(read("skills", "conductor", "SKILL.md"), "Intake — triage an ask BEFORE it becomes an epic");
  assert.match(s, /--off-mission-reason/);
  assert.match(s, /--off-initiative-reason/);
  assert.match(s, /\bonce\b/i);
  assert.match(s, /initiatives? (as well as|and) epics|each initiative/i);
  assert.match(s, /recorded reason/i);
  assert.match(s, /board --json/);
  assert.match(s, /claude-code/);
  assert.match(s, /exempt/i);
  assert.match(s, /orchestrating agent/i);
  assert.ok(s.search(/orchestrating agent/i) < s.search(/the human|the user/i) || /before the (human|user)/i.test(s), "the orchestrating agent answers before the human");
});

test("7.1 conductor Intake: the two destinations for a tweak, with the maintenance epic's lane, kind, membership, attribution and end", () => {
  const s = section(read("skills", "conductor", "SKILL.md"), "Intake — triage an ask BEFORE it becomes an epic");
  assert.match(s, /maintenance-<releaseId>/);
  assert.match(s, /--lane claude-code/);
  assert.match(s, /--kind health/);
  assert.match(s, /release <releaseId> --member|--member maintenance-/);
  assert.match(s, /--attribute-commit/);
  assert.match(s, /ends? with the release|end(ed)? with the release|normal disposition/i);
  assert.match(s, /small `claude-code` epic/);
  assert.match(s, /moves an initiative|names? (that|the) initiative/i);
});
