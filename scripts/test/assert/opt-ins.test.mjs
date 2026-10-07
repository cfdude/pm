// scripts/test/assert/opt-ins.test.mjs
// gh#210 — the file-rung half: bytes on disk and the real `upgrade` output.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "../fixtures/assert-harness.mjs";
import { OPT_INS } from "../../lib/opt-ins.mjs";
import { engineCode } from "../fixtures/source-code.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("gh#210: every registry row names a command doc and an engine verb that exist", () => {
  const engine = engineCode("scripts/conductor.mjs");
  for (const o of OPT_INS) {
    assert.ok(fs.existsSync(path.join(ROOT, "commands", `${o.doc}.md`)), `${o.id}: commands/${o.doc}.md exists`);
    assert.ok(engine.includes(`"${o.verb}"`) || engine.includes(`|${o.verb}|`), `${o.id}: verb ${o.verb} is dispatched`);
  }
});

test("gh#210: upgrade prints the unadopted opt-ins even when there is no changelog delta", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const first = run(["upgrade"], { cwd });
  const second = run(["upgrade"], { cwd });
  for (const out of [first, second]) {
    assert.match(out, /conductor: opt-ins — /);
    assert.match(out, /NOT SET: laneRouting \(0 overrides\)/);
    assert.match(out, /set-lane-routing --add/);
  }
});

test("gh#210: upgrade does not report an opt-in the repo adopted as NOT SET", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-activity-log", "on"], { cwd });
  const out = run(["upgrade"], { cwd });
  assert.match(out, /activityLog: on/);
  assert.doesNotMatch(out, /NOT SET: activityLog/);
});
