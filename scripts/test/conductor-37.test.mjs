// #156 — a shipped skill was silently truncated in 0.31.0 and no check noticed for four releases.
//
// `skills/conductor/SKILL.md` — a file the plugin ships to EVERY user — lost 78 lines mid-document
// during 0.31.0 and survived 0.31.0, 0.32.0, 0.33.0, 0.34.0 and 0.35.0 before a human found it by
// reading. Measured on the shipped file: 795 lines at 0.30.0, 743 at 0.31.0 (a NET LOSS during a
// release that added content), 840 at 0.35.0, 926 after the restore.
//
// WHY NOTHING CAUGHT IT, and the reason this file exists at all: every guard this repo already
// runs is a PRESENCE check. The parity ledger asserts each shipped file exists and is claimed.
// `mustSay` asserts specific claims APPEAR in an emitted mirror. The drift guard compares a
// generated mirror against its generator. A truncation is an ABSENCE BELOW THE LAST THING ANYONE
// ASSERTS, so a file can lose its tail — or its middle — and pass all three. No amount of adding
// more presence assertions closes that gap; the check has to be about the document's SHAPE
// instead of its content.
//
// WHY NOT A LINE-COUNT FLOOR. "The file got shorter than last release" is the obvious check and
// it is the wrong one: files legitimately shrink when a section is deliberately cut, so the gate
// would fire on correct work and be muted within two releases. This repo has a written lesson
// about exactly that failure mode — a guard that is wrong 7 times in 8 trains everyone to ignore
// the one time it is right (docs/lessons/). Everything below is instead a property that is TRUE
// of a well-formed markdown document and FALSE of a truncated one, independent of length and
// independent of what the file says.
//
// WHAT THIS DOES NOT CATCH, said out loud so "structurally whole" does not oversell. All five
// assertions fire on a truncation that lands INSIDE something with a terminator — a fence, the
// frontmatter, a table, a <details> — or immediately after a heading. A cut that lands in
// ordinary prose on a line boundary, between two otherwise intact sections, still passes. #156
// happened to land inside a fence; the next one need not. The fuzzy checks that would narrow
// that gap were considered and rejected below, on the grounds that a gate which is wrong most of
// the time is a gate nobody reads.
//
// EVERY ASSERTION HERE WAS MEASURED AT 0 VIOLATIONS ACROSS ALL 27 SHIPPED MARKDOWN FILES BEFORE
// IT WAS ADOPTED. Candidates that scored above zero were rejected, and the rejections are
// recorded at the bottom of this file so nobody re-proposes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ───────────────────────── the checker ─────────────────────────
//
// Kept in this file rather than scripts/lib/: nothing in the ENGINE consumes it. It is a CI gate
// over the repo's own shipped artifacts, exactly like parity-helpers.mjs, and the engine is a
// zero-dependency instruction layer that has no business growing a markdown linter. No engine
// change was needed to build this check.
//
// Zero dependencies: node:fs / node:path / node:url only. No markdown parser.

/** Roots whose *.md files are shipped to users and must therefore be structurally whole.
 *  A WALK, not an enumerated list — a SKILL.md added next release must be checked the day it
 *  lands, and an enumerated list is the mechanism by which a new file goes silently unchecked.
 *  (This repo's own audit named diff-scoped blindness as its dominant defect class; an
 *  enumerated allowlist is the same blindness spelled differently.)
 *
 *  Deliberately the SAME roots parity-helpers.mjs walks, plus README.md. `hooks/` and
 *  `.claude-plugin/` hold only JSON today — verified, no *.md — but they are shipped surface the
 *  parity ledger already claims, so they are walked anyway: a doc dropped into either one next
 *  release is checked the day it lands rather than the day someone remembers to add it here. */
const SHIPPED_MD_ROOTS = ["skills", "commands", "agents", "hooks", ".claude-plugin"];
const SHIPPED_MD_FILES = ["README.md"];

/** Repo-relative paths of every shipped markdown file, sorted. */
export function shippedMarkdown(rootDir = REPO) {
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
  for (const f of SHIPPED_MD_FILES) {
    if (fs.existsSync(path.join(rootDir, f))) out.push(f);
  }
  return out.sort();
}

/** Classify every line as inside or outside a fenced code block, using CommonMark's rule rather
 *  than counting fence lines. The issue observed the symptom as "an odd number of fence lines",
 *  but raw parity and a real tracker only agree when no fence nests inside another: a ````-fenced
 *  block containing a ```-fenced example has EVEN parity and is perfectly well formed, and the
 *  reverse arrangement has odd parity and is also well formed. Parity would call both wrong.
 *  So: an opener records its char and length; only a fence of the SAME char, at least as long,
 *  with nothing after it, closes.
 *
 *  Returns { code: boolean[], openLine: number|null } — openLine is the 1-based line of a fence
 *  still open at EOF, which is the truncation signature itself. */
export function scanFences(lines) {
  const code = new Array(lines.length).fill(false);
  let openChar = "", openLen = 0, openLine = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (m) {
      const [, run, rest] = m;
      if (openLine === null) {
        // An opener may carry an info string, but a backtick fence's info string may not contain
        // a backtick — that is what keeps inline `code` spans from being read as fences.
        if (run[0] === "`" && rest.includes("`")) { /* not a fence */ }
        else { openChar = run[0]; openLen = run.length; openLine = i + 1; code[i] = true; continue; }
      } else if (run[0] === openChar && run.length >= openLen && rest.trim() === "") {
        openLine = null;
        code[i] = true;
        continue;
      }
    }
    code[i] = openLine !== null;
  }
  return { code, openLine };
}

/** Structural violations in one markdown document. Each is a shape that a WHOLE document never
 *  has and a TRUNCATED one frequently does. Returns [{ line, kind, detail }]. */
export function structuralViolations(text) {
  const lines = text.split("\n");
  const v = [];
  const { code, openLine } = scanFences(lines);

  // (1) UNCLOSED CODE FENCE. The exact signature of #156, and the one that would have fired in
  // 0.31.0's own CI run. A document cannot have an unclosed fence and be intact: everything
  // after it renders as code, so the loss is total from that point down. Near-zero false
  // positives because a closed fence is not a stylistic choice — an author who opens a block
  // closes it, and a rendered document makes the failure obvious the moment a human looks.
  if (openLine !== null) {
    v.push({ line: openLine, kind: "unclosed-fence", detail: `code fence opened at line ${openLine} is never closed` });
  }

  // (2) UNTERMINATED FRONTMATTER. Every skill, command and agent doc opens with a `---` YAML
  // block that the plugin loader reads. If line 1 is `---` there MUST be a later `---`.
  // False-positive rate is structurally zero: a document whose first line is `---` and which has
  // no second `---` is not valid frontmatter under any reading — the loader itself cannot parse
  // it. This catches a truncation that lands in the head of the file, where nothing else looks.
  if (lines[0] === "---") {
    const close = lines.slice(1).findIndex((l) => l.trim() === "---");
    if (close === -1) v.push({ line: 1, kind: "unterminated-frontmatter", detail: "frontmatter opened at line 1 is never closed" });
  }

  // (3) A HEADING WITH NO SECTION UNDER IT. A truncation that removes a section's body leaves
  // its heading standing — a shape the truncated 0.31.0 file would have shown had the cut landed
  // one line lower.
  //
  // The definition is deliberately narrow, and the narrowing is what buys the zero false-positive
  // rate. `# Title` followed immediately by `## First section` is NORMAL and must not fire, so a
  // heading only counts as empty when the next non-blank line is a heading at the SAME OR
  // SHALLOWER level (no subsection either), or when it is the last thing in the file. A heading
  // followed by a code block, a table, a list or a blockquote has content and passes — which is
  // why this walks the raw lines and treats fenced code as content rather than stripping it.
  // Headings INSIDE fenced code are skipped: `# comment` in a bash example is not a heading.
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const m = lines[i].match(/^(#{1,6})\s+\S/);
    if (!m) continue;
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

  // (4) A TABLE HEADER AND DELIMITER WITH NO DATA ROWS. A truncation landing inside a table
  // leaves the header and the `|---|---|` separator with nothing under them. Zero false
  // positives by construction: an author writing a table writes it to hold rows, and a
  // deliberately empty table is not a thing this repo (or any doc) contains — measured at 0
  // across all 27 files. Skipped inside fenced code, where a table is being SHOWN, not used.
  for (let i = 0; i + 1 < lines.length; i++) {
    if (code[i] || code[i + 1]) continue;
    if (!/^\s*\|/.test(lines[i])) continue;
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const next = lines[i + 2];
    if (next === undefined || code[i + 2] || !/^\s*\|/.test(next)) {
      v.push({ line: i + 1, kind: "empty-table", detail: `table header at line ${i + 1} has a delimiter row but no data rows` });
    }
  }

  // (5) AN UNCLOSED <details> BLOCK. Both README.md and skills/conductor/SKILL.md use real
  // `<details>` collapsibles; a truncation inside one hides everything below it in the rendered
  // page. Restricted to `<details>` ALONE and deliberately NOT generalised to HTML-tag balance —
  // see the rejected-assertions note at the bottom, which measured why. Counted outside fenced
  // code so a fenced HTML example cannot skew it.
  const prose = lines.filter((_, i) => !code[i]).join("\n");
  const opens = (prose.match(/<details[\s>]/g) || []).length;
  const closes = (prose.match(/<\/details>/g) || []).length;
  if (opens !== closes) {
    v.push({ line: 0, kind: "unclosed-details", detail: `${opens} <details> opened, ${closes} closed` });
  }

  return v;
}

// ───────────────────────── the real-tree gate ─────────────────────────
//
// This is the assertion CI runs. Everything above it is the mechanism; everything below it is
// proof the mechanism can fail.

test("the walk finds the shipped markdown tree — a gate over an empty set is a green light", () => {
  // VACUOUS-COVERAGE GUARD. All five assertions above pass trivially over zero files, so a
  // refactor that moved or renamed a root would turn this gate green by emptying it and nobody
  // would learn anything. parity.test.mjs was written against the same trap.
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

// ───────────────────────── the defect this was built for ─────────────────────────

test("the checker fires on the ACTUAL 0.31.0 truncation, not just a synthetic one", () => {
  // THE DISCRIMINATING TEST. A synthetic truncation proves the code runs; only the real artifact
  // proves the DESIGN was right. Both truncated releases are read out of git history, so this
  // never touches the working tree — skills/conductor/SKILL.md carries uncommitted work and
  // truncate-then-`git checkout` would destroy it.
  //
  // Measured fence-line counts on the shipped file: 0.30.0 = 16 (whole), 0.31.0 = 15, 0.35.0 = 17.
  // The claim under test is stronger than the parity the issue observed: the TRACKER — which
  // tolerates nesting, where parity does not — reports a specific unclosed fence.
  //
  // FULL hashes, not short ones: a short prefix can become ambiguous as the repo grows, and this
  // test would then fail for a reason that has nothing to do with the check. CI already clones
  // with `fetch-depth: 0` (.github/workflows/ci.yml says so explicitly, for the other tests that
  // read this repository's real history), so these commits are present.
  const at = (ref) => {
    try {
      return execFileSync("git", ["show", `${ref}:skills/conductor/SKILL.md`], { cwd: REPO, encoding: "utf8", maxBuffer: 8 << 20 });
    } catch (e) {
      assert.fail(`cannot read ${ref} — this test reads real history and needs a full clone (CI sets fetch-depth: 0): ${e.message}`);
    }
  };

  // 0.30.0 — before the loss. Asserting the WHOLE file passes is half the evidence: a checker
  // that flagged the intact release too would be a check that always fires, which is worthless.
  const whole = structuralViolations(at("32c940f8e00cf02b5c1eb05f81a28b6f4e35e1ea"));
  assert.deepEqual(whole, [], `0.30.0's SKILL.md was intact and must pass: ${JSON.stringify(whole)}`);

  for (const [release, ref] of [
    ["0.31.0", "64b1adc1df4352ea3b45bd12b4247a4225794a48"],
    ["0.35.0", "1896ce1fd6fec348aea12e81a1b8452d6a824671"],
  ]) {
    const found = structuralViolations(at(ref));
    assert.ok(
      found.some((x) => x.kind === "unclosed-fence"),
      `${release} shipped the truncated SKILL.md and the check must catch it; got ${JSON.stringify(found)}`,
    );
  }
});

// ───────────────────────── proof each assertion can fail ─────────────────────────
//
// These call the SAME structuralViolations() the real-tree gate calls. A re-implementation
// against fixtures would prove nothing about the gate CI runs — the vacuous-coverage trap again.

const kinds = (md) => structuralViolations(md).map((x) => x.kind);

test("(1) an unclosed code fence is caught", () => {
  assert.deepEqual(kinds("# T\n\n## S\n\n```bash\necho hi\n"), ["unclosed-fence"]);
  assert.deepEqual(kinds("# T\n\n## S\n\n```bash\necho hi\n```\n"), []);
});

test("(1) fence nesting does not fool the tracker, and would have fooled fence-line parity", () => {
  // A ````-fenced block holding a ```-fenced example: EVEN parity, four fence lines, well formed.
  const nested = "# T\n\n## S\n\n````markdown\n```bash\necho hi\n```\n````\n";
  assert.deepEqual(kinds(nested), []);
  // The same document truncated inside the inner example: still EVEN parity (2 fence lines), and
  // parity would call it clean. The tracker sees the outer ```` never closed.
  const cut = "# T\n\n## S\n\n````markdown\n```bash\necho hi\n";
  assert.deepEqual(kinds(cut), ["unclosed-fence"]);
});

test("(1) an inline code span at the start of a line is not read as a fence", () => {
  assert.deepEqual(kinds("# T\n\n## S\n\n`--flag` does a thing.\n"), []);
});

test("(2) unterminated frontmatter is caught", () => {
  assert.deepEqual(kinds("---\nname: x\ndescription: y\n"), ["unterminated-frontmatter"]);
  assert.deepEqual(kinds("---\nname: x\n---\n\n# T\n\nbody\n"), []);
  // A file with no frontmatter at all (README.md) must not fire.
  assert.deepEqual(kinds("# T\n\nbody\n"), []);
});

test("(3) a heading whose section was cut away is caught, and a title above its first section is not", () => {
  assert.deepEqual(kinds("# T\n\n## A\n\nbody\n\n## B\n"), ["empty-section"]);
  assert.deepEqual(kinds("# T\n\n## A\n\nbody\n"), []);          // title → deeper heading: normal
  assert.deepEqual(kinds("# T\n\n## A\n\n### A1\n\nbody\n"), []); // heading → subsection: normal
  assert.deepEqual(kinds("# T\n\n## A\n\n```\ncode\n```\n"), []); // a code block IS content
  assert.deepEqual(kinds("# T\n\n## A\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"), []); // so is a table
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

// ───────────────────────── assertions considered and REJECTED ─────────────────────────
//
// Recorded here because the judgment is the reusable part, and because an unrecorded rejection
// gets re-proposed every release.
//
// • LINE-COUNT FLOOR vs THE PREVIOUS RELEASE. The issue offers it as an option and it is the
//   check this file most deliberately does not implement. It is not structural: it fires on
//   every legitimate deletion, and a gate that fires on correct work is muted within two
//   releases. It also cannot see #156's real shape — a NET loss in a release that ADDED content
//   is only visible if you know what should have been added, which no mechanical check does.
//
// • GENERAL HTML-TAG BALANCE. Rejected on MEASUREMENT, not taste. These docs use angle brackets
//   as PLACEHOLDER SYNTAX throughout — `<id>` appears 103 times, `<summary>` 35, `<why>` 26,
//   `<reason>` 20 — and `/pm:feedback [bug|feature] "<summary>"` in commands/feedback.md makes
//   `<summary>` permanently unbalanced against `</summary>`. A general tag-balance check reports
//   4 violations on a tree that is entirely intact. Only `<details>` survives the measurement,
//   because it is never used as a placeholder, and that is the only form kept above.
//
// • MID-SENTENCE SPLICE AT EOF. Proposed in the issue, and it fails on two counts. It would NOT
//   have caught #156: that truncation was mid-document and the file's last line was intact.
//   And the discriminating rule is fuzzy — "ends without terminal punctuation" already
//   false-positives on README.md's closing `MIT © Rob Sherman`, and narrowing it to a list of
//   dangling conjunctions and articles is a heuristic dressed as a structural check. What is
//   left after removing the fuzzy part (a line ending in `,` or `;`) detects almost nothing the
//   five checks above miss, since a line-boundary truncation ends on a complete-looking line.
//   The cost of a noisy gate here is measured and specific: this repo's lessons record that a
//   guard wrong 7 times in 8 trains everyone to ignore the once it is right.
//
// • HEADING-LEVEL JUMPS (## directly to ####). Not a truncation signature at all — a truncation
//   REMOVES a heading's body, it does not renumber the heading — and it fires on deliberate
//   emphasis choices. Rejected as a style check wearing a structure check's clothes.
//
// • NUMBERED-LIST MONOTONICITY. Plausible on paper: a truncation inside `1. 2. 3.` leaves a gap.
//   Not adopted because it was not measured clean, and because these docs contain deliberately
//   restarted and interleaved numbering (a nested `a. b. c.` under `1.`, numbered task items
//   quoted inside prose). It needs evidence before adoption, not a default keep.
