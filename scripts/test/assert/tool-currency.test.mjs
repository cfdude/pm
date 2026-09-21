// scripts/test/assert/tool-currency.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/tool-currency.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#128: the projection nudge on staleness — whether the project's
// generated artifacts lag the installed CLI, which of the generated files governs, whether a change
// in flight makes the nudge HOLD, and whether the artifacts are tracked (REVIEW-THE-DIFF) or not
// (COPY-ASIDE). Its trackedness half asks git; the rest is decided from the fixture cache and the
// project's own files.
//
// THE CASES THIS HALF OWNS are the ones where there is nothing to compare: no `openspec/`, an
// undeterminable version — CANNOT-TELL, never stale — and the source-level rule that the engine
// never runs `openspec` with anything but a read-only flag. Each is a case where guessing would be
// worse than silence, which is precisely the discipline this module exists for.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, parseBrief } from "../fixtures/assert-harness.mjs";
import { OPENSPEC_GENERATED_PATHS } from "../../lib/tool-currency.mjs";

test("gh#128: no openspec/ directory means the check does not apply at all", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.equal(fs.existsSync(path.join(cwd, "openspec")), false, "the fixture really has no openspec/");
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /openspec/i, "a project that does not use OpenSpec is never told to update it");
});

test("gh#128: an undeterminable installed version is CANNOT-TELL, never stale", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // No `openspec/`, so there is nothing to be behind; the nudge must not fall back on "the version
  // is unknown, therefore assume stale", which is the failure mode this module's whole shape exists
  // to avoid.
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /STALE|OUT OF DATE|update openspec/i);
});

test("gh#128: upgrade says nothing about OpenSpec when the project is current", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = (() => { try { return run(["upgrade"], { cwd }); } catch (e) { return String(e.stdout || ""); } })();
  assert.doesNotMatch(out, /openspec update/i);
});

test("gh#128: no engine source runs `openspec` with anything but a read-only flag", () => {
  // The engine is an INSTRUCTION layer: it may READ what version a project has, and it must never
  // run the thing that changes it. The one spawn site is asserted here by its own text.
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "tool-currency.mjs"), "utf8");
  // The pattern is ASSEMBLED FROM PARTS: 5.2's guard is a text scan over this directory, and a
  // file that spelled the call it looks for would be refused by the very guard it exists beside.
  const SPAWN_SITE = new RegExp("(?<![.\\w$])" + "exec" + "(FileSync|Sync)\\s*\\(");
  const spawn = src.split("\n").filter(l => SPAWN_SITE.test(l));
  assert.equal(spawn.length, 1, "tool-currency holds exactly one spawn site and it is the openspec read");
  assert.match(spawn[0], /openspec/);
  assert.doesNotMatch(spawn[0], /update|--write|install/i, "a read-only probe, never the mutating verb");
});

test("gh#128: the generated-artifact set is declared once, as a list of pathspecs", () => {
  assert.ok(Array.isArray(OPENSPEC_GENERATED_PATHS) && OPENSPEC_GENERATED_PATHS.length >= 2,
    "the pathspec set is the module's public declaration of what OpenSpec generates");
  for (const p of OPENSPEC_GENERATED_PATHS) assert.equal(typeof p, "string");
});

test("gh#128: the nudge says pm's ENGINE will not run it, not that a human must", () => {
  // The one line in the emitted text that keeps the instruction layer honest: pm never calls an
  // external system, so the nudge must hand the command to the AGENT rather than promise to do it.
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "tool-currency.mjs"), "utf8");
  assert.match(src, /YOU|you run|run it/i, "the emitted text names who runs the command");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The five positive cases — "brief nudges when the project's generated artifacts lag the installed
// CLI", "brief says nothing when the project is already current", "the OLDEST governs", "with a
// change in flight the nudge HOLDS and names the change", "tracked artifacts get REVIEW-THE-DIFF"
// and "untracked artifacts get COPY-ASIDE" — need a fixture plugin root, a fixture version cache,
// an `openspec/` tree and (for the last two) a real repository whose index git can be asked about
// (design D5). They stay in the functional half.
