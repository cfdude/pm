// scripts/test/unit/spec-sync.test.mjs
// handoff-demand-blind-spots 4.1 and 4.2 — the delta grammar and the comparison, as PURE functions of
// text (gate-integrity, "A delivered epic whose archived spec deltas are absent from the main specs is
// reported until they arrive"). No path and no git: text in, names or findings out, so the unit rung.
//
// 4.1 pins OpenSpec 1.13.2's reader (`dist/core/parsers/requirement-blocks.js`) one rule per fixture, so
// a drift between this engine's re-implementation and the grammar OpenSpec applies fails an arm here.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { compareSpecSync, mainRequirementNames, mayDischarge, parseDelta } from "../../lib/spec-sync.mjs";
import { parseCatFileBatch } from "../../lib/git.mjs";

/** A `cat-file --batch` answer, framed the way git frames it: `<oid> blob <size>` with `<size>` in
 *  BYTES, the content, a newline — or `<name> missing`. */
function batchAnswer(entries) {
  const parts = [];
  entries.forEach(([name, text], i) => {
    if (text === null) { parts.push(Buffer.from(`${name} missing\n`)); return; }
    const body = Buffer.from(text, "utf8");
    parts.push(Buffer.from(`${String(i + 1).padStart(40, "a")} blob ${body.length}\n`), body, Buffer.from("\n"));
  });
  return Buffer.concat(parts);
}

const BOM = String.fromCharCode(0xfeff);
const req = (n) => `### Requirement: ${n}\nThe system SHALL ${n}.\n`;

// ───────────── 4.1 — the grammar ─────────────

unitTest("4.1 ADDED, MODIFIED and REMOVED plain headers are read", () => {
  const d = parseDelta(`## ADDED Requirements\n\n${req("A")}\n## MODIFIED Requirements\n\n${req("M")}\n## REMOVED Requirements\n\n${req("R")}`);
  assert.deepEqual([d.added, d.modified, d.removed], [["A"], ["M"], ["R"]]);
});

unitTest("4.1 REMOVED as a -, * or + bullet, with backticks", () => {
  const d = parseDelta("## REMOVED Requirements\n\n- `### Requirement: One`\n* `### Requirement: Two`\n+ ### Requirement: Three\n");
  assert.deepEqual(d.removed, ["One", "Two", "Three"]);
});

unitTest("4.1 RENAMED FROM:/TO: with and without a bullet or backticks", () => {
  const d = parseDelta("## RENAMED Requirements\n\n- FROM: `### Requirement: Old one`\n- TO: `### Requirement: New one`\nFROM: ### Requirement: Old two\nTO: ### Requirement: New two\n");
  assert.deepEqual(d.renamed, [{ from: "Old one", to: "New one" }, { from: "Old two", to: "New two" }]);
  assert.deepEqual(d.unpaired, []);
});

unitTest("4.1 an unpaired FROM (displaced, and pending at section end) and an unpaired TO are reported", () => {
  const d = parseDelta("## RENAMED Requirements\n\n- TO: `### Requirement: Orphan to`\n- FROM: `### Requirement: Displaced`\n- FROM: `### Requirement: Pending`\n");
  assert.deepEqual(d.renamed, []);
  assert.deepEqual(d.unpaired.map(u => `${u.side}:${u.name}`).sort(),
    ["FROM:Displaced", "FROM:Pending", "TO:Orphan to"]);
});

unitTest("4.1 FROM: in one copy of ## RENAMED Requirements and TO: in a second copy are two unpaired, never a pair", () => {
  const d = parseDelta("## RENAMED Requirements\n\n- FROM: `### Requirement: A`\n\n## RENAMED Requirements\n\n- TO: `### Requirement: B`\n");
  assert.deepEqual(d.renamed, []);
  assert.deepEqual(d.unpaired.map(u => u.side).sort(), ["FROM", "TO"]);
});

unitTest("4.1 `###Requirement: X` and `### requirement: X` are headers", () => {
  const d = parseDelta("## ADDED Requirements\n\n###Requirement: Tight\n### requirement: Lower\n");
  assert.deepEqual(d.added, ["Tight", "Lower"]);
});

unitTest("4.1 `## added requirements` folds case, and a repeated title contributes both copies", () => {
  const d = parseDelta(`## added requirements\n\n${req("One")}\n## Notes\n\nx\n\n## ADDED Requirements\n\n${req("Two")}`);
  assert.deepEqual(d.added, ["One", "Two"]);
});

unitTest("4.1 a header outside any delta section is not part of the delta", () => {
  const d = parseDelta(`${req("Above")}\n## Notes\n\n${req("Under notes")}\n## ADDED Requirements\n\n${req("Real")}`);
  assert.deepEqual([d.added, d.modified, d.removed], [["Real"], [], []]);
});

unitTest("4.1 a header inside a code fence is ignored", () => {
  const d = parseDelta("## ADDED Requirements\n\n```md\n### Requirement: Fenced\n```\n~~~~\n## REMOVED Requirements\n### Requirement: Also fenced\n~~~~\n" + req("Real"));
  assert.deepEqual([d.added, d.removed], [["Real"], []]);
});

unitTest("4.1 `### Requirement: Foo ###` → Foo; `### Requirement: C#` → C#", () => {
  const d = parseDelta("## ADDED Requirements\n\n### Requirement: Foo ###\n### Requirement: C#\n### Requirement: Tab\t##\t\n");
  assert.deepEqual(d.added, ["Foo", "C#", "Tab"]);
});

unitTest("4.1 names are case-sensitive once read", () => {
  const d = parseDelta("## ADDED Requirements\n\n### Requirement: Case Kept\n");
  assert.deepEqual(d.added, ["Case Kept"]);
  assert.equal(mainRequirementNames("## Requirements\n\n### Requirement: case kept\n").has("Case Kept"), false);
});

unitTest("4.1 a BOM and CRLF line endings are normalized first", () => {
  const d = parseDelta(`${BOM}## ADDED Requirements\r\n\r\n### Requirement: Windows\r\nbody\r\n`);
  assert.deepEqual(d.added, ["Windows"]);
  const lone = parseDelta("## ADDED Requirements\r### Requirement: Old Mac\r");
  assert.deepEqual(lone.added, ["Old Mac"]);
});

unitTest("4.1 the MAIN spec: a header under ## Notes is not present; one under ## requirements is", () => {
  const names = mainRequirementNames(`# Spec\n\n## Purpose\n\n${req("In purpose")}\n## requirements\n\n${req("Counted")}\n## Notes\n\n${req("In notes")}`);
  assert.deepEqual([...names], ["Counted"]);
});

// ───────────── 4.2 — the comparison and the later-change discharge ─────────────

const delta = (sections) => Object.entries(sections).map(([t, body]) => `## ${t} Requirements\n\n${body}`).join("\n");
const main = (...names) => `# x\n\n## Requirements\n\n${names.map(req).join("\n")}`;
const one = (findings, dir) => findings.filter(f => f.dir === dir);

unitTest("4.2 a lost ADDED requirement is reported absent, naming the epic, directory, capability and headers", () => {
  const changes = [{ dir: "2026-09-01-a", deltas: { "engine-invocation": delta({ ADDED: req("Store seam") + req("Parity") }) } }];
  const f = compareSpecSync({ changes, inScope: [{ epic: "a", dir: "2026-09-01-a" }], main: new Map([["engine-invocation", main("Other")]]) });
  assert.deepEqual(f, [{ epic: "a", dir: "2026-09-01-a", capability: "engine-invocation", direction: "absent", headers: ["Store seam", "Parity"] }]);
});

unitTest("4.2 a REMOVED requirement still in the main spec is reported present", () => {
  const changes = [{ dir: "2026-09-01-a", deltas: { c: delta({ REMOVED: req("Gone") }) } }];
  const f = compareSpecSync({ changes, inScope: [{ epic: "a", dir: "2026-09-01-a" }], main: new Map([["c", main("Gone")]]) });
  assert.deepEqual(f.map(x => [x.direction, x.headers]), [["present", ["Gone"]]]);
});

unitTest("4.2 a later MODIFIED of the same requirement → no finding for either change", () => {
  const changes = [
    { dir: "2026-09-01-a", deltas: { c: delta({ ADDED: req("X") }) } },
    { dir: "2026-09-10-b", deltas: { c: delta({ MODIFIED: req("X") }) } },
  ];
  const inScope = [{ epic: "a", dir: "2026-09-01-a" }, { epic: "b", dir: "2026-09-10-b" }];
  assert.deepEqual(compareSpecSync({ changes, inScope, main: new Map([["c", main("X")]]) }), []);
});

unitTest("4.2 a later REMOVED → no finding for A's ADDED, and none for B's REMOVED", () => {
  const changes = [
    { dir: "2026-09-01-a", deltas: { c: delta({ ADDED: req("X") }) } },
    { dir: "2026-09-10-b", deltas: { c: delta({ REMOVED: req("X") }) } },
  ];
  const inScope = [{ epic: "a", dir: "2026-09-01-a" }, { epic: "b", dir: "2026-09-10-b" }];
  assert.deepEqual(compareSpecSync({ changes, inScope, main: new Map([["c", main("Y")]]) }), []);
});

unitTest("4.2 an EARLIER opposite change does not discharge", () => {
  const changes = [
    { dir: "2026-09-01-b", deltas: { c: delta({ REMOVED: req("X") }) } },
    { dir: "2026-09-10-a", deltas: { c: delta({ ADDED: req("X") }) } },
  ];
  const f = compareSpecSync({ changes, inScope: [{ epic: "a", dir: "2026-09-10-a" }], main: new Map([["c", main("Y")]]) });
  assert.deepEqual(f.map(x => [x.epic, x.direction, x.headers]), [["a", "absent", ["X"]]]);
});

unitTest("4.2 same-date and undated pairs are unordered — both directions, whichever the index holds", () => {
  for (const [da, db] of [["2026-09-05-a", "2026-09-05-b"], ["a", "2026-09-05-b"], ["2026-09-05-a", "b"]]) {
    assert.equal(mayDischarge(da, db), true); assert.equal(mayDischarge(db, da), true);
    const changes = [
      { dir: da, deltas: { c: delta({ ADDED: req("X") }) } },
      { dir: db, deltas: { c: delta({ REMOVED: req("X") }) } },
    ];
    const inScope = [{ epic: "a", dir: da }, { epic: "b", dir: db }];
    for (const m of [main("X"), main("Y")]) {
      assert.deepEqual(compareSpecSync({ changes, inScope, main: new Map([["c", m]]) }), [], `${da} vs ${db}`);
    }
  }
  assert.equal(mayDischarge("2026-09-05-a", "2026-09-01-b"), false, "a strictly EARLIER date never discharges");
});

unitTest("4.2 RENAMED is checked on both sides: FROM present is reported, TO present is not", () => {
  const changes = [{ dir: "2026-09-01-a", deltas: { c: delta({ RENAMED: "- FROM: `### Requirement: Old`\n- TO: `### Requirement: New`\n" }) } }];
  const inScope = [{ epic: "a", dir: "2026-09-01-a" }];
  const both = compareSpecSync({ changes, inScope, main: new Map([["c", main("Old", "New")]]) });
  assert.deepEqual(both.map(x => [x.direction, x.headers]), [["present", ["Old"]]]);
  const neither = compareSpecSync({ changes, inScope, main: new Map([["c", main("Z")]]) });
  assert.deepEqual(neither.map(x => [x.direction, x.headers]), [["absent", ["New"]]]);
});

unitTest("4.2 a main spec absent from the index reports every ADDED header, and no REMOVED one", () => {
  const changes = [{ dir: "2026-09-01-a", deltas: { c: delta({ ADDED: req("A1") + req("A2") + req("A3"), REMOVED: req("R") }) } }];
  const f = compareSpecSync({ changes, inScope: [{ epic: "a", dir: "2026-09-01-a" }], main: new Map([["c", null]]) });
  assert.deepEqual(f.map(x => [x.direction, x.headers]), [["absent", ["A1", "A2", "A3"]]]);
});

unitTest("4.2 a header the main file holds only under ## Notes is reported absent", () => {
  const changes = [{ dir: "2026-09-01-a", deltas: { c: delta({ ADDED: req("Noted") }) } }];
  const f = compareSpecSync({ changes, inScope: [{ epic: "a", dir: "2026-09-01-a" }],
    main: new Map([["c", `# x\n\n## Requirements\n\n${req("Other")}\n## Notes\n\n${req("Noted")}`]]) });
  assert.deepEqual(f.map(x => [x.direction, x.headers]), [["absent", ["Noted"]]]);
});

unitTest("4.2 git cannot answer → no presence or absence finding, and an unpaired RENAMED is still reported", () => {
  const changes = [{ dir: "2026-09-01-a", deltas: {
    c: delta({ ADDED: req("Lost") }),
    d: delta({ RENAMED: "- FROM: `### Requirement: Half`\n" }),
  } }];
  const f = compareSpecSync({ changes, inScope: [{ epic: "a", dir: "2026-09-01-a" }], main: null });
  assert.deepEqual(f.map(x => [x.capability, x.direction, x.headers]), [["d", "unpaired", ["FROM: Half"]]]);
});

unitTest("4.2 the comparison reads only the in-scope pairs it is handed (outcome scope is the caller's)", () => {
  // A `killed` epic is kept OUT of `inScope` by specSyncFindings(); the comparison itself reports only
  // the in-scope changes, while every archived change may still discharge.
  const changes = [{ dir: "2026-09-01-killed", deltas: { c: delta({ ADDED: req("Never shipped") }) } }];
  assert.deepEqual(compareSpecSync({ changes, inScope: [], main: new Map([["c", main("Z")]]) }), []);
  assert.equal(one(compareSpecSync({ changes, inScope: [{ epic: "k", dir: "2026-09-01-killed" }], main: new Map([["c", main("Z")]]) }), "2026-09-01-killed").length, 1);
});

unitTest("I5 a MODIFIED header missing from the main spec is reported absent", () => {
  // Gate 2 I5: MODIFIED is one of the three presence obligations, and nothing pinned it — dropping
  // `...delta.modified` from the comparison passed every other case.
  const changes = [{ dir: "2026-09-01-m", deltas: { c: delta({ MODIFIED: req("Reworded") }) } }];
  const f = compareSpecSync({ changes, inScope: [{ epic: "m", dir: "2026-09-01-m" }], main: new Map([["c", main("Other")]]) });
  assert.deepEqual(f.map(x => [x.direction, x.headers]), [["absent", ["Reworded"]]]);
});

// ───────────── parseCatFileBatch — moved from assert/spec-sync-index (pure values) ─────────────

unitTest("3.2 the parse frames by BYTE size, so a second blob after a multi-byte one decodes exactly", () => {
  const a = "## Requirements\n\n### Requirement: Résumé — «é» ✓\n", b = "### Requirement: 日本語\n";
  const names = [":./openspec/specs/a/spec.md", ":./openspec/specs/b/spec.md", ":./openspec/specs/c/spec.md"];
  const got = parseCatFileBatch(batchAnswer([[names[0], a], [names[1], b], [names[2], null]]), names);
  assert.equal(got.get(names[0]), a);
  assert.equal(got.get(names[1]), b, "a string-sliced parse misreads every blob after the first multi-byte one");
  assert.equal(got.get(names[2]), null, "`missing` is the definite answer: absent from the index");
  assert.ok(Buffer.byteLength(a) > a.length, "the fixture really is multi-byte");
});

unitTest("3.2 a malformed or truncated answer THROWS rather than guessing", () => {
  assert.throws(() => parseCatFileBatch(Buffer.from("garbage header\n"), ["x"]), /unexpected header/);
  assert.throws(() => parseCatFileBatch(Buffer.from(`${"a".repeat(40)} blob 99\nshort\n`), ["x"]), /truncated/);
  assert.throws(() => parseCatFileBatch(Buffer.alloc(0), ["x"]), /no answer/);
});
