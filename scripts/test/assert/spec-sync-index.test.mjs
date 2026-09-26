// scripts/test/assert/spec-sync-index.test.mjs
// The ASSERTION TWIN of scripts/test/functional/spec-sync-index.test.mjs — same id, same subject:
// git.mjs indexFileContents() and the byte-offset parse behind it (handoff-demand-blind-spots D5).
//
// The functional file runs the real index. THIS half drives the parse over a captured Buffer — the
// wire format `cat-file --batch` answers — and the wrapper's failure contract through an injected
// gateway: `null` overall ONLY for "no repository" (128) or "no git" (ENOENT), every other failure,
// ENOBUFS above all, rethrown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, withAssertInvocation } from "../fixtures/assert-harness.mjs";
import { installedInvocation, setInvocation } from "../../lib/invocation.mjs";
import { indexFileContents, parseCatFileBatch } from "../../lib/git.mjs";

/** A `cat-file --batch` answer, built the way git frames it: `<oid> blob <size>` with `<size>` in BYTES,
 *  the content, a newline — or `<name> missing`. */
function batchAnswer(entries) {
  const parts = [];
  entries.forEach(([name, text], i) => {
    if (text === null) { parts.push(Buffer.from(`${name} missing\n`)); return; }
    const body = Buffer.from(text, "utf8");
    parts.push(Buffer.from(`${String(i + 1).padStart(40, "a")} blob ${body.length}\n`), body, Buffer.from("\n"));
  });
  return Buffer.concat(parts);
}

test("3.2 twin: the parse frames by BYTE size, so a second blob after a multi-byte one decodes exactly", () => {
  const a = "## Requirements\n\n### Requirement: Résumé — «é» ✓\n", b = "### Requirement: 日本語\n";
  const names = [":./openspec/specs/a/spec.md", ":./openspec/specs/b/spec.md", ":./openspec/specs/c/spec.md"];
  const got = parseCatFileBatch(batchAnswer([[names[0], a], [names[1], b], [names[2], null]]), names);
  assert.equal(got.get(names[0]), a);
  assert.equal(got.get(names[1]), b, "a string-sliced parse misreads every blob after the first multi-byte one");
  assert.equal(got.get(names[2]), null, "`missing` is the definite answer: absent from the index");
  assert.ok(Buffer.byteLength(a) > a.length, "the fixture really is multi-byte");
});

test("3.2 twin: a malformed or truncated answer THROWS rather than guessing", () => {
  assert.throws(() => parseCatFileBatch(Buffer.from("garbage header\n"), ["x"]), /unexpected header/);
  assert.throws(() => parseCatFileBatch(Buffer.from(`${"a".repeat(40)} blob 99\nshort\n`), ["x"]), /truncated/);
  assert.throws(() => parseCatFileBatch(Buffer.alloc(0), ["x"]), /no answer/);
});

/** Run indexFileContents() under a hand-built gateway whose `indexBlobs` does `impl`. */
function withGateway(impl, fn, gitPath = () => ".git/index") {
  const cwd = tmpRepo();
  const prev = installedInvocation();
  setInvocation({ cwd, root: cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd }, argv: ["node", "conductor.mjs"],
    stdin: { read: () => "", isTTY: false }, stdout: { write: () => true }, stderr: { write: () => true },
    git: { indexBlobs: impl, gitPath } });
  try { return fn(); } finally { setInvocation(prev); }
}
const failing = (props) => () => { const e = new Error("git failed"); Object.assign(e, props); throw e; };

test("3.2 twin: null overall ONLY for a CONFIRMED no repository (128 twice) or no git (ENOENT)", async () => {
  // Gate 2 C2: 128 alone is any fatal error; the gitPath question confirms there is no repository.
  assert.equal(withGateway(failing({ status: 128 }), () => indexFileContents(["openspec/specs/a/spec.md"]),
    failing({ status: 128 })), null);
  assert.equal(withGateway(failing({ code: "ENOENT" }), () => indexFileContents(["openspec/specs/a/spec.md"])), null);
  // And the assertion half's own double, which models "no repository here":
  const cwd = tmpRepo();
  assert.equal(await withAssertInvocation(cwd, () => indexFileContents(["openspec/specs/a/spec.md"])), null);
});

test("C2 twin: a 128 where the repository EXISTS (a corrupt index) is RETHROWN, not read as no repository", () => {
  assert.throws(() => withGateway(failing({ status: 128 }), () => indexFileContents(["openspec/specs/a/spec.md"])),
    /git failed/, "gitPath answers, so the repository exists and the 128 was some other fatal error");
});

test("3.2 twin: ENOBUFS and every other failure are RETHROWN — never reported as 'git cannot answer'", () => {
  assert.throws(() => withGateway(failing({ code: "ENOBUFS" }), () => indexFileContents(["openspec/specs/a/spec.md"])), /git failed/);
  assert.throws(() => withGateway(failing({ status: 1 }), () => indexFileContents(["openspec/specs/a/spec.md"])), /git failed/);
});

test("3.2 twin: ONE call for the whole set, fed `:./<path>` lines, and an empty set asks nothing", () => {
  const seen = [];
  const got = withGateway((input) => { seen.push(input); return batchAnswer([[":./openspec/specs/a/spec.md", "A\n"], [":./openspec/specs/b/spec.md", null]]); },
    () => indexFileContents(["openspec/specs/a/spec.md", "openspec/specs/b/spec.md"]));
  assert.deepEqual(seen, [":./openspec/specs/a/spec.md\n:./openspec/specs/b/spec.md\n"], "one process, `:./` relative to the conductor root");
  assert.deepEqual([...got.entries()], [["openspec/specs/a/spec.md", "A\n"], ["openspec/specs/b/spec.md", null]]);
  const none = withGateway(() => { throw new Error("must not be called"); }, () => indexFileContents([]));
  assert.equal(none.size, 0);
});
