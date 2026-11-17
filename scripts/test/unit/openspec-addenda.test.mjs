// scripts/test/unit/openspec-addenda.test.mjs
// gh-cfdude-pm-262 task 2: the read-only check (residual / missing), its line rendering, and the section text. UNIT rung: values over
// injected inputs, no filesystem. The bytes a repo's CLAUDE.md holds are in assert/openspec-addenda.test.mjs.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { RULES_BEGIN, RULES_END } from "../../lib/constants.mjs";
import {
  OPENSPEC_ADDENDA_BULLET_MAX_BYTES, OPENSPEC_ADDENDA_HEADING, OPENSPEC_ADDENDA_MAX_BYTES, OPENSPEC_ADDENDA_MAX_BYTES_FULL,
  PM_OPENSPEC_ADDENDA, openspecAddendaFindingLines, openspecAddendaFindings, openspecAddendaSectionText,
} from "../../lib/openspec-addenda.mjs";

const NEEDLE = PM_OPENSPEC_ADDENDA[0].needle;
const inBlock = (body) => `# CLAUDE.md\n\n${RULES_BEGIN}\n${body}\n${RULES_END}\n`;
const WITH_HEADING = inBlock(`${OPENSPEC_ADDENDA_HEADING}\n\nbody`);
const bytes = (s) => Buffer.byteLength(s, "utf8");

unitTest("2.1 a needle inside a generated file is RESIDUAL, naming the id and the path; two files give two entries sorted by path", () => {
  const one = openspecAddendaFindings({ hasOpenspec: true, generatedFiles: [{ path: ".claude/commands/opsx/archive.md", text: `x ${NEEDLE} y` }], blockText: WITH_HEADING });
  assert.deepEqual(one, { residual: [{ id: "archive-sync-kept-allowance", path: ".claude/commands/opsx/archive.md" }], missing: [] });
  const two = openspecAddendaFindings({
    hasOpenspec: true,
    generatedFiles: [{ path: ".claude/skills/openspec-archive-change/SKILL.md", text: NEEDLE }, { path: ".claude/commands/opsx/archive.md", text: NEEDLE }],
    blockText: WITH_HEADING,
  });
  assert.deepEqual(two.residual.map((r) => r.path), [".claude/commands/opsx/archive.md", ".claude/skills/openspec-archive-change/SKILL.md"]);
});

unitTest("2.2 no needle anywhere: MISSING exactly when the block lacks the heading", () => {
  const files = [{ path: ".claude/commands/opsx/archive.md", text: "pristine" }];
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: files, blockText: inBlock("## Boards") }).missing, [{ id: "archive-sync-kept-allowance" }]);
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: files, blockText: WITH_HEADING }), { residual: [], missing: [] });
});

unitTest("2.3 without openspec/ everything is silent, and a block with the heading and no files is silent", () => {
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: false, generatedFiles: [{ path: "p", text: NEEDLE }], blockText: "no heading" }), { residual: [], missing: [] });
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: [], blockText: WITH_HEADING }), { residual: [], missing: [] });
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: [], blockText: null }), { residual: [], missing: [] }, "no rules target at all says nothing");
});

unitTest("2.4 rendering escapes control characters in a path, and file CONTENT never reaches a line", () => {
  const secret = "SECRET-CONTENT-THAT-MUST-NOT-LEAK";
  const lines = openspecAddendaFindingLines(openspecAddendaFindings({
    hasOpenspec: true, generatedFiles: [{ path: "a\u001b[31mb", text: `${secret} ${NEEDLE}` }], blockText: "no heading",
  }));
  const all = lines.join("\n");
  assert.ok(!all.includes("\u001b"), "the escape byte is neutralised");
  assert.ok(!all.includes(secret) && !all.includes(NEEDLE), "no file text in the output");
  assert.match(all, /RESIDUAL/);
  assert.match(all, /MISSING/);
  assert.match(lines[lines.length - 1], /openspec update --dry-run/);
});

unitTest("2.5 a clean state renders nothing", () => {
  assert.deepEqual(openspecAddendaFindingLines({ residual: [], missing: [] }), []);
});

unitTest("2.6 the section text: heading, clause, practice sentence, within the cap, no trailing blank; absent without openspec/", () => {
  const t = openspecAddendaSectionText({ hasOpenspec: true });
  assert.ok(t.startsWith(OPENSPEC_ADDENDA_HEADING));
  assert.ok(t.includes(NEEDLE));
  assert.ok(t.includes(".claude/skills/openspec-*") && t.includes(".claude/commands/opsx/*"));
  assert.ok(bytes(t) <= OPENSPEC_ADDENDA_MAX_BYTES, `${bytes(t)} bytes`);
  assert.ok(!t.endsWith("\n"));
  assert.equal(openspecAddendaSectionText({ hasOpenspec: false }), "");
  assert.equal(openspecAddendaSectionText({ hasOpenspec: false, present: { onboard: true } }), "");
});

unitTest("6.1 each guardrail bullet appears iff its flag is true, within its cap; no flag equals the base text; all three within the total cap", () => {
  const base = openspecAddendaSectionText({ hasOpenspec: true });
  const marks = { onboard: "/opsx:onboard", verify: "/opsx:verify", bulkArchive: "/opsx:bulk-archive" };
  for (let mask = 0; mask < 8; mask++) {
    const present = { onboard: Boolean(mask & 1), verify: Boolean(mask & 2), bulkArchive: Boolean(mask & 4) };
    const t = openspecAddendaSectionText({ hasOpenspec: true, present });
    for (const k of Object.keys(marks)) assert.equal(t.includes(marks[k]), present[k], `${k} under ${JSON.stringify(present)}`);
    for (const line of t.split("\n").filter((l) => l.startsWith("- /") || l.startsWith("- Never") || l.startsWith("- `/opsx"))) {
      assert.ok(bytes(line) <= OPENSPEC_ADDENDA_BULLET_MAX_BYTES, line);
    }
    assert.ok(bytes(t) <= OPENSPEC_ADDENDA_MAX_BYTES_FULL);
    if (!mask) assert.equal(t, base);
  }
});

unitTest("2.7 MISSING reads only the text between the managed-block markers: a user's own heading OUTSIDE the block does not hide it", () => {
  const files = [{ path: ".claude/commands/opsx/archive.md", text: "pristine" }];
  const outside = `${OPENSPEC_ADDENDA_HEADING}\n\nmy own notes\n\n${inBlock("## Boards")}`;
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: files, blockText: outside }).missing, [{ id: "archive-sync-kept-allowance" }]);
  assert.deepEqual(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: files, blockText: OPENSPEC_ADDENDA_HEADING }).missing, [{ id: "archive-sync-kept-allowance" }], "no markers at all is no block");
});

unitTest("6.2 the bulk-archive bullet tells the agent the full disposition call: --status archived --outcome, a reason, and a deferral claim that is never the default", () => {
  const t = openspecAddendaSectionText({ hasOpenspec: true, present: { bulkArchive: true } });
  assert.ok(t.includes("`update-epic <id> --status archived --outcome <outcome> --reason \"<why>\"`"), t);
  assert.ok(t.includes("(`--no-deferrals` only if there are none)"), "the deferral flag is named as a claim, not a default");
});
