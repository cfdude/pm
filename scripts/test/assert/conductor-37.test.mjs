// scripts/test/assert/conductor-37.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-37.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is #156: a shipped skill was silently truncated and no check noticed
// for four releases, so a STRUCTURAL check over every shipped markdown file was built. Four of its
// eleven tests read a truncated file OUT OF GIT HISTORY (`git show <ref>:skills/conductor/SKILL.md`),
// which spawns git and cannot live here (design D5, and 5.2's guard refuses it by construction).
//
// THE CHECKER ITSELF READS FILES AND SPAWNS NOTHING, and the same five properties are what this half
// proves on every commit: the real shipped tree is whole, and each of the five assertions FIRES on
// the shape it exists for. The checker is repeated here rather than imported, and that is not a
// second implementation of the RULE — the functional file's copy cannot be imported without running
// its tests (an import executes the module and registers every `test()` in it), so the alternative
// is a copy or nothing. The rule has one home in the shipped tree (the functional file); this is its
// fast-half mirror.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARITY_ROOTS } from "../fixtures/parity-helpers.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHIPPED_MD_ROOTS = PARITY_ROOTS;
const SHIPPED_MD_FILES = ["README.md", "CHANGELOG.md"];

function shippedMarkdown(rootDir = REPO) {
  const out = [];
  const walk = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(path.relative(rootDir, p));
    }
  };
  for (const r of SHIPPED_MD_ROOTS) {
    const abs = path.join(rootDir, r);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const f of SHIPPED_MD_FILES) if (fs.existsSync(path.join(rootDir, f))) out.push(f);
  return out.sort();
}

function scanFences(lines) {
  const code = new Array(lines.length).fill(false);
  let openChar = "", openLen = 0, openLine = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (m) {
      const [, run, rest] = m;
      if (openLine === null) {
        if (run[0] === "`" && rest.includes("`")) { /* not a fence */ }
        else { openChar = run[0]; openLen = run.length; openLine = i + 1; code[i] = true; continue; }
      } else if (run[0] === openChar && run.length >= openLen && rest.trim() === "") {
        openLine = null; code[i] = true; continue;
      }
    }
    code[i] = openLine !== null;
  }
  return { code, openLine };
}

function structuralViolations(text) {
  const lines = text.split("\n");
  const v = [];
  const { code, openLine } = scanFences(lines);
  if (openLine !== null) v.push({ line: openLine, kind: "unclosed-fence", detail: `code fence opened at line ${openLine} is never closed` });
  if (lines[0] === "---") {
    const close = lines.slice(1).findIndex((l) => l.trim() === "---");
    if (close === -1) v.push({ line: 1, kind: "unterminated-frontmatter", detail: "frontmatter opened at line 1 is never closed" });
  }
  const EXEMPT_EMPTY = new Set(["## [Unreleased]"]);
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const m = lines[i].match(/^(#{1,6})\s+\S/);
    if (!m) continue;
    if (EXEMPT_EMPTY.has(lines[i].trim())) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length) {
      v.push({ line: i + 1, kind: "empty-section", detail: `heading "${lines[i].trim()}" is the last content in the file` });
      continue;
    }
    const n = code[j] ? null : lines[j].match(/^(#{1,6})\s/);
    if (n && n[1].length <= m[1].length) {
      v.push({ line: i + 1, kind: "empty-section", detail: `heading "${lines[i].trim()}" has no content before the next heading at line ${j + 1}` });
    }
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    if (code[i] || code[i + 1]) continue;
    if (!/^\s*\|/.test(lines[i])) continue;
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const next = lines[i + 2];
    if (next === undefined || code[i + 2] || !/^\s*\|/.test(next)) {
      v.push({ line: i + 1, kind: "empty-table", detail: `table header at line ${i + 1} has a delimiter row but no data rows` });
    }
  }
  const prose = lines.filter((_, i) => !code[i]).join("\n");
  const noInline = prose.replace(/`[^`\n]*`/g, "");
  const opens = (noInline.match(/<details[\s>]/g) || []).length;
  const closes = (noInline.match(/<\/details>/g) || []).length;
  if (opens !== closes) v.push({ line: 0, kind: "unclosed-details", detail: `${opens} <details> opened, ${closes} closed` });
  return v;
}

const kinds = (md) => structuralViolations(md).map(x => x.kind);

test("the walk finds the shipped markdown tree — a gate over an empty set is a green light", () => {
  const files = shippedMarkdown();
  assert.ok(files.length >= 20, `expected the shipped markdown tree, found ${files.length} files`);
  for (const known of ["README.md", "skills/conductor/SKILL.md", "commands/status.md", "agents/reconciler.md"]) {
    assert.ok(files.includes(known), `${known} is shipped but the walk did not find it`);
  }
});

test("every shipped markdown file is structurally whole", () => {
  const failures = [];
  for (const rel of shippedMarkdown()) {
    for (const x of structuralViolations(fs.readFileSync(path.join(REPO, rel), "utf8"))) {
      failures.push(`${rel}:${x.line} [${x.kind}] ${x.detail}`);
    }
  }
  assert.deepEqual(failures, [], `structurally broken shipped markdown:\n${failures.join("\n")}`);
});

test("(1) an unclosed code fence is caught", () => {
  assert.deepEqual(kinds("# T\n\n## S\n\n```bash\necho hi\n"), ["unclosed-fence"]);
  assert.deepEqual(kinds("# T\n\n## S\n\n```bash\necho hi\n```\n"), []);
});

test("(1) fence nesting does not fool the tracker, and would have fooled fence-line parity", () => {
  assert.deepEqual(kinds("# T\n\n## S\n\n````markdown\n```bash\necho hi\n```\n````\n"), []);
  assert.deepEqual(kinds("# T\n\n## S\n\n````markdown\n```bash\necho hi\n"), ["unclosed-fence"]);
});

test("(1) an inline code span at the start of a line is not read as a fence", () => {
  assert.deepEqual(kinds("# T\n\n## S\n\n`--flag` does a thing.\n"), []);
});

test("(2) unterminated frontmatter is caught", () => {
  assert.deepEqual(kinds("---\nname: x\ndescription: y\n"), ["unterminated-frontmatter"]);
  assert.deepEqual(kinds("---\nname: x\n---\n\n# T\n\nbody\n"), []);
  assert.deepEqual(kinds("# T\n\nbody\n"), []);
});

test("(3) a heading whose section was cut away is caught, and a title above its first section is not", () => {
  assert.deepEqual(kinds("# T\n\n## A\n\nbody\n\n## B\n"), ["empty-section"]);
  assert.deepEqual(kinds("# T\n\n## A\n\nbody\n"), []);
  assert.deepEqual(kinds("# T\n\n## A\n\n### A1\n\nbody\n"), []);
  assert.deepEqual(kinds("# T\n\n## A\n\n```\ncode\n```\n"), []);
  assert.deepEqual(kinds("# T\n\n## A\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"), []);
});

test("(3) a `#` comment inside a shell example is not mistaken for an empty heading", () => {
  assert.deepEqual(kinds("# T\n\n## A\n\n```bash\n# set the thing\nrun\n```\n"), []);
});

test("(4) a table cut off after its delimiter row is caught", () => {
  assert.deepEqual(kinds("# T\n\n## A\n\n| a | b |\n|---|---|\n"), ["empty-table"]);
  assert.deepEqual(kinds("# T\n\n## A\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"), []);
});

test("(5) an unclosed <details> block is caught, and a fenced example of one is not", () => {
  assert.deepEqual(kinds("# T\n\n## A\n\n<details>\n<summary>x</summary>\n\nbody\n"), ["unclosed-details"]);
  assert.deepEqual(kinds("# T\n\n## A\n\n<details>\n<summary>x</summary>\n\nbody\n</details>\n"), []);
  assert.deepEqual(kinds("# T\n\n## A\n\n```html\n<details>\n```\n"), []);
});

// ───────────────────────── the deliberate omission ─────────────────────────
//
// "the checker fires on the ACTUAL 0.31.0 truncation" reads two releases out of git history with
// `git show`, which spawns git and needs a full clone — functional-only by construction (design D5).
// The five discriminating cases above are the same proof against constructed documents, and they
// are the half of that evidence this half can carry on every commit.
