// scripts/test/unit/platform.test.mjs
// 4.1's migration of `assert/platform.test.mjs` — 6 of its 25 tests, moved from the file rung to the
// unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// SIX moved: the whole `rules`-verb family — the explicit-flag preference, the unknown-platform
// refusal, the terminal default, the garbage-recorded-value fallback, the per-platform command form
// and the body-identity check that goes with it. `rules` PRINTS the block and writes no path, so
// every observable in the family is a value: the platform resolution and the emitted text.
//
// NINETEEN STAY, and they fall into three populations:
//   1. `write-rules`/`init` WRITE a rules block — `writeRules()` reaches CLAUDE.md or AGENTS.md
//      through raw fs, so the run-time counter refuses any test whose fixture runs one. That is the
//      change's seam edge "a VERB whose side effect writes a path", and it is why the in-place
//      refresh, the hermes/codex target chain and the dormancy pair stay put.
//   2. `rules-target` READS the filesystem to resolve first-existing-wins — the walk is the verb's
//      own mechanism, and one of the four asserts the resolved path by exact equality.
//   3. The shipped-hooks test reads `hooks/hooks.json` through a URL — a source read, which the
//      source scan refuses in this half.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())` (or a seeded record)
//   `run(args, { cwd })`                    →  `engine(args)`
//   `JSON.parse(fs.readFileSync(state.json))`→ `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

// ────────────── platform resolution + rules target ──────────────

unitTest("resolvePlatform prefers an explicit --platform flag over everything", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules", "--platform", "codex"]);
  assert.match(out, /\/pm-status/, "codex form should appear when --platform codex is passed");
  assert.doesNotMatch(out, /\/pm:status/, "the claude-code form must not leak through");
});

unitTest("resolvePlatform rejects an unknown --platform instead of silently defaulting", () => {
  const engine = memoryEngine(emptyRecord());
  const r = engine.result(["rules", "--platform", "nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--platform must be one of claude-code\|hermes\|codex/);
});

unitTest("resolvePlatform falls back to claude-code when nothing declares a platform", () => {
  const engine = memoryEngine(emptyRecord());
  // CLAUDECODE is blanked to prove the TERMINAL DEFAULT is doing the work. (This comment used
  // to claim it distinguished the default from an "env rung" -- it never could, because that
  // rung also returned "claude-code". The rung is gone; the blanking stays, so the assertion
  // cannot be satisfied by an env var that happens to be set in the runner's environment.)
  const out = engine(["rules"], { env: { CLAUDECODE: "" } });
  assert.match(out, /\/pm:status/);
});

unitTest("an unrecognised recorded platform falls back rather than corrupting the block", () => {
  // The garbage value goes into the RECORD the store holds, which is where the hand-edit used to
  // land — the subject is what the verb does with it, not how it got there.
  const engine = memoryEngine({ ...emptyRecord(), platform: "not-a-real-platform" });

  const out = engine(["rules"], { env: { CLAUDECODE: "" } });
  assert.match(out, /\/pm:status/, "a garbage recorded platform must resolve to the base platform");
  assert.doesNotMatch(out, /not-a-real-platform/);
});

// ────────────── per-platform command form ──────────────

unitTest("rules block uses the platform's command form, and the body stays identical otherwise", () => {
  const engine = memoryEngine(emptyRecord());

  const cc = engine(["rules", "--platform", "claude-code"]);
  const hermes = engine(["rules", "--platform", "hermes"]);
  const codex = engine(["rules", "--platform", "codex"]);

  assert.match(cc, /\/pm:status/);
  assert.match(hermes, /\/pm:status/, "Hermes preserves ':' in plugin command names");
  assert.match(codex, /\/pm-status/, "Codex command names come from prompt-file stems: flat");
  assert.doesNotMatch(codex, /\/pm:/, "no namespaced form may leak into the codex block");

  // The BODY is platform-neutral: normalising the command form makes the blocks equal.
  const norm = (s) => s.replace(/\/pm[-:]/g, "/pm§");
  assert.equal(norm(codex), norm(cc), "only command strings may differ between platforms");
  assert.equal(norm(hermes), norm(cc));
});

unitTest("rulesBlock defaults to the claude-code command form when no platform is given", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"], { env: { CLAUDECODE: "" } });
  assert.match(out, /\/pm:status/);
});
