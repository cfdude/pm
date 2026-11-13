// scripts/test/unit/emitted-invocations.test.mjs
// The UNIT-rung half of scripts/test/functional/emitted-invocations.test.mjs's assertion twin (the
// file-rung half is scripts/test/assert/emitted-invocations.test.mjs, which reads the shipped docs).
//
// The functional file's PRINTER_FIXTURES reaches every printed-invocation template; this carries the
// per-commit half of the ones whose observable is a VALUE — an exit status and a printed line — which
// is the unit rung's by CONTRIBUTING's rule, whatever its speed.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

// The one-item-one-epic refusal (tracker-item-dedup-bypassed) prints `update-epic <holder> --clear
// external-url`. Run exactly as printed, it must be accepted and must free the item.
unitTest("the tracker-item refusal's printed remedy runs as written and frees the item", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "th", "--lane", "claude-code", "--external-url", "https://x.test/1"]);
  const refused = engine.result(["add-epic", "--id", "t2", "--lane", "claude-code", "--external-url", "https://x.test/1"]);
  assert.notEqual(refused.status, 0);
  const printed = /`(update-epic [^`]+)`/.exec(refused.stderr);
  assert.ok(printed, `the refusal prints its remedy:\n${refused.stderr}`);
  engine(printed[1].split(" "));
  engine(["add-epic", "--id", "t2", "--lane", "claude-code", "--external-url", "https://x.test/1"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "t2").externalUrl, "https://x.test/1");
});

// project-boards 5.2 — the inward registration recipe now ends `--summary=<one-line summary>`. The functional file's `fillRecipe` fills the
// new placeholder with a single-quoted value and runs the line through sh; this is its per-commit twin at the value level: the line the
// rules block emits, filled the same way, is accepted by the engine and the summary is stored and read back as one line.
unitTest("the inward recipe's --summary=<one-line summary> line, filled with a single-quoted value, is accepted and stores the summary", async () => {
  const { rulesBlock } = await import("../../lib/rules.mjs");
  const block = rulesBlock({ system: "github-issues", repo: "o/n", direction: "inward" }, "standard", [], "claude-code").replace(/\n\s+/g, " ");
  const span = [...block.matchAll(/`([^`]+)`/g)].map(m => m[1]).find(s => s.startsWith("add-epic --id "));
  assert.ok(span && span.includes("--summary=<one-line summary>"), span);
  const quote = (v) => `'${v.replace(/'/g, "'\\''")}'`;
  const filled = span
    .replace(/<issue-title>/g, () => quote("A title"))
    .replace(/<issue-url>/g, () => quote("https://github.com/o/n/issues/41"))
    .replace(/<issue-number>/g, "41").replace(/<issue-updated-at>/g, "2026-09-01T00:00:00.000Z")
    .replace(/<lane>/g, "claude-code")
    .replace(/<one-line summary>/g, () => quote("what the item asks for, in one line"));
  // A minimal POSIX word split: single quotes group, a backslash outside them escapes one character.
  const words = [];
  let cur = "", q = false, started = false;
  for (let i = 0; i < filled.length; i++) {
    const c = filled[i];
    if (q) { if (c === "'") q = false; else cur += c; continue; }
    if (c === "'") { q = true; started = true; continue; }
    if (c === "\\" && i + 1 < filled.length) { cur += filled[++i]; started = true; continue; }
    if (/\s/.test(c)) { if (started) words.push(cur); cur = ""; started = false; continue; }
    cur += c; started = true;
  }
  if (started) words.push(cur);
  const engine = memoryEngine(emptyRecord());
  engine(words);
  const epic = engine.store.record().epics.find(e => e.externalUrl === "https://github.com/o/n/issues/41");
  assert.equal(epic.summary, "what the item asks for, in one line");
});
