// scripts/test/no-inline-exit.test.mjs
//
// 0.47.0 (engine-invocation). THE guard for the ONE exit path.
//
// Before this change the engine refused by calling `process.exit()`, at 194 sites in scripts/lib
// and five in conductor.mjs. That is not testable in-process — an exit cannot be observed, only
// survived — and it is the reason every assertion about a refusal had to spawn a `node`. It is
// also unsafe under the assertion half's design: all of its files share ONE process
// (`--test-isolation=none`), so a single stray exit takes every remaining test file down with it
// and the failure reads as a catastrophe rather than as the one refusal it is.
//
// So the engine refuses by THROWING (lib/command-exit.mjs), and this guard is what keeps that
// true. It reads source, so it is deliberately dumb about everything except the one question:
// is there an executable `process.exit(` anywhere in the engine?
//
// WHAT IS NOT A MATCH, and each for a reason that would otherwise make the guard wrong:
//   - a mention inside a comment or a string (the engine documents this rule in prose);
//   - `process.exitCode`, which is the CLI tail's whole point — it is how the status reaches the
//     runtime WITHOUT truncating a hook's stdout payload at a pipe buffer (conductor-38).
//
// MUTATION-VERIFIED (task 1.3, evidence kept in the change directory as
// red-1.x-mutation-evidence.txt): re-introducing one inline exit by hand must make THIS guard go
// red, naming the file and line. A guard whose failure mode is "the whole process died" would
// prove nothing, and `docs/lessons/a-guard-can-check-the-wrong-half.md` is the standing reason to
// check which half a guard is actually watching.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = path.join(SCRIPTS, "lib");

/** Byte offsets (into `src`) that hold CODE: not a comment, not inside a string, template or
 *  regex literal. A scan over raw text would find `process.exit(` in the paragraph above. */
function codeMask(src) {
  const n = src.length;
  const mask = new Uint8Array(n).fill(1);
  let i = 0;
  let prev = "";
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") mask[i++] = 0; continue; }
    if (c === "/" && c2 === "*") {
      mask[i++] = 0; mask[i++] = 0;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) mask[i++] = 0;
      if (i < n) { mask[i++] = 0; mask[i++] = 0; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; mask[i++] = 0;
      while (i < n) {
        if (src[i] === "\\") { mask[i++] = 0; if (i < n) mask[i++] = 0; continue; }
        if (src[i] === q) { mask[i++] = 0; break; }
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
          mask[i++] = 0; mask[i++] = 0;
          let depth = 1;
          while (i < n && depth > 0) {
            const cc = src[i];
            if (cc === "{") { depth++; i++; continue; }
            if (cc === "}") { depth--; i++; if (depth === 0) mask[i - 1] = 0; continue; }
            if (cc === '"' || cc === "'" || cc === "`") {
              const qq = cc; mask[i++] = 0;
              while (i < n) {
                if (src[i] === "\\") { mask[i++] = 0; if (i < n) mask[i++] = 0; continue; }
                mask[i++] = 0;
                if (src[i - 1] === qq) break;
              }
              continue;
            }
            i++;
          }
          continue;
        }
        mask[i++] = 0;
      }
      prev = "s"; continue;
    }
    if (c === "/" && /[=(,:[!&|?{};+\-*%<>~^]/.test(prev || "=")) {
      mask[i++] = 0;
      let inClass = false;
      while (i < n) {
        if (src[i] === "\\") { mask[i++] = 0; if (i < n) mask[i++] = 0; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { mask[i++] = 0; break; }
        else if (src[i] === "\n") break;
        mask[i++] = 0;
      }
      while (i < n && /[a-z]/i.test(src[i])) mask[i++] = 0;
      prev = "r"; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return mask;
}

/** Every EXECUTABLE `process.exit(` site in `src`, as `<line>: <the line>`. */
export function executableExitSites(src) {
  const mask = codeMask(src);
  const out = [];
  const re = /process\.exit\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (mask[m.index] !== 1) continue;
    const line = src.slice(0, m.index).split("\n").length;
    out.push(`${line}: ${src.split("\n")[line - 1].trim()}`);
  }
  return out;
}

/** The engine's own source: the entry point and every library module. */
function engineSources() {
  const files = [path.join(SCRIPTS, "conductor.mjs"),
    ...fs.readdirSync(LIB).filter(f => f.endsWith(".mjs")).map(f => path.join(LIB, f))];
  return files.map(f => ({ file: path.relative(SCRIPTS, f), src: fs.readFileSync(f, "utf8") }));
}

test("the engine contains no executable process.exit( — a refusal throws instead", () => {
  const findings = [];
  for (const { file, src } of engineSources()) {
    for (const site of executableExitSites(src)) findings.push(`${file}:${site}`);
  }
  assert.deepEqual(findings, [],
    "an executable process.exit() kills the assertion half's ONE shared process. Every refusal " +
    "must go through die() in lib/command-exit.mjs, which writes the message and throws " +
    "CommandExit. The CLI tail assigns process.exitCode, which this guard does not match.");
});

test("the guard's scanner does not read comments or strings, and does not match process.exitCode", () => {
  // Non-vacuity: a scanner that matched raw text would find the rule's own documentation, and one
  // that matched `process.exitCode` would fail the tail this change depends on.
  assert.deepEqual(executableExitSites("// process.exit(1)\nconst s = \"process.exit(1)\";"), []);
  assert.deepEqual(executableExitSites("process.exitCode = 3;\n"), []);
  assert.deepEqual(executableExitSites("process.exit(1);"), ["1: process.exit(1);"]);
  assert.deepEqual(executableExitSites("const t = `a ${process.exit(2)} b`;"), ["1: const t = `a ${process.exit(2)} b`;"]);
});

test("the CLI tail reaches the runtime by assigning process.exitCode", () => {
  // The inverse check: the guard must not be satisfiable by deleting the tail's result, which
  // would exit 0 on every refusal.
  const src = fs.readFileSync(path.join(SCRIPTS, "conductor.mjs"), "utf8");
  assert.match(src, /process\.exitCode\s*=/,
    "conductor.mjs must carry the status out through process.exitCode — a bare `return` from the " +
    "module loses the refusal status, and process.exit() would truncate a hook's stdout payload");
});
