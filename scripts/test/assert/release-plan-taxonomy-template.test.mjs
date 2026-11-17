// scripts/test/assert/release-plan-taxonomy-template.test.mjs
// release-planning-taxonomy 7.2 (FILE rung; specs initiative-record, non-goals, release-planning, project-boards D13): the release plan
// template draws the Initiatives section, each release's purpose, goal, split and scope line, and the "Not doing" lists. Loads the template
// BYTES, cuts out the marked render block and evaluates it under node:vm with no DOM, over hostile fixture docs. Reads files and runs
// vm only: no spawn, no git.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMPLATE = fs.readFileSync(path.join(REPO, "skills", "project-boards", "templates", "release-plan.html"), "utf8");
const BEGIN = "/* pm:render-begin */", END = "/* pm:render-end */";
const block = TEMPLATE.slice(TEMPLATE.indexOf(BEGIN) + BEGIN.length, TEMPLATE.indexOf(END));
const { renderPlan, fromSnapshot } = vm.runInNewContext(`${block}\n;({renderPlan,fromSnapshot})`, Object.create(null));
const shell = (html) => html.replace(/"[^"]*"/g, '""');
const attrNames = (html) => (shell(html).match(/<[a-zA-Z][^>]*>/g) || []).flatMap(t => [...t.matchAll(/\s([a-zA-Z_:][\w:.-]*)(?==)/g)].map(m => m[1].toLowerCase()));
const tags = (html) => (html.match(/<([a-zA-Z][a-zA-Z0-9]*)/g) || []).map(t => t.slice(1).toLowerCase());

const R = (id, o = {}) => ({
  id, intent: `intent ${id}`, theme: `theme ${id}`, rationale: "why", exit: "exit", order: 1, size: "minor", status: "planned", delivered: false,
  criticalPath: null, members: [], deferred: [], initiative: null, maintenance: false, splitReason: null, primaryServed: null,
  planningBaseline: null, addedSincePlanning: null, unknownJoinTime: null, nonGoals: [],
  split: { initiativeWork: 0, health: 0, unaligned: 0, healthShare: null, target: 0.2, drift: null }, ...o,
});
const I = (id, o = {}) => ({
  id, title: `Title of ${id}`, capability: `Capability of ${id}`, status: "open", outcome: null, endedAt: null, source: null, offMissionReason: null,
  nonGoals: [], milestones: [], ...o,
});
const input = (o = {}) => ({
  epics: [], releases: [], plan: { here: null, hereText: null, nextText: null, head: "abc1234", asOf: "2026-11-10T00:00:00Z" }, mission: null,
  criteria: [], decisions: [], answers: [], info: {}, admin: true, canWrite: true, initiatives: [], ...o,
});
const html = (o) => renderPlan(input(o)).html;
const BAD = "<img src=x onerror=alert(1)>";

test("7.2 the Initiatives section: title, capability, status, source, milestones with reached marks, every value escaped", () => {
  const out = html({ initiatives: [
    I("boards", { source: "docs/plan.md", milestones: [{ id: "m1", text: "Live in every repo", reachedAt: "2026-11-05T00:00:00Z", evidence: "26 repos" }, { id: "m2", text: "Phone layout", reachedAt: null, evidence: null }] }),
    I("reporting", { status: "ended", outcome: "delivered" }),
  ] });
  assert.match(out, /data-initiative="boards"/);
  assert.match(out, /Title of boards/);
  assert.match(out, /Capability of boards/);
  assert.match(out, /docs\/plan\.md/);
  assert.match(out, /Live in every repo/);
  assert.match(out, /data-milestone="m1"[^>]*data-reached="true"/);
  assert.match(out, /data-milestone="m2"[^>]*data-reached="false"/);
  assert.match(out, /26 repos/);
  assert.match(out, /ended \(delivered\)/);
  assert.match(out, /initiative milestone/i, "the human surface says initiative milestone");
});

test("7.2 UNGROUNDED is marked, and a recorded source is not", () => {
  const out = html({ initiatives: [I("a", { source: "UNGROUNDED" }), I("b", { source: "docs/x.md" })] });
  assert.match(out, /data-initiative="a"[\s\S]*?class="tag tag--crit">UNGROUNDED</);
  const b = out.slice(out.indexOf('data-initiative="b"'));
  assert.doesNotMatch(b.slice(0, b.indexOf("</details>") > -1 ? b.indexOf("</details>") : 600), /UNGROUNDED/);
});

test("7.2 no initiatives: a guided empty state naming the verb and that the agent derives candidates, never a bare 'not set'", () => {
  const out = html({ initiatives: [] });
  assert.match(out, /data-need="initiatives"/);
  assert.match(out, /initiative &lt;id&gt; --title/);
  assert.match(out, /--capability/);
  assert.match(out, /derives/i);
  assert.doesNotMatch(out, /not set/i);
});

test("7.2 a release card shows its primary initiative's title, 'Maintenance', or a guided empty state naming both verbs", () => {
  const withInit = html({ initiatives: [I("boards")], releases: [R("r1", { initiative: "boards" })] });
  const near = (out, marker) => out.slice(out.indexOf(marker), out.indexOf(marker) + 300);
  assert.match(near(withInit, 'data-purpose="r1"'), /Title of boards/);
  const maint = html({ releases: [R("r1", { maintenance: true })] });
  assert.match(near(maint, 'data-purpose="r1"'), /Maintenance/);
  assert.doesNotMatch(maint, /data-need="purpose-r1"/, "a maintenance release renders no guided empty state");
  const none = html({ releases: [R("r1")] });
  assert.match(none, /data-need="purpose-r1"/);
  assert.match(none, /release r1 --initiative &lt;id&gt;/);
  assert.match(none, /--maintenance/);
  const shipped = html({ releases: [R("r0", { status: "shipped" })] });
  assert.doesNotMatch(shipped, /data-need="purpose-r0"/, "a shipped release owes no purpose card");
});

test("7.2 the release's theme is labelled Goal on the card", () => {
  assert.match(html({ releases: [R("r1", { theme: "Lock the API" })] }), /<dt>Goal<\/dt><dd>Lock the API<\/dd>/);
});

test("7.2 the split with the unaligned count, the drift mark and the recorded reason", () => {
  const split = { initiativeWork: 7, health: 0, unaligned: 3, healthShare: 0, target: 0.2, drift: true };
  const out = html({ releases: [R("r1", { split, splitReason: "platform migration" })] });
  assert.match(out, /data-split="r1"/);
  assert.match(out, /7 initiative work/);
  assert.match(out, /3 unaligned/);
  assert.match(out, /by epic count/);
  assert.match(out, /health 0%/);
  assert.match(out, /DRIFT/);
  assert.match(out, /platform migration/);
  const fine = html({ releases: [R("r1", { split: { initiativeWork: 8, health: 2, unaligned: 0, healthShare: 0.2, target: 0.2, drift: false } })] });
  assert.doesNotMatch(fine, /DRIFT/);
  assert.match(fine, /health 20%/);
  assert.doesNotMatch(html({ releases: [R("r1")] }), /data-split="r1"/, "no members, no split line");
});

test("7.2 the unserved-primary warning and the scope-added line", () => {
  const out = html({ initiatives: [I("boards")], releases: [R("r1", { initiative: "boards", primaryServed: false, addedSincePlanning: 2, unknownJoinTime: 1,
    planningBaseline: "2026-11-01T00:00:00Z" })] });
  assert.match(out, /data-warn="unserved-r1"/);
  assert.match(out, /no member serves/i);
  assert.match(out, /2 epics added since the first member started/);
  const one = html({ releases: [R("r1", { addedSincePlanning: 1, planningBaseline: "2026-11-01T00:00:00Z" })] });
  assert.match(one, /1 epic added since the first member started/);
  const served = html({ releases: [R("r1", { primaryServed: true })] });
  assert.doesNotMatch(served, /data-warn="unserved-r1"/);
});

test("7.2 'Not doing' lists for the mission, an initiative and a release, and no empty heading", () => {
  const out = html({
    mission: { statement: "Ship it", milestoneRelease: null, nonGoals: [{ id: "n1", text: "No Jira sync" }] },
    initiatives: [I("boards", { nonGoals: [{ id: "n1", text: "No hosted service" }] })],
    releases: [R("r1", { nonGoals: [{ id: "n1", text: "No SSO" }] })],
  });
  for (const t of ["No Jira sync", "No hosted service", "No SSO"]) assert.ok(out.includes(t), t);
  assert.equal((out.match(/Not doing/g) || []).length, 3);
  const bare = html({ mission: { statement: "Ship it", nonGoals: [] }, initiatives: [I("boards")], releases: [R("r1")] });
  assert.doesNotMatch(bare, /Not doing/, "no non-goals, no heading");
});

test("7.2 hostile title, capability, milestone, non-goal, evidence, source and split-reason text stays inert", () => {
  const out = html({
    mission: { statement: "Ship it", milestoneRelease: null, nonGoals: [{ id: "n1", text: BAD }] },
    initiatives: [I("boards", { title: BAD, capability: BAD, source: BAD, nonGoals: [{ id: "n1", text: BAD }],
      milestones: [{ id: "m1", text: BAD, reachedAt: "2026-11-05T00:00:00Z", evidence: BAD }] })],
    releases: [R("r1", { initiative: "boards", nonGoals: [{ id: "n1", text: BAD }], splitReason: BAD,
      split: { initiativeWork: 1, health: 0, unaligned: 0, healthShare: 0, target: 0.2, drift: true } })],
  });
  assert.ok(!tags(out).includes("img"), "no <img> element");
  assert.ok(!attrNames(out).includes("onerror"), "no onerror attribute");
  assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;"), "the text is shown escaped");
  const hostile = '</script><script>alert(1)</script>';
  const out2 = html({ releases: [R("r1", { nonGoals: [{ id: "n1", text: hostile }], splitReason: '<b onmouseover=alert(1)>x',
    split: { initiativeWork: 1, health: 0, unaligned: 0, healthShare: 0, target: 0.2, drift: true } })] });
  assert.ok(!tags(out2).includes("script"));
  assert.ok(!attrNames(out2).includes("onmouseover"));
});

test("7.2 a malformed id, a non-array and a wrong type in the new fields draw nothing and never throw", () => {
  const out = html({
    initiatives: [I("Bad Id"), { id: "ok", title: 7, capability: null, nonGoals: "x", milestones: {} }, null, "x"],
    releases: [R("r1", { initiative: "Bad Id", nonGoals: "nope", split: "nope", addedSincePlanning: "x" })],
    mission: { statement: "s", nonGoals: { not: "an array" } },
  });
  assert.ok(!out.includes('data-initiative="Bad Id"'));
  assert.match(out, /data-initiative="ok"/);
});

test("7.2 the standalone snapshot path carries the initiatives and the mission non-goals", () => {
  const snap = { initiatives: [I("boards")], missionNonGoals: [{ id: "n1", text: "No Jira sync" }], mission: { statement: "s", setAt: "t", reason: "r" },
    releases: [R("r1")], epics: [], plan: { here: null }, asOf: "2026-11-10T00:00:00Z", project: { name: null, key: null } };
  const norm = fromSnapshot(snap);
  assert.equal(norm.initiatives.length, 1);
  assert.equal(norm.mission.nonGoals.length, 1);
  assert.ok(renderPlan(norm).html.includes("No Jira sync"));
});
