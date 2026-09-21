// scripts/test/assert/emitted-invocations.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/emitted-invocations.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is "every command pm emits must run as written": its extractor walks
// the SHIPPED docs, pulls out every `conductor.mjs …` invocation, and drives each one through the
// engine's own pre-dispatch check. Its tokenizer and form-expander are ~250 lines and are EXPORTED
// FROM THAT FILE rather than from `scripts/lib/` (deliberately — nothing in the engine consumes
// them), so this twin cannot import them without executing that file's tests. What it CAN do is
// carry the INVARIANT the extractor exists to protect, over the same shipped tree, with the engine
// itself as the oracle.
//
// THE INVARIANT IS THE ONE THAT SHIPS: a document a user reads must not contain an invocation the
// engine refuses. This is a SOURCE-AND-DOC check — no git, no repository — so it belongs on the
// per-commit path, where a doc edit that names a flag the engine dropped is caught in the same
// commit that made it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, invokeEngine } from "../fixtures/assert-harness.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENGINE_SRC = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");

/** Every dispatched verb, from the engine's own dispatch table. */
function dispatchedVerbs() {
  const m = ENGINE_SRC.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(m, "could not locate the dispatch table object in conductor.mjs");
  const keys = new Set();
  for (const x of m[1].matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(x[1]);
  for (const x of m[1].matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(x[1]);
  for (const x of m[1].matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(x[1]);
  return keys;
}
const VERBS = dispatchedVerbs();

/** Every shipped markdown file. */
function shippedDocs(root = REPO) {
  const roots = ["commands", "agents", "skills", "hooks", ".claude-plugin"];
  const out = [];
  const walk = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(path.relative(root, p));
    }
  };
  for (const r of roots) {
    const abs = path.join(root, r);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const f of ["README.md"]) if (fs.existsSync(path.join(root, f))) out.push(f);
  return out.sort();
}

/** Every `conductor.mjs <verb> …` occurrence in a document, as its argv words. A deliberately
 *  simple extractor: it handles the inline-code form the docs use, and it is only an ORACLE for the
 *  invariant below — the full tokenizer (alternation groups, wrapped spans, placeholders) is the
 *  functional file's subject. */
function invocationsIn(text) {
  const out = [];
  for (const m of text.matchAll(/`[^`\n]*conductor\.mjs\s+([^`\n]*)`/g)) {
    // Shell REDIRECTIONS are not argv: the docs spell `>/dev/null 2>&1` beside real invocations,
    // and a tokenizer that took them as words would report a verb the engine does not dispatch.
    const words = m[1].trim().split(/\s+/).filter(Boolean)
      .filter(w => !/^[0-9]?[<>&]/.test(w));
    if (words.length) out.push(words);
  }
  return out;
}

test("1.1 every real source class yields at least one invocation", () => {
  const docs = shippedDocs();
  assert.ok(docs.length >= 10, `expected the shipped doc tree, found ${docs.length} files`);
  const total = docs.reduce((n, rel) => n + invocationsIn(fs.readFileSync(path.join(REPO, rel), "utf8")).length, 0);
  assert.ok(total >= 10, `the extractor found ${total} inline invocations across the shipped tree — ` +
    "a walk over an emptied set is a green light");
});

test("1.3 every emitted invocation names a DISPATCHED verb", () => {
  // The ONE non-dispatched verb the shipped tree names, with the reason it is not a defect:
  // `commands/status.md` quotes `node … conductor.mjs status > out.txt` while DOCUMENTING which
  // redirections the gate-guard exemption must not swallow — it is an example of a shape being
  // discussed, not an instruction. Named rather than pattern-excluded, so a second one is caught.
  const JUSTIFIED = new Map([["status", "commands/status.md: an example of a redirected invocation, in the prose about redirections"]]);
  const unknown = [];
  for (const rel of shippedDocs()) {
    for (const words of invocationsIn(fs.readFileSync(path.join(REPO, rel), "utf8"))) {
      const verb = words[0];
      // Placeholders and shell metacharacters are not verbs; the docs use `<verb>`-shaped
      // placeholders in a handful of places, and those are named rather than silently skipped.
      if (/^[<-]/.test(verb) || verb.includes("|")) continue;
      if (!VERBS.has(verb) && !JUSTIFIED.has(verb)) unknown.push(`${rel}: ${verb}`);
    }
  }
  assert.deepEqual(unknown, [], `emitted invocations naming a verb the engine does not dispatch:\n${unknown.join("\n")}`);
});

test("1.3 a known invocation passes the engine's pre-dispatch check", () => {
  const cwd = tmpRepo();
  // The engine is the oracle: a document that names a verb the engine does not dispatch, or whose
  // help surface is gone, is instructing the reader to run something that does not work.
  const named = new Set();
  for (const rel of shippedDocs()) {
    for (const words of invocationsIn(fs.readFileSync(path.join(REPO, rel), "utf8"))) {
      if (VERBS.has(words[0])) named.add(words[0]);
    }
  }
  assert.ok(named.size >= 3, `only ${named.size} dispatched verbs appear in the shipped docs`);
  for (const verb of named) {
    const r = invokeEngine([verb, "--help"], { cwd });
    assert.equal(r.status, 0, `conductor.mjs ${verb} --help must succeed`);
    assert.match(r.stdout + r.stderr, /conductor\.mjs/, `${verb} must print its own help`);
  }
});

test("6.3 the hand-edit scanner: the emitted text never tells a reader to edit state.json by hand", () => {
  const offenders = [];
  for (const rel of shippedDocs()) {
    const text = fs.readFileSync(path.join(REPO, rel), "utf8");
    for (const para of text.split(/\n\s*\n/)) {
      if (/edit .{0,20}(\.conductor\/state\.json|state\.json) .{0,20}(by hand|manually|directly)/i.test(para)) {
        offenders.push(`${rel}: ${para.slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "pm's own surfaces must send a reader through a verb, never to the file");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The 1.1 extractor family (wrapped spans, parenthesised alternatives, `A | B | C` forms, spaced
// placeholders, fenced comments, marker attachment), the 1.4 marker cases, the 1.5 rules-block
// matrix, the Layer B/C builders, the tracker-matrix sweeps and the phase 4/5/6 scenario families
// all drive the extractor and the emitted text through the functional file's own exported helpers —
// which cannot be imported here without executing that file. What survives the narrowing is the
// INVARIANT the extractor exists for, asserted above against the same shipped tree.
