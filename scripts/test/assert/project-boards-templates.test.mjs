// scripts/test/assert/project-boards-templates.test.mjs
// project-boards 6.2 (spec project-boards, design D13): the two page templates keep their render functions as pure
// data -> string builders inside ONE marked script block. This file loads the template BYTES, cuts out the block
// between `pm:render-begin` and `pm:render-end` and evaluates it under node:vm with no DOM, over hostile fixture
// docs. Every database document is untrusted, so each security requirement is asserted on the OUTPUT a viewer's
// browser would parse. Reads files and runs vm only: no spawn, no git.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMPLATES = path.join(REPO, "skills", "project-boards", "templates");
const bytes = (name) => fs.readFileSync(path.join(TEMPLATES, name), "utf8");
const BEGIN = "/* pm:render-begin */", END = "/* pm:render-end */";

function blockOf(text) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  assert.ok(a > -1 && b > a, "the template marks its render block");
  return text.slice(a + BEGIN.length, b);
}
/** Evaluate the render block with no DOM and return the named top-level bindings. */
function load(name, names) {
  return vm.runInNewContext(`${blockOf(bytes(name))}\n;({${names.join(",")}})`, Object.create(null));
}
/** The markup with every quoted attribute value blanked, so a regex sees only what the parser would treat as a name. */
const shell = (html) => html.replace(/"[^"]*"/g, '""');
const attrNames = (html) => (shell(html).match(/<[a-zA-Z][^>]*>/g) || []).flatMap(t => [...t.matchAll(/\s([a-zA-Z_:][\w:.-]*)(?==)/g)].map(m => m[1].toLowerCase()));
/** The vm realm has its own Object and Array prototypes, so a value built there is compared after a JSON round trip. */
const plain = (x) => JSON.parse(JSON.stringify(x));

const BACKLOG = "backlog.html", PLAN = "release-plan.html";
const SHARED = ["esc", "okId", "safeUrl", "prioOf", "inlineJson"];
const bl = () => load(BACKLOG, [...SHARED, "renderBacklog", "dropProposal", "dropAndWrite", "fromSnapshot"]);
const pl = () => load(PLAN, [...SHARED, "renderPlan", "fromSnapshot"]);

let pos = 0;
const E = (id, o = {}) => ({
  id, title: `Title of ${id}`, summary: `Summary of ${id}`, whyNow: "now", description: "", lane: "claude-code", status: "queued",
  priority: "P1", meritPriority: "P1", rank: null, position: pos++, release: null, externalUrl: null, dependsOn: [],
  delivered: false, outcome: null, outcomeReason: null, createdAt: null, endedAt: null, updatedAt: null, ...o,
});
const R = (id, o = {}) => ({ id, intent: `intent ${id}`, theme: `theme ${id}`, rationale: "why", exit: "exit", order: 1, size: "minor", status: "planned", delivered: false, criticalPath: null, members: [], deferred: [], ...o });
const bInput = (epics, o = {}) => ({ epics, releases: [], meta: {}, info: {}, admin: true, canWrite: true, ...o });
const pInput = (o = {}) => ({
  epics: [], releases: [], plan: { here: null, hereText: null, nextText: null, head: "abc1234", asOf: "2026-11-10T00:00:00Z" }, mission: null,
  criteria: [], decisions: [], answers: [], info: {}, admin: true, canWrite: true, ...o,
});

for (const name of [BACKLOG, PLAN]) {
  test(`6.2 ${name}: carries a marked render block, no remote script, no external stylesheet, both theme blocks and a title`, () => {
    const t = bytes(name);
    blockOf(t);
    assert.doesNotMatch(t, /<script[^>]*\ssrc=/i, "no <script src=");
    assert.doesNotMatch(t, /<link[^>]*stylesheet/i, "no external stylesheet");
    assert.match(t, /<title>[^<]{3,}<\/title>/);
    assert.match(t, /@media \(prefers-color-scheme: dark\)/);
    assert.match(t, /:root\[data-theme="dark"\]/);
    assert.match(t, /max\(16px, env\(safe-area-inset-left, 0px\)\)/);
    assert.match(t, /id="pm-snapshot"/);
  });

  test(`6.2 ${name}: every \${} interpolation in the render block goes through esc(), num() or H()`, () => {
    const b = blockOf(bytes(name));
    const bad = [];
    let from = 0, n = 0;
    for (;;) {
      const i = b.indexOf("${", from);
      if (i < 0) break;
      let depth = 1, j = i + 2;
      while (j < b.length && depth) { if (b[j] === "{") depth++; else if (b[j] === "}") depth--; j++; }
      const expr = b.slice(i + 2, j - 1).trim();
      n++;
      if (!/^(esc|num|H)\(/.test(expr)) bad.push(expr.slice(0, 60));
      from = i + 2;
    }
    assert.ok(n > 10, `the block interpolates (${n} sites), so this check is not over an empty set`);
    assert.deepEqual(bad, [], "an unescaped interpolation");
  });

  test(`8.11 ${name}: a markup string is concatenated only with esc(), num(), H() or a finished render part`, () => {
    const b = blockOf(bytes(name));
    const lit = /(["'])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
    const ok = /^(esc\(|num\(|H\(|parts\.)/;
    const bad = [];
    let m, n = 0;
    while ((m = lit.exec(b))) {
      if (!/<[A-Za-z/!]/.test(m[2])) continue;
      const after = b.slice(lit.lastIndex).match(/^\s*\+\s*([^\s+]{1,30})/);
      const before = b.slice(0, m.index).match(/([^\s+]{1,30})\s*\+\s*$/);
      for (const op of [after && after[1], before && before[1]]) { if (!op) continue; n++; if (!ok.test(op)) bad.push(op); }
    }
    assert.ok(n > 3, `the block concatenates markup (${n} sites), so this check is not over an empty set`);
    assert.deepEqual(bad, [], "a markup string concatenated with something that is not escaped");
  });

  test(`6.2 ${name}: H() never wraps a bare field, so a raw value cannot pass the interpolation check disguised as H(e.id)`, () => {
    const b = blockOf(bytes(name));
    const bare = [...b.matchAll(/\$\{\s*H\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+|\[[^\]]*\])+)\s*\)\s*\}/g)].map(m => m[0]);
    assert.deepEqual(bare, [], "a field reference goes through esc(), never H()");
  });

  test(`6.2 ${name}: esc escapes text, attribute and class positions; ids and URLs are checked; priority is allowlisted`, () => {
    const { esc, okId, safeUrl, prioOf, inlineJson } = load(name, SHARED);
    assert.equal(esc(`<img src=x onerror=alert(1)>"'&`), "&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
    assert.equal(esc(null), "");
    assert.equal(esc(42), "42", "a non-string goes through String()");
    for (const ok of ["a", "A.b_c-1", "x9"]) assert.equal(okId(ok), true, ok);
    for (const no of ['a"><b>', "a b", "", "a/b", 7, null, {}, ["a"]]) assert.equal(okId(no), false, String(no));
    assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
    assert.equal(safeUrl("http://example.com"), "http://example.com");
    for (const no of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:x", "data:text/html,x", "ftp://x.y", "//x.y", "https://x y", 'https://x"y', 5, null]) assert.equal(safeUrl(no), "", String(no));
    for (const p of ["P0", "P1", "P2", "P3", "P?"]) assert.equal(prioOf(p), p);
    for (const p of ['P1" onmouseover="x', "p1", "P4", "", null, undefined, 1, ["P1"]]) assert.equal(prioOf(p), "P?", String(p));
    const out = inlineJson({ s: "</script><script>alert(1)</script>", n: 1 });
    assert.ok(out.includes("\\u003c"));
    assert.equal(out.includes("<"), false);
    assert.deepEqual(JSON.parse(out), { s: "</script><script>alert(1)</script>", n: 1 });
  });

  test(`6.2 ${name}: the fallback's inlined snapshot holds \\u003c for every < and adds no </script`, () => {
    const { inlineJson } = load(name, SHARED);
    const t = bytes(name);
    const MARK = '<script type="application/json" id="pm-snapshot">null</script>';
    assert.ok(t.includes(MARK), "the template carries its empty data block exactly once");
    assert.equal(t.split(MARK).length, 2);
    const snap = { asOf: "x", epics: [{ id: "a", summary: "</script><script>alert(1)</script><!--" }], mission: null };
    const json = inlineJson(snap);
    const file = t.replace(MARK, `<script type="application/json" id="pm-snapshot">${json}</script>`);
    const closers = (s) => (s.match(/<\/script/gi) || []).length;
    assert.equal(closers(file), closers(t), "exactly the template's own closers: none added by the data");
    assert.equal(json.split("\\u003c").length - 1, (JSON.stringify(snap).match(/</g) || []).length, "one escape per <");
    const inner = file.slice(file.indexOf('id="pm-snapshot">') + 'id="pm-snapshot">'.length);
    assert.deepEqual(JSON.parse(inner.slice(0, inner.indexOf("</script>"))), snap);
  });
}

// ---------------------------------------------------------------- backlog

test("6.2 backlog: markup in a title renders as text, never as an element", () => {
  const { renderBacklog } = bl();
  const out = renderBacklog(bInput([E("a", { title: "<img src=x onerror=alert(1)>" })]));
  assert.match(out.html, /&lt;img/);
  assert.doesNotMatch(out.html, /<img/i);
  assert.ok(!attrNames(out.html).includes("onerror"));
});

test("6.2 backlog: a priority outside the allowlist renders P? in its label and class and nothing else", () => {
  const { renderBacklog } = bl();
  const out = renderBacklog(bInput([E("a", { priority: 'P1" onmouseover="x', meritPriority: 'P1" onmouseover="x' })]));
  assert.match(out.html, /class="[^"]*\bp-P\?/);
  assert.match(out.html, />P\?</);
  assert.ok(!attrNames(out.html).includes("onmouseover"));
});

test("6.2 backlog: status and release are escaped in text and class positions", () => {
  const { renderBacklog } = bl();
  const out = renderBacklog(bInput([E("a", { status: 'queued" onclick="x', release: 'r1" onclick="x' })]));
  assert.ok(!attrNames(out.html).includes("onclick"));
  assert.match(out.html, /st-other/);
  const out2 = renderBacklog(bInput([E("b", { status: "<b>x</b>" })]));
  assert.doesNotMatch(out2.html, /<b>x/);
  assert.match(out2.html, /&lt;b&gt;x/);
});

test("6.2 backlog: a javascript: URL renders no href and no javascript: inside any attribute", () => {
  const { renderBacklog } = bl();
  const out = renderBacklog(bInput([E("a", { externalUrl: "javascript:alert(1)" }), E("b", { externalUrl: "https://example.com/i/1" })]));
  assert.doesNotMatch(out.html, /href="javascript/i);
  assert.doesNotMatch(out.html, /="[^"]*javascript:/i, "no attribute value carries it");
  assert.match(out.html, /href="https:\/\/example\.com\/i\/1"/);
});

test("6.2 backlog: a malformed id is skipped and counted, and no markup from it reaches the page", () => {
  const { renderBacklog } = bl();
  const out = renderBacklog(bInput([E("good"), E('a"><b>')]));
  assert.equal(out.skipped, 1);
  assert.match(out.html, /Skipped 1 record/);
  assert.doesNotMatch(out.html, /a"><b>|a&quot;&gt;/, "the skipped id is not echoed, escaped or not");
  assert.match(out.html, /good/);
});

test("6.2 backlog: a malformed doc (string dependsOn, object title) renders while the rest of the board renders", () => {
  const { renderBacklog } = bl();
  const docs = [E("a"), E("b"), E("c"), E("bad", { dependsOn: "a", title: { x: 1 }, summary: ["s"], release: {}, status: 5 })];
  let out;
  assert.doesNotThrow(() => { out = renderBacklog(bInput(docs)); });
  for (const id of ["a", "b", "c", "bad"]) assert.ok(out.parts.rows.includes(`data-id="${id}"`), `row for ${id}`);
  assert.equal(out.skipped, 0);
  assert.doesNotMatch(out.html, /class="dep/, "no dependency tags from a string dependsOn");
  assert.doesNotMatch(out.html, /\[object Object\]/);
  const noDocs = [null, undefined, 7, "x", [], { id: 5 }, { id: "ok", get title() { throw new Error("hostile"); } }];
  assert.doesNotThrow(() => renderBacklog(bInput([E("fine"), ...noDocs])));
  assert.match(renderBacklog(bInput([E("fine"), ...noDocs])).parts.rows, /data-id="fine"/);
});

test("6.2 backlog: a throwing step is isolated; the other steps still render", () => {
  const { renderBacklog } = bl();
  const hostile = { get admin() { return true; }, epics: [E("a")], releases: [], meta: {}, get info() { throw new Error("boom"); }, canWrite: true };
  let out;
  assert.doesNotThrow(() => { out = renderBacklog(hostile); });
  assert.match(out.parts.info, /class="notice"/);
  assert.match(out.parts.counts, /1/);
  assert.match(out.parts.rows, /data-id="a"/);
});

test("6.2 backlog: rows are banded by merit priority; a lifted blocker has no drag handle and others have one", () => {
  const { renderBacklog } = bl();
  const docs = [E("lift", { priority: "P1", meritPriority: "P3" }), E("plain", { priority: "P1", meritPriority: "P1" })];
  const admin = renderBacklog(bInput(docs, { admin: true }));
  const rowOf = (html, id) => { const i = html.indexOf(`data-id="${id}"`); return html.slice(i, html.indexOf("</tbody>", i)); };
  assert.doesNotMatch(rowOf(admin.parts.rows, "lift"), /class="hd"/);
  assert.match(rowOf(admin.parts.rows, "plain"), /class="hd"/);
  assert.match(admin.parts.rows, /band-P3/);
  const viewer = renderBacklog(bInput(docs, { admin: false }));
  assert.doesNotMatch(viewer.parts.rows, /class="hd"/);
});

test("6.2 backlog: a within-band drop writes the whole merit band to proposals/rank and nothing else", async () => {
  const { dropProposal, dropAndWrite } = bl();
  const epics = [E("A"), E("B"), E("C"), E("Z", { priority: "P2", meritPriority: "P2" })];
  const p = dropProposal(epics, "B", "A", false);
  assert.equal(p.ok, true);
  assert.deepEqual(plain(p.proposal), { band: "P1", order: ["B", "A", "C"] });
  const writes = [];
  const db = { doc: (path) => ({ set: async (d) => { writes.push(["set", path, d]); }, update: async (d) => { writes.push(["update", path, d]); }, delete: async () => { writes.push(["delete", path]); } }) };
  const r = await dropAndWrite(db, epics, "B", "A", false, "me", "2026-11-10T00:00:00Z");
  assert.equal(r.ok, true);
  assert.deepEqual(plain(writes), [["set", "proposals/rank", { band: "P1", order: ["B", "A", "C"], by: "me", at: "2026-11-10T00:00:00Z" }]]);
  assert.deepEqual(plain(dropProposal(epics, "A", "C", true).proposal.order), ["B", "C", "A"], "after the target");
});

test("6.2 backlog: a cross-band drop is refused with the priority hint and writes nothing", async () => {
  const { dropProposal, dropAndWrite } = bl();
  const epics = [E("A"), E("B"), E("Z", { priority: "P2", meritPriority: "P2" })];
  const p = dropProposal(epics, "Z", "A", false);
  assert.equal(p.ok, false);
  assert.match(p.hint, /priority changes go through the agent/i);
  const writes = [];
  const db = { doc: (path) => ({ set: async () => writes.push(path), update: async () => writes.push(path), delete: async () => writes.push(path) }) };
  const r = await dropAndWrite(db, epics, "Z", "A", false, "me", "t");
  assert.equal(r.ok, false);
  assert.deepEqual(writes, []);
});

test("6.2 backlog: a lifted blocker cannot be dragged, and an unknown id is refused", () => {
  const { dropProposal } = bl();
  const epics = [E("A"), E("L", { priority: "P0", meritPriority: "P1" }), E("B")];
  assert.equal(dropProposal(epics, "L", "A", false).ok, false);
  assert.equal(dropProposal(epics, "nope", "A", false).ok, false);
  assert.equal(dropProposal(epics, "A", "nope", false).ok, false);
  assert.equal(dropProposal(epics, "A", "A", false).ok, false, "dropping on itself changes nothing");
});

test("6.2 backlog: an ended epic is placed by delivered: true under Delivered, false under Not pursuing with its outcome, null under outcome unknown", () => {
  const { renderBacklog } = bl();
  const ended = (id, delivered, outcome) => E(id, { status: "archived", delivered, outcome, outcomeReason: `why ${id}`, position: null });
  const out = renderBacklog(bInput([ended("yes", true, "delivered"), ended("no", false, "declined"), ended("huh", null, "unknown")]));
  assert.match(out.parts.delivered, /yes/);
  assert.doesNotMatch(out.parts.delivered, /huh|"no"|>no</);
  assert.match(out.parts.gone, /declined/);
  assert.doesNotMatch(out.parts.gone, /huh|yes/);
  assert.match(out.parts.unknown, /huh/);
  assert.match(out.parts.unknown, /outcome unknown/i);
  assert.doesNotMatch(out.parts.unknown, /yes|>no</);
});

test("6.2 backlog: a backlogMeta Not-pursuing mark moves an open epic to Not pursuing and Restore undoes it", () => {
  const { renderBacklog } = bl();
  const docs = [E("a"), E("b")];
  const marked = renderBacklog(bInput(docs, { meta: { a: { removed: true, reason: "Deferred", note: "later" } } }));
  assert.doesNotMatch(marked.parts.rows, /data-id="a"/);
  assert.match(marked.parts.rows, /data-id="b"/);
  assert.match(marked.parts.gone, /Deferred/);
  assert.match(marked.parts.gone, /data-restore="a"/);
  const restored = renderBacklog(bInput(docs, { meta: { a: { removed: false, reason: "Deferred" } } }));
  assert.match(restored.parts.rows, /data-id="a"/);
  const junk = renderBacklog(bInput(docs, { meta: { a: "x", b: { removed: { x: 1 }, reason: ["r"] } } }));
  assert.match(junk.parts.rows, /data-id="a"/);
});

test("6.2 backlog: dependency warning when a dependency is ranked below its dependent; fromSnapshot maps an export", () => {
  const { renderBacklog, fromSnapshot } = bl();
  const out = renderBacklog(bInput([E("A", { dependsOn: ["B"] }), E("B")]));
  assert.match(out.parts.rows, /dep--warn/);
  const mapped = fromSnapshot({ epics: [E("a")], releases: [R("r1")], asOf: "t", plan: { head: "h" } });
  assert.equal(mapped.epics.length, 1);
  assert.deepEqual(plain(mapped.meta), {});
  assert.equal(mapped.admin, false);
  assert.doesNotThrow(() => fromSnapshot(null));
});

// ---------------------------------------------------------------- release plan

test("6.2 release plan: markup in a title renders as text; a hostile release id stays inert", () => {
  const { renderPlan } = pl();
  const out = renderPlan(pInput({
    releases: [R("r1")],
    epics: [E("a", { title: "<img src=x onerror=alert(1)>", release: 'r1" onclick="x' }), E("b", { release: "r1", status: 'x" onfocus="y' })],
  }));
  assert.match(out.html, /&lt;img/);
  assert.doesNotMatch(out.html, /<img/i);
  const names = attrNames(out.html);
  for (const bad of ["onclick", "onerror", "onfocus"]) assert.ok(!names.includes(bad), bad);
});

test("6.2 release plan: a release id that fails the pattern is skipped and counted", () => {
  const { renderPlan } = pl();
  const out = renderPlan(pInput({ releases: [R("r1"), R('r2"><b>x')] }));
  assert.equal(out.skipped, 1);
  assert.doesNotMatch(out.html, /<b>x/);
  assert.match(out.parts.roadmap, /r1/);
});

test("6.2 release plan: priority allowlist, a javascript: URL and a malformed doc", () => {
  const { renderPlan } = pl();
  let out;
  assert.doesNotThrow(() => {
    out = renderPlan(pInput({
      releases: [R("r1")],
      epics: [E("a", { release: "r1", priority: 'P1" onmouseover="x', externalUrl: "javascript:alert(1)" }), E("b", { release: "r1", dependsOn: "a", title: { x: 1 } })],
    }));
  });
  assert.ok(!attrNames(out.html).includes("onmouseover"));
  assert.match(out.html, />P\?</);
  assert.doesNotMatch(out.html, /href="javascript/i);
  assert.match(out.parts.roadmap, /data-epic="b"/);
});

test("6.2 release plan: a throwing roadmap step shows its notice while counts, criteria and decisions still render", () => {
  const { renderPlan } = pl();
  const boom = R("r1");
  Object.defineProperty(boom, "theme", { get() { throw new Error("malformed release doc"); }, enumerable: true });
  let out;
  assert.doesNotThrow(() => {
    out = renderPlan(pInput({
      releases: [boom], epics: [E("a", { release: "r1" })],
      criteria: [{ id: "c1", text: "Exit criterion one", check: "run it", needsHuman: false }],
      decisions: [{ id: "1", question: "Ship it?", recommendation: "yes", askedAt: "2026-11-10" }],
    }));
  });
  assert.match(out.parts.roadmap, /class="notice"/);
  assert.match(out.parts.criteria, /Exit criterion one/);
  assert.match(out.parts.decisions, /Ship it\?/);
  assert.match(out.parts.decisions, /asked by the agent/i);
  assert.ok(out.parts.counts.length > 0);
});

test("6.2 release plan: the here marker, the critical path and the stale warning render from plan/state and the releases", () => {
  const { renderPlan } = pl();
  const out = renderPlan(pInput({
    releases: [R("r1", { criticalPath: true }), R("r2", { criticalPath: false })],
    plan: { here: "r1", hereText: "Building the export", nextText: "Skins", head: "abc1234", asOf: "2020-01-01T00:00:00Z" },
    mission: { statement: "Ship the thing", setAt: "t", reason: "r", milestoneRelease: "r1" },
  }));
  assert.match(out.parts.banner, /Building the export/);
  assert.match(out.parts.banner, /abc1234/);
  assert.match(out.parts.banner, /stale/i);
  assert.match(out.parts.roadmap, /we are here/i);
  assert.match(out.parts.roadmap, /critical path/i);
  assert.match(out.html, /Ship the thing/);
});

test("6.2 release plan: decisions and answers are type-checked, and fromSnapshot never throws", () => {
  const { renderPlan, fromSnapshot } = pl();
  const out = renderPlan(pInput({
    decisions: [{ id: "1", question: { a: 1 }, recommendation: ["x"], askedAt: 5 }, "junk", null, { id: 'bad"id', question: "q" }],
    answers: [{ id: "1", stance: "agree" }, "junk", null],
    criteria: "not an array",
  }));
  assert.ok(typeof out.html === "string");
  assert.doesNotMatch(out.html, /\[object Object\]/);
  assert.doesNotThrow(() => fromSnapshot({ epics: "x", releases: null }));
});

// ---------------------------------------------------------------- board redesign (tasks 8.8 to 8.11)
// Rob's live-board feedback 2026-11-11: project-named titles, engine keys as ids, an "Epics" table whose column is
// "Summary", human timestamps, compact cards, and a guided card for every field the page needs that is still null.

const TS = { now: Date.parse("2026-11-11T15:00:00Z"), locale: "en-US", timeZone: "UTC" };
/** Visible text only: tags removed, so a slug in data-id or an ISO string in an attribute is not counted as shown. */
const visible = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}/;
const blX = () => load(BACKLOG, [...SHARED, "renderBacklog", "when", "projOf", "matches", "filtering", "okKey"]);
const plX = () => load(PLAN, [...SHARED, "renderPlan", "when", "projOf", "okKey"]);
const PROJ = { name: "PM Plugin", key: "PM" };
const full = (id, n, o = {}) => E(id, { key: `PM-${n}`, number: n, updatedAt: "2026-11-08T09:30:00Z", createdAt: "2026-10-01T00:00:00Z", ...o });

for (const name of [BACKLOG, PLAN]) {
  test(`8.9 ${name}: when() gives "Nov 11, 2:10 PM", a relative tail only past one day, the year only across years, and nothing for a non-date`, () => {
    const { when } = load(name, ["when"]);
    assert.deepEqual(plain(when("2026-11-11T14:10:00Z", TS)), { abs: "Nov 11, 2:10 PM", rel: "" });
    assert.deepEqual(plain(when("2026-11-10T14:10:00Z", TS)), { abs: "Nov 10, 2:10 PM", rel: "1 day ago" });
    assert.equal(when("2026-11-08T09:30:00Z", TS).rel, "3 days ago");
    assert.equal(when("2026-10-01T09:30:00Z", TS).rel, "5 weeks ago");
    assert.equal(when("2025-06-01T09:30:00Z", TS).abs, "Jun 1, 2025, 9:30 AM");
    for (const bad of [null, undefined, 5, {}, "", "yesterday", "<b>"]) assert.deepEqual(plain(when(bad, TS)), { abs: "", rel: "" }, String(bad));
  });

  test(`8.8 ${name}: projOf keeps only a name and key set-project would accept; okKey takes only KEY-n`, () => {
    const { projOf, okKey } = load(name, ["projOf", "okKey"]);
    assert.deepEqual(plain(projOf(PROJ)), { name: "PM Plugin", key: "PM" });
    for (const p of [null, "x", [], { name: "<b>x</b>", key: "pm" }, { name: "a".repeat(61), key: "PMXX" }, { name: "a\nb", key: 7 }, { name: {}, key: "P1" }])
      assert.deepEqual(plain(projOf(p)), { name: "", key: "" }, JSON.stringify(p));
    assert.equal(plain(projOf({ name: "\u{1F600}".repeat(60) })).name, "\u{1F600}".repeat(60), "60 code points (120 UTF-16 units) is accepted, as the engine counts");
    assert.equal(plain(projOf({ name: "\u{1F600}".repeat(61) })).name, "", "61 code points is refused");
    assert.equal(plain(projOf({ name: "   " })).name, "", "a whitespace-only name is refused");
    for (const k of ["PM-256", "AB-1", "ABC-123456789"]) assert.equal(okKey(k), true, k);
    for (const k of ["pm-1", "PM-0", "PM-01", "PMXX-1", 'PM-1"><b>', "PM-", "", null, 256]) assert.equal(okKey(k), false, String(k));
  });

  test(`8.10 ${name}: a fully populated board shows no guided card, no raw ISO timestamp and no "not set"`, () => {
    const { renderBacklog, renderPlan } = load(name, ["renderBacklog", "renderPlan"].filter(f => (name === BACKLOG) === (f === "renderBacklog")));
    const epics = [full("project-boards", 256, { summary: "Draw the boards", release: "r1", whyNow: "Rob asked" }), full("ended", 12, { status: "archived", delivered: true, outcome: "delivered", endedAt: "2026-11-01T10:00:00Z", release: "r1" })];
    const releases = [R("r1", { target: "2026-12-01", progress: { done: 1, total: 2 } })];
    const info = { lastUpdated: "2026-11-11T14:10:00Z", asOf: "2026-11-11T14:09:00Z", head: "abc1234", project: PROJ };
    const out = name === BACKLOG
      ? renderBacklog({ epics, releases, meta: {}, info, project: PROJ, admin: true, canWrite: true, ...TS })
      : renderPlan(pInput({ epics, releases, project: PROJ, info, ...TS,
        plan: { here: "r1", hereText: "Building", nextText: "Ship", head: "abc1234", asOf: "2026-11-11T14:09:00Z" },
        mission: { statement: "Ship boards", reason: "users", setAt: "2026-11-01T10:00:00Z", milestoneRelease: "r1" },
        criteria: [{ id: "c1", text: "works", check: "run it", needsHuman: true }],
        decisions: [{ id: "1", question: "Q?", recommendation: "yes", askedAt: "2026-11-10T10:00:00Z" }],
        answers: [{ id: "1", stance: "agree", at: "2026-11-10T11:00:00Z" }] }));
    assert.doesNotMatch(out.html, /class="need"/, "no guided card when every field is filled");
    assert.doesNotMatch(out.html, ISO, "no raw ISO timestamp anywhere in the output");
    assert.doesNotMatch(visible(out.html), /\bnot set\b/i);
    assert.match(out.html, /Last updated Nov 11, 2:10 PM/);
    assert.match(out.title, /^PM Plugin (Backlog|Release Plan)$/);
    assert.match(visible(out.html), /PM-256/);
  });

  test(`8.10 ${name}: an empty project gets a guided card per missing field, naming the command and to ask the user; command placeholders are text`, () => {
    const out = name === BACKLOG
      ? load(name, ["renderBacklog"]).renderBacklog(bInput([E("a", { summary: null })], { project: { name: null, key: null } }))
      : load(name, ["renderPlan"]).renderPlan(pInput({ project: { name: null, key: null }, releases: [R("r1", { theme: null, exit: null, rationale: null, target: null })] }));
    const needs = [...out.html.matchAll(/data-need="([^"]+)"/g)].map(m => m[1]);
    const want = name === BACKLOG ? ["project-name", "project-key", "epic-summaries"] : ["project-name", "project-key", "mission", "here", "release-r1", "milestone", "criteria"];
    for (const w of want) assert.ok(needs.includes(w), `a card for ${w}`);
    const v = visible(out.html);
    assert.match(v, /set-project --name/);
    assert.match(v, /set-project --key/);
    assert.match(v, /Ask the user/);
    assert.match(out.title, /^(Project Backlog|Release Plan)$/);
    if (name === PLAN) for (const c of ["mission --statement", "release here", "--theme", "--exit", "--rationale", "--target", "mission --milestone", "mission --add-criterion"]) assert.ok(v.includes(c), c);
    else assert.match(v, /update-epic &lt;id&gt; --summary|update-epic <id> --summary/);
    if (name === PLAN) { assert.match(v, /--target (&quot;|")(&lt;|<)date(&gt;|>)(&quot;|")/, "the target hint is a date only"); assert.ok(!/or none/.test(v), "no literal none"); assert.ok(v.includes("--clear target"), "removal names --clear target"); }
    assert.match(out.html, /&lt;(id|release id|project name|one line)&gt;/, "a placeholder is escaped");
    assert.doesNotMatch(out.html, /<(id|release id|project name|one line)>/, "no placeholder becomes an element");
    assert.doesNotMatch(v, /\bnot set\b/i);
  });

  test(`8.11 ${name}: a hostile project name, key, theme, here text or lane stays text, and the title falls back`, () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const proj = { name: hostile, key: 'PM" onclick="x' };
    const out = name === BACKLOG
      ? load(name, ["renderBacklog"]).renderBacklog(bInput([E("a", { key: 'PM-1" onmouseover="x', lane: hostile, status: hostile, updatedAt: hostile })], { project: proj, filter: { q: '"><b>q' } }))
      : load(name, ["renderPlan"]).renderPlan(pInput({ project: proj, releases: [R("r1", { theme: hostile, target: hostile, progress: { done: '"><b>', total: 4 } })],
        epics: [E("a", { release: "r1", key: hostile })], plan: { here: "r1", hereText: hostile, nextText: hostile, head: hostile, asOf: hostile },
        mission: { statement: hostile, reason: hostile, setAt: hostile, milestoneRelease: 'r1" onclick="x' } }));
    assert.doesNotMatch(out.html, /<img/i);
    assert.doesNotMatch(out.html, /<b>q/);
    const names = attrNames(out.html);
    for (const bad of ["onerror", "onclick", "onmouseover"]) assert.ok(!names.includes(bad), bad);
    assert.match(out.title, /^(Project Backlog|Release Plan)$/);
    assert.doesNotMatch(out.html, /width:NaN|width:"/);
  });
}

test("8.8 backlog: ids are engine keys, the slug is small secondary text, and an epic with no key says so", () => {
  const { renderBacklog } = blX();
  const out = renderBacklog(bInput([full("project-boards", 256), E("legacy", { key: null })], { project: PROJ }));
  const row = (id) => { const i = out.parts.rows.indexOf(`data-id="${id}"`); return out.parts.rows.slice(i, out.parts.rows.indexOf("</tbody>", i)); };
  assert.match(row("project-boards"), /<span class="key">PM-256<\/span>/);
  assert.match(row("project-boards"), /<span class="slug">project-boards<\/span>/);
  assert.match(row("legacy"), /class="key key--none">no key</);
  assert.doesNotMatch(row("legacy"), /class="key">legacy/, "a slug is never shown as the key");
  assert.match(out.parts.needs, /data-need="epic-numbers"/, "a key with unnumbered epics names the upgrade");
  const deps = renderBacklog(bInput([full("a", 1, { dependsOn: ["b"] }), full("b", 2)], { project: PROJ }));
  assert.match(deps.parts.rows, /Ranked below: PM-2/, "a dependency tag names the key");
});

test("8.8 backlog: the table is labelled Epics, its column is Summary, and a missing summary falls back to the title visibly", () => {
  const { renderBacklog } = blX();
  const out = renderBacklog(bInput([E("a", { summary: null, title: "Long title" }), E("b")], { project: PROJ }));
  assert.match(out.html, /<h2 id="h-epics">Epics<\/h2>/);
  assert.match(out.parts.rows, /<th>Summary<\/th>/);
  assert.doesNotMatch(out.parts.rows, /<th>Epic<\/th>/);
  assert.match(out.parts.rows, /<b>Long title<\/b><span class="nosum">Title shown: no summary recorded<\/span>/);
  assert.match(out.parts.rows, /<b>Summary of b<\/b>/);
  assert.equal(renderBacklog(bInput([E("a")], { project: PROJ })).title, "PM Plugin Backlog");
});

test("8.8 backlog: a detail card only for an epic with a why-now or a description; the card hides empty fields", () => {
  const { renderBacklog } = blX();
  const out = renderBacklog(bInput([E("why", { whyNow: "now", release: null }), E("desc", { whyNow: null, description: "d" }), E("bare", { whyNow: null, description: null })]));
  assert.match(out.parts.cards, /id="card-why"/);
  assert.match(out.parts.cards, /id="card-desc"/);
  assert.doesNotMatch(out.parts.cards, /id="card-bare"/);
  assert.doesNotMatch(out.parts.cards.slice(out.parts.cards.indexOf('id="card-why"')), /<dt>Release<\/dt>|<dt>Tracker<\/dt>|<dt>Depends on<\/dt>/, "an empty field has no row");
  assert.match(out.parts.rows, /data-notpursuing="bare"/, "a row without a card can still be set aside");
});

test("8.9 backlog: every Updated cell is human; an absent date says so rather than printing nothing or ISO", () => {
  const { renderBacklog } = blX();
  const out = renderBacklog(bInput([full("a", 1), E("b", { updatedAt: null }), E("c", { updatedAt: "not a date" })], { project: PROJ, ...TS }));
  assert.match(out.parts.rows, /<span class="when">Nov 8, 9:30 AM<\/span><span class="rel">3 days ago<\/span>/);
  assert.equal((out.parts.rows.match(/<span class="s">unknown<\/span>/g) || []).length, 2, "a null and an unparseable date both say unknown");
  assert.doesNotMatch(out.parts.rows, /<span class="when"><\/span>/);
  assert.doesNotMatch(out.html, ISO);
});

test("8.10 backlog: count pills carry a dot per priority; the legend names P0 to P3; the filter grid has Find, Priority, Status, Release and Lane", () => {
  const { renderBacklog } = blX();
  const out = renderBacklog(bInput([E("a"), E("b", { priority: "P3", meritPriority: "P3", lane: "openspec", release: "r1" })]));
  assert.match(out.parts.counts, /<i class="dot d-P1"><\/i>1 P1/);
  for (const l of ["P0", "P1", "P2", "P3"]) assert.match(out.parts.legend, new RegExp(`d-${l}"></i>${l}</b>`));
  for (const l of ["Find", "Priority", "Status", "Release", "Lane"]) assert.match(out.parts.filters, new RegExp(`class="lbl"[^>]*>${l}<`));
  assert.match(out.parts.filters, /data-f="lane" data-v="openspec"/);
  assert.match(out.parts.filters, /<option value="r1">r1<\/option>/);
});

test("8.10 backlog: matches() filters by find text, priority, status, release and lane; any filter turns drag off", () => {
  const { renderBacklog, matches, filtering } = blX();
  const e = { id: "project-boards", key: "PM-256", title: "Boards", summary: "Draw them", release: "r1", lane: "openspec", status: "queued", priority: "P1" };
  assert.equal(matches(e, {}), true);
  assert.equal(matches(e, { q: "pm-256" }), true);
  assert.equal(matches(e, { q: "draw" }), true);
  assert.equal(matches(e, { q: "nope" }), false);
  assert.equal(matches(e, { prio: ["P2"] }), false);
  assert.equal(matches(e, { prio: ["P1", "P2"], status: ["queued"], lane: ["openspec"], release: "r1" }), true);
  assert.equal(matches(e, { release: "-" }), false);
  assert.equal(matches({ ...e, release: "" }, { release: "-" }), true);
  assert.equal(matches(e, { status: "queued" }), true, "a non-array list is ignored, not iterated");
  assert.equal(filtering({}), false);
  assert.equal(filtering({ q: "  " }), false);
  assert.equal(filtering({ lane: ["x"] }), true);
  const out = renderBacklog(bInput([E("a"), E("b")], { admin: true, filter: { q: "a" } }));
  assert.doesNotMatch(out.parts.rows, /class="hd"/);
  assert.match(out.parts.hint, /Drag is off while a filter is on/);
});

test("8.11 release plan: progress comes from release.progress (a bad one falls back to the members); the current release is open under a WE ARE HERE rule", () => {
  const { renderPlan } = plX();
  const out = renderPlan(pInput({
    releases: [R("r0", { order: 0, status: "shipped" }), R("r1", { order: 1, status: "in-progress", progress: { done: 1, total: 4 } }), R("r2", { order: 2, progress: { done: 9, total: 2 } })],
    epics: [E("a", { release: "r2", delivered: true, status: "archived" }), E("b", { release: "r2" })],
    plan: { here: "r1", hereText: "Building", nextText: "Ship", head: "h", asOf: "2026-11-11T00:00:00Z" }, ...TS }));
  assert.match(out.parts.roadmap, /<i style="width:25%"><\/i><\/span>1\/4/);
  assert.match(out.parts.roadmap, /<i style="width:50%"><\/i><\/span>1\/2/, "done above total is refused; members count instead");
  const hereAt = out.parts.roadmap.indexOf("We are here · r1"), r1At = out.parts.roadmap.indexOf('data-release="r1"');
  assert.ok(hereAt > -1 && hereAt < r1At, "the WE ARE HERE rule sits right above the current release");
  assert.match(out.parts.roadmap, /class="g cur" data-release="r1" open>/);
  assert.doesNotMatch(out.parts.roadmap, /data-release="r2" open/);
  assert.doesNotMatch(out.parts.roadmap, /data-need="release-r0"/, "a shipped release owes no plan fields");
  assert.match(out.parts.banner, /r1 · theme r1/);
  assert.match(out.parts.banner, /<b>Next:<\/b> Ship/);
  assert.match(renderPlan(pInput({ releases: [R("r1")], plan: { here: "r1" }, open: { r1: false } })).parts.roadmap, /data-release="r1">/, "a viewer's collapse survives a repaint");
});

test("8.11 release plan: criteria flag needsHuman; decisions show Agree and Disagree with the saved stance pressed and a Send button", () => {
  const { renderPlan } = plX();
  const out = renderPlan(pInput({
    mission: { statement: "m", milestoneRelease: "r1" },
    criteria: [{ id: "c1", text: "works", check: "run", needsHuman: true }, { id: "c2", text: "fast", check: "time", needsHuman: false }],
    decisions: [{ id: "1", question: "Q?", recommendation: "yes", askedAt: "2026-11-10T10:00:00Z" }],
    answers: [{ id: "1", stance: "disagree" }], ...TS }));
  assert.match(out.parts.criteria, /data-criterion="c1">[\s\S]*needs a person/);
  assert.match(out.parts.decisions, /data-stance="disagree" aria-pressed="true"/);
  assert.match(out.parts.decisions, /data-stance="agree" aria-pressed="false"/);
  assert.match(out.parts.decisions, /id="send-answers"/);
  assert.match(out.parts.decisions, /asked by the agent · Nov 10, 10:00 AM/);
  assert.match(out.parts.banner, /Decisions open <b>0<\/b>/);
});

test("8.10 release plan: the stale warning reads page/info.lastUpdated first and appears from two days", () => {
  const { renderPlan } = plX();
  const at = (iso) => renderPlan(pInput({ info: { lastUpdated: iso }, plan: { here: null, asOf: "2026-11-11T14:00:00Z" }, ...TS })).parts.banner;
  assert.match(at("2026-11-09T14:00:00Z"), /class="stale"/);
  assert.doesNotMatch(at("2026-11-10T14:00:00Z"), /class="stale"/);
});

test("8.8 both fallbacks carry the export's project into the page", () => {
  const { fromSnapshot: fb } = bl(), { fromSnapshot: fp } = pl();
  assert.deepEqual(plain(fb({ project: PROJ }).project), PROJ);
  assert.deepEqual(plain(fp({ project: PROJ }).project), PROJ);
  assert.equal(load(BACKLOG, ["renderBacklog"]).renderBacklog(fb({ project: PROJ, epics: [] })).title, "PM Plugin Backlog");
  assert.equal(load(PLAN, ["renderPlan"]).renderPlan(fp({ project: PROJ })).title, "PM Plugin Release Plan");
});
