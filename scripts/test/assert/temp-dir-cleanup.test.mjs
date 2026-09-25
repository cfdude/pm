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
const CALL = new RegExp("mkdtemp" + "Sync\\(");
const SCHEDULED = new RegExp("removeAtExit\\(\\s*fs\\.mkdtemp" + "Sync\\(");

/** Sites that are removed some other way, each with how. `token` is text on the call's line, so an
 *  entry names ONE site and survives the file's lines moving. `tail: true` marks a site known to leak
 *  that this change deliberately did not touch. */
const KNOWN = [
  { file: "fixtures/fixture-snapshot.mjs", token: "-template-`", how: "disposed by the file's after() hook and the module's exit hook" },
  { file: "fixtures/fixture-snapshot.mjs", token: "`${name}-`", how: "each handed-out copy is tracked and disposed by the file's after() hook" },
  { file: "fixtures/assert-git-shim.mjs", token: "pm-assert-no-git-", how: "removed by the shim's own exit listener, after it drains the spawn log (drainAndRemove)" },
  { file: "assert/git-shim.test.mjs", token: "pm-shim-removal-", how: "removed by the test itself — removing it is what the test checks" },
  { file: "assert/git-shim.test.mjs", token: "pm-shim-schedule-", how: "removed in the test's finally" },
  { file: "assert/git-shim.test.mjs", token: "pm-shim-drain-", how: "removed by drainAndRemove(), which the test checks" },
  { file: "functional/git-shim.test.mjs", token: "pm-git-shim-run-", how: "removed in the test's finally" },
  { file: "functional/conductor-09.test.mjs", token: "pm-stub-node-", how: "removed in the test's finally" },
  { file: "functional/runtime-support.test.mjs", token: "pm-node-version-preload-", how: "removed in the test's finally" },
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

/** Every call site: `{ file, line, text }`. A line that is a comment is not a call. */
function callSites() {
  const sites = [];
  for (const file of sources()) {
    const lines = fs.readFileSync(path.join(TEST_ROOT, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      const t = text.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (CALL.test(text.replace(/\/\/.*$/, ""))) sites.push({ file, line: i + 1, text: t });
    });
  }
  return sites;
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

test("temp-dir-cleanup: every mkdtempSync site in scripts/test is scheduled on its line or enrolled with how it is removed", () => {
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
