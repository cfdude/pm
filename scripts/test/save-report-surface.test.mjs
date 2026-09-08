// scripts/test/save-report-surface.test.mjs
// THE guard behind `epic-annotation`'s "a write that changes nothing says so".
//
// The requirement binds THE WRITE SURFACE and not an enumerated list of paths, and it shipped at
// exactly one verb: `update-epic` kept saveState()'s return while twenty-odd siblings discarded it
// and printed an unconditional success line. Gate 2 EXECUTED four of them and confirmed each
// reporting success on a save that wrote nothing.
//
// A behavioural test per verb would not have caught that and will not catch the next one — the
// defect is an ABSENT edit in a file no diff touches, which is exactly what a diff-scoped review
// structurally cannot see. So the guard is a SOURCE SCAN over the shipped engine, and it is
// per-CALL-SITE rather than per-file on purpose: `tracker.mjs` holds three saves, `releases.mjs`,
// `claims.mjs` and `active-pointer.mjs` two each, and a file-level "does this module mention
// `.unchanged` anywhere" check passes with one of three fixed. That is the same blindness one
// level up.
//
// THE RULE. Every call to saveState() in the shipped engine either
//   (a) CAPTURES the return in a `const`/`let` and hands that name to reportSave() in the same
//       file, or
//   (b) carries `// save-report: exempt — <reason>` within the three lines above it.
// (b) is the per-verb judgement the finding asked for, in a form a scan can read: a verb that
// prints no outcome line at all has nothing for a no-op to falsify, and saying so at the call site
// is what keeps that claim auditable when the verb later grows one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined } from "./helpers.mjs";

const LIB = new URL("../lib/", import.meta.url).pathname;
const SCRIPTS = new URL("../", import.meta.url).pathname;

/** `saveState` is DEFINED here; the rule is about its callers. */
const SKIP = new Set(["state.mjs", "save-report.mjs"]);

/** Strip block comments and line comments, preserving line count and column positions so a hit's
 *  line number still points at the real source. Deliberately naive about string literals: no
 *  saveState() call site in this engine sits inside one, and the assertion below on the number of
 *  sites found is what stops a stripper that has quietly started eating live code. */
function stripComments(src) {
  let out = "";
  let inBlock = false, inLine = false, i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (src[i] === "\n") { inLine = false; out += "\n"; i++; continue; }
    if (inBlock) { if (c === "*" && d === "/") { inBlock = false; out += "  "; i += 2; } else { out += " "; i++; } continue; }
    if (inLine) { out += " "; i++; continue; }
    if (c === "/" && d === "*") { inBlock = true; out += "  "; i += 2; continue; }
    if (c === "/" && d === "/") { inLine = true; out += "  "; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

const EXEMPT = /^\s*\/\/\s*save-report:\s*exempt\s*—\s*(\S.*)$/;
const CAPTURE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*saveState\s*\($/;

/** Every real (non-comment) saveState() call in one file, classified. */
function callSites(file, src) {
  const rawLines = src.split("\n");
  const codeLines = stripComments(src).split("\n");
  const sites = [];
  for (let n = 0; n < codeLines.length; n++) {
    let from = 0;
    for (;;) {
      const at = codeLines[n].indexOf("saveState(", from);
      if (at === -1) break;
      from = at + 1;
      const head = codeLines[n].slice(0, at + "saveState(".length);
      const captured = (head.match(CAPTURE) || [])[1] || null;
      let exemptReason = null;
      for (let back = 1; back <= 3 && n - back >= 0; back++) {
        const m = rawLines[n - back].match(EXEMPT);
        if (m) { exemptReason = m[1].trim(); break; }
      }
      sites.push({ file, line: n + 1, captured, exemptReason, text: rawLines[n].trim() });
    }
  }
  return sites;
}

function shippedSites() {
  const files = [
    ...fs.readdirSync(LIB).filter(f => f.endsWith(".mjs") && !SKIP.has(f)).map(f => path.join(LIB, f)),
    ...fs.readdirSync(SCRIPTS).filter(f => f.endsWith(".mjs")).map(f => path.join(SCRIPTS, f)),
  ];
  const out = [];
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    out.push(...callSites(path.basename(abs), src).map(s => ({ ...s, src })));
  }
  return out;
}

test("the scan finds the engine's saveState call sites at all — a stripper that ate the source passes vacuously otherwise", () => {
  const sites = shippedSites();
  assert.ok(sites.length >= 20,
    `only ${sites.length} saveState() call site(s) located; the engine has well over twenty, so ` +
    "the comment stripper or the walk is broken and every assertion below is passing on nothing");
  // And the stripper must actually strip: this engine documents saveState() in prose constantly.
  const commentMentions = fs.readFileSync(path.join(LIB, "constants.mjs"), "utf8")
    .split("\n").filter(l => l.includes("saveState(")).length;
  assert.ok(commentMentions > 0, "constants.mjs no longer mentions saveState() in prose — pick another witness");
  assert.equal(sites.filter(s => s.file === "constants.mjs").length, 0,
    "constants.mjs calls saveState() nowhere; every mention there is a comment, so a scan " +
    "reporting a site in it is matching prose");
});

test("every saveState call site either reports from the save's own answer or declares why it does not", () => {
  const offenders = [];
  for (const s of shippedSites()) {
    if (s.exemptReason) {
      assert.ok(s.exemptReason.length > 30,
        `${s.file}:${s.line} declares a save-report exemption with no usable reason — the reason ` +
        "is the whole point of the marker, since it is what a later reader audits");
      continue;
    }
    if (!s.captured) { offenders.push(`${s.file}:${s.line} discards saveState()'s return — ${s.text}`); continue; }
    if (!new RegExp(`reportSave\\(\\s*${s.captured}\\b`).test(s.src)) {
      offenders.push(`${s.file}:${s.line} captures the save as '${s.captured}' and never hands it to reportSave()`);
    }
  }
  assert.deepEqual(offenders, [],
    "a verb that prints a success line without consulting saveState()'s `unchanged` reports a " +
    "write that did not happen. Capture the return and pass it to reportSave() from " +
    "lib/save-report.mjs, or mark the site `// save-report: exempt — <why this verb has no " +
    "outcome line to falsify>`");
});

test("the shared reporter chooses from the save's answer, and says nothing when there is nothing to say", async () => {
  const { reportSave, STATE_UNCHANGED } = await import(new URL("../lib/save-report.mjs", import.meta.url));
  const seen = [];
  const stream = { write: (s) => seen.push(s) };

  reportSave({ ok: true, revision: 4 }, { changed: "did it", unchanged: "did nothing", stream });
  assert.deepEqual(seen, ["did it\n"], "a real write reports the changed line");

  seen.length = 0;
  reportSave({ ok: true, revision: 4, unchanged: true }, { changed: "did it", unchanged: "did nothing", stream });
  assert.deepEqual(seen, ["did nothing\n"], "a no-op save reports the unchanged line");

  // A hook write that SKIPPED on conflict carries no `unchanged`, and must not be reported as a
  // no-op: a lost write and a write that had nothing to do are opposite facts.
  seen.length = 0;
  reportSave({ ok: false, expected: 1, found: 2, verb: "render" }, { changed: "did it", unchanged: "did nothing", stream });
  assert.deepEqual(seen, ["did it\n"]);

  seen.length = 0;
  reportSave({ ok: true, unchanged: true }, { changed: "did it", unchanged: "did nothing", stream, quiet: true });
  assert.deepEqual(seen, [], "quiet suppresses the line, exactly as sync's own quiet flag does");

  assert.ok(STATE_UNCHANGED.includes(".conductor/state.json"),
    "the shared tail must name the FILE — most verbs re-render PROJECT.md and CLAUDE.md even " +
    "when state.json does not move, so an unqualified 'nothing changed' would be false");
});

// ─────────────── the four verbs Gate 2 executed, now behavioural ───────────────
//
// The scan above is what stops the defect RECURRING; these are what prove it was actually fixed.
// One per module the reviewer ran by hand, chosen so each is a genuine no-op a user reaches by
// running the same command twice — not a contrivance.

test("a second `set-gate-guard`, `set-review-mode`, `set-active` or `set-activity-log` reports no change", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "claude-code"], { cwd });

  const twice = [
    [["set-gate-guard", "on"], /gate guard was already on/i],
    [["set-review-mode", "--mode", "thorough"], /review mode was already 'thorough'/i],
    [["set-active", "subject"], /was already the active epic/i],
    [["set-activity-log", "on"], /activity log was already on/i],
    [["set-lane-routing", "--add", "docs:claude-code"], /already held exactly these/i],
  ];
  for (const [args, expected] of twice) {
    const first = runCombined(args, { cwd });
    assert.doesNotMatch(first, expected, `the FIRST \`${args[0]}\` did real work — ${first}`);
    const second = runCombined(args, { cwd });
    assert.match(second, expected,
      `\`${args.join(" ")}\` run twice still reports success for a write that did not happen`);
    assert.match(second, /nothing was written to \.conductor\/state\.json/i,
      "the unchanged line names the FILE — PROJECT.md and the rules block were re-rendered");
  }
});

test("the state file is byte-identical across the re-run that reports no change", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-gate-guard", "on"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = runCombined(["set-gate-guard", "on"], { cwd });
  assert.match(out, /already on/i);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "the report is only honest if the file really did not move");
});
