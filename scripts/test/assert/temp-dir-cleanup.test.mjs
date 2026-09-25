// scripts/test/assert/temp-dir-cleanup.test.mjs
// gh-cfdude-pm-224 — EVERY TEMP DIRECTORY THE TEST TREE MAKES HAS A WAY TO BE REMOVED.
//
// WHAT WENT WRONG. Measured 2026-09-25 in a hermetic TMPDIR: one assertion-half run left 436
// directories behind and one functional-half run left 1,517 — `tmpRepo()` alone about 1,850 of them.
// Nothing removed them, and nothing said so. The mechanism now is 0.49.0's, and only that one:
// `removeAtExit()` from `fixtures/temp-dir.mjs`, or a removal in the site's own `finally`.
//
// It is the ASSERTION TWIN of `functional/temp-dir-cleanup.test.mjs`, which runs the fixture helpers
// in a process of their own and counts what survives it. This file holds the two halves of the rule
// that need no process boundary and therefore run on every commit:
//   * the helpers SCHEDULE what they make — the removal itself runs at exit, where no test can see it;
//   * every `mkdtempSync` call in the tree is ENROLLED: scheduled on its own line, or named in KNOWN
//     below with how it is removed. A new unscheduled site fails HERE, per commit, rather than only
//     when the triggered functional half next runs.
// WHAT COUNTS AS A SITE. Any mention of the `mkdtemp` / `mkdtempSync` identifier in CODE — a call, an
// alias (`const mk = fs.mkdtempSync`), a destructure, `fs.promises.mkdtemp(` — so an alias cannot
// launder an unscheduled directory past the scan. Comments, and the name inside a string or regex
// literal (the fs-call name lists several guards keep), are not sites. THE LIMIT, stated: a name
// built at run time (`fs["mk" + "dtempSync"]`) and a directory made by a spawned process are not
// seen; the functional twin, which counts what is actually left on disk, is the backstop for both.
// A site is SCHEDULED only in the one shape `removeAtExit(fs.mkdtempSync(` — every other shape,
// an alias included, must be enrolled in KNOWN.
//
// HOW A KNOWN ENTRY IS VERIFIED — mechanically, not trusted by hand. Each entry names its `cleanup`:
// the text of the call that removes (or registers for removal) that directory, which must appear in
// code within `within` lines after the site. Chosen over "trusted by hand" because trusting it is the
// defect a review found: deleting conductor-09's `rmSync` left the guard green. What it proves is
// PRESENCE NEAR THE SITE, not control flow — a cleanup outside its `finally` still passes, and the
// functional twin is what sees the directory actually survive.
// FILE RUNG: it reads source bytes and makes directories.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, fixtureCache, fixturePluginRoot } from "../fixtures/assert-harness.mjs";
import { scheduledForRemoval } from "../fixtures/temp-dir.mjs";

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Built from parts so this file's own source is not a match for the pattern it scans for.
const NAME = "mkdtemp";
// The identifier, not preceded by a quote, a backtick or a regex's opening slash.
const SITE = new RegExp("(^|[^\"'`/\\w])" + NAME + "(Sync)?\\b");
const SCHEDULED = new RegExp("removeAtExit\\(\\s*fs\\." + NAME + "Sync\\(");

/** Sites that are removed some other way, each with how. `token` is text on the call's line, so an
 *  entry names ONE site and survives the file's lines moving. `tail: true` marks a site known to leak
 *  that this change deliberately did not touch. */
const KNOWN = [
  { file: "fixtures/fixture-snapshot.mjs", token: "-template-`", cleanup: "TEMPLATES.add(template)", within: 4,
    how: "registered in TEMPLATES, which the file's after() hook and the module's exit hook dispose" },
  { file: "fixtures/fixture-snapshot.mjs", token: "`${name}-`", cleanup: "slot.copies.add(handed)", within: 2,
    how: "registered in the slot's copies, which the file's after() hook disposes" },
  { file: "fixtures/assert-git-shim.mjs", token: "pm-assert-no-git-", cleanup: "drainAndRemove(shimDir)", within: 50,
    how: "removed by the shim's own exit listener, after it drains the spawn log" },
  { file: "assert/git-shim.test.mjs", token: "pm-shim-removal-", cleanup: "shim.removeTempDir(dir)", within: 5,
    how: "removed by the test itself — removing it is what the test checks" },
  { file: "assert/git-shim.test.mjs", token: "pm-shim-schedule-", cleanup: "shim.removeTempDir(dir)", within: 6,
    how: "removed in the test's finally" },
  { file: "assert/git-shim.test.mjs", token: "pm-shim-drain-", cleanup: "shim.drainAndRemove(dir)", within: 3,
    how: "removed by drainAndRemove(), which the test checks" },
  { file: "functional/git-shim.test.mjs", token: "pm-git-shim-run-", cleanup: "fs.rmSync(dir", within: 30,
    how: "removed in the test's finally" },
  { file: "functional/conductor-09.test.mjs", token: "pm-stub-node-", cleanup: "fs.rmSync(stubDir", within: 20,
    how: "removed in the test's finally" },
  { file: "functional/runtime-support.test.mjs", token: "pm-node-version-preload-", cleanup: "fs.rmSync(dir", within: 15,
    how: "removed in the test's finally" },
  { file: "assert/conductor-33.test.mjs", token: "tmpRepo())), prefix", tail: true,
    how: "LEAKS (pm-seg*) — scratchDir() was out of gh-cfdude-pm-224's scope: another agent owned conductor-33 in 0.50.0" },
];

/** Every `.mjs` under scripts/test, repo-relative to it. */
function sources(dir = TEST_ROOT, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...sources(dir, r));
    else if (e.name.endsWith(".mjs")) out.push(r);
  }
  return out.sort();
}

/** The source with comments blanked line by line: whole-line `//` and `*` comments, trailing `//`
 *  comments, and inline block comments. Line numbers are preserved. */
function codeLines(src) {
  return src.split("\n").map((text) => {
    const t = text.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
    return text.replace(/\/\*.*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/, "$1");
  });
}

/** Every site in one source: `{ line, text }`. Exported shape for the discrimination test. */
export function sitesIn(src) {
  const sites = [];
  codeLines(src).forEach((code, i) => { if (SITE.test(code)) sites.push({ line: i + 1, text: code.trim() }); });
  return sites;
}

/** Does `cleanup` appear in code within `within` lines after the site on `line` (1-based)? */
export function cleanupNear(src, line, cleanup, within) {
  const lines = codeLines(src);
  return lines.slice(line - 1, line + within).some((l) => l.includes(cleanup));
}

/** Every site in the tree: `{ file, line, text }`. */
function callSites() {
  return sources().flatMap((file) =>
    sitesIn(fs.readFileSync(path.join(TEST_ROOT, file), "utf8")).map((s) => ({ file, ...s })));
}

test("temp-dir-cleanup: tmpRepo, fixtureCache and fixturePluginRoot schedule their directory for removal at exit", () => {
  const made = { tmpRepo: tmpRepo(), fixtureCache: fixtureCache(["0.1.0"]), fixturePluginRoot: fixturePluginRoot("0.1.0") };
  const scheduled = scheduledForRemoval();
  for (const [helper, dir] of Object.entries(made)) {
    assert.ok(fs.existsSync(dir), `${helper}() handed back ${dir}, which does not exist`);
    assert.ok(scheduled.includes(dir),
      `${helper}() made ${dir} and did not schedule it with removeAtExit(), so every call leaks one directory`);
  }
});

test("temp-dir-cleanup: every temp-dir site in scripts/test is scheduled on its line or enrolled with how it is removed", () => {
  const sites = callSites();
  assert.ok(sites.length > 15, `found ${sites.length} call sites — a scan that finds almost none is not a check`);
  const unenrolled = sites.filter((s) => !SCHEDULED.test(s.text)
    && !KNOWN.some((k) => k.file === s.file && s.text.includes(k.token)));
  assert.deepEqual(unenrolled.map((s) => `${s.file}:${s.line}  ${s.text}`), [],
    "these temp directories are made and never removed — wrap the call in removeAtExit() " +
    "(fixtures/temp-dir.mjs), or remove it in a finally and enrol it in KNOWN with how");
});

test("temp-dir-cleanup: every KNOWN entry still names a live, unscheduled site", () => {
  // THE INVERSE OF ENROLMENT. An entry whose site was deleted or has since been scheduled would read
  // as a documented exception to nothing. The tail entry is exempt from the "still live" half only:
  // when its owner closes it, deleting the entry is the owner's step, and the next line says so.
  const sites = callSites();
  const stale = KNOWN.filter((k) => !k.tail
    && !sites.some((s) => s.file === k.file && s.text.includes(k.token) && !SCHEDULED.test(s.text)));
  assert.deepEqual(stale.map((k) => `${k.file} ${k.token}`), [],
    "these KNOWN entries name no live unscheduled site — delete them");
});

test("temp-dir-cleanup: the scan sees every spelling of the call, and no mention that is not one", () => {
  const N = NAME;  // built from parts, as above
  const sites = {
    direct: `const d = fs.${N}Sync(path.join(os.tmpdir(), "x-"));`,
    aliased: `const mk = fs.${N}Sync;`,
    destructured: `const { ${N}Sync: mk } = fs;`,
    promises: `const d = await fs.promises.${N}(path.join(os.tmpdir(), "x-"));`,
    imported: `import { ${N} } from "node:fs/promises";`,
  };
  for (const [shape, src] of Object.entries(sites)) {
    assert.equal(sitesIn(src).length, 1, `the ${shape} spelling is a site and the scan missed it: ${src}`);
  }
  const notSites = {
    lineComment: `// a ${N}Sync( in prose`,
    trailingComment: `x(); // then ${N}Sync(`,
    blockComment: `try { y(); } catch { /* the ${N} path is all there is */ }`,
    nameList: `  "chmodSync", "${N}Sync",`,
    regexLiteral: `assert.doesNotMatch(src, /${N}|gitInit/);`,
  };
  for (const [shape, src] of Object.entries(notSites)) {
    assert.deepEqual(sitesIn(src), [], `a ${shape} is not a site: ${src}`);
  }
  assert.ok(SCHEDULED.test(`removeAtExit(fs.${N}Sync(path.join(os.tmpdir(), "x-")))`), "the scheduled shape is recognised");
  assert.ok(!SCHEDULED.test(sites.aliased), "an alias is never scheduled — it must be enrolled");
});

test("temp-dir-cleanup: a KNOWN entry's cleanup must be in code near its site", () => {
  const src = [
    "const dir = make();",
    "try {",
    "  use(dir);",
    "} finally {",
    "  fs.rmSync(dir, { recursive: true, force: true });",
    "}",
  ].join("\n");
  assert.equal(cleanupNear(src, 1, "fs.rmSync(dir", 5), true, "a cleanup four lines on is found");
  assert.equal(cleanupNear(src, 1, "fs.rmSync(dir", 2), false, "a cleanup beyond `within` is not");
  const commented = src.replace("  fs.rmSync(dir", "  // fs.rmSync(dir");
  assert.equal(cleanupNear(commented, 1, "fs.rmSync(dir", 5), false, "a commented-out cleanup is not a cleanup");
  const removed = src.split("\n").filter((l) => !l.includes("rmSync")).join("\n");
  assert.equal(cleanupNear(removed, 1, "fs.rmSync(dir", 5), false, "a deleted cleanup is not found");
});

test("temp-dir-cleanup: every KNOWN entry's cleanup is present near its site", () => {
  const missing = [];
  for (const k of KNOWN.filter((e) => !e.tail)) {
    const src = fs.readFileSync(path.join(TEST_ROOT, k.file), "utf8");
    const site = sitesIn(src).find((x) => x.text.includes(k.token));
    if (!site) continue;  // a dead entry is the previous test's finding, not this one's
    if (!k.cleanup || !cleanupNear(src, site.line, k.cleanup, k.within ?? 0)) {
      missing.push(`${k.file}:${site.line} — expected ${JSON.stringify(k.cleanup)} within ${k.within} lines (${k.how})`);
    }
  }
  assert.deepEqual(missing, [], "these KNOWN sites no longer carry the cleanup their entry names");
});
