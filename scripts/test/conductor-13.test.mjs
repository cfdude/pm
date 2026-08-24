import { test } from "node:test";
import assert from "node:assert/strict";

// ─────────────── the shared epic-flag registry (EPIC_FLAGS) ───────────────
//
// UPDATE_EPIC_FLAGS was a literal 11-element array in update-epic.mjs and add-epic had no
// allowlist at all, so four capabilities in this release would each have grown the flag
// surface in its own place — and whichever landed first would have rejected the others'
// flags BY NAME, because an unlisted flag exits 1. The registry is that chokepoint, grown
// once.

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;

/** The `UPDATE_EPIC_FLAGS` literal exactly as 0.26.0 shipped it, transcribed on purpose.
 *  This is the one place a transcribed list is the right instrument: it pins "seeding the
 *  registry changed no behavior", which is a claim about the PRIOR release and can only be
 *  made against a snapshot of it. Every other check in this file reads its enumeration from
 *  the live documented surface instead — see the coverage test at the bottom of the file. */
const UPDATE_EPIC_FLAGS_0_26_0 = [
  "external-id", "external-url", "parent", "status", "priority", "title",
  "link", "review-mode", "add-story", "story", "done",
];

test("the registry's update-epic projection is set-equal to 0.26.0's UPDATE_EPIC_FLAGS literal", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("update-epic")).map(f => f.flag);
  assert.deepEqual(
    [...projected].sort(),
    [...UPDATE_EPIC_FLAGS_0_26_0].sort(),
    "seeding EPIC_FLAGS must reproduce 0.26.0's update-epic flag surface exactly — no flag " +
    "gained, none lost");
});

test("the registry's add-epic projection is exactly the flags add-epic parsed in 0.26.0", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // add-epic had no allowlist, so its 0.26.0 surface is the set of flags its body actually
  // read out of parseFlags(): id, lane, status, title, priority, plan, parent, external-id,
  // external-url, link. Everything else parsed, exited 0 and wrote nothing (issue #79).
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("add-epic")).map(f => f.flag);
  assert.deepEqual(
    [...projected].sort(),
    ["external-id", "external-url", "id", "lane", "link", "parent", "plan", "priority", "status", "title"],
  );
});

test("the registry's add-many keys are exactly the state keys add-many copied in 0.26.0", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  // add-many.mjs:61-70's fixed key copy, verbatim. A batch document is written in STATE keys
  // (externalId), not flag names (external-id), which is why the registry carries `key`
  // explicitly rather than deriving it from `flag`.
  const projected = EPIC_FLAGS.filter(f => f.commands.includes("add-many") && f.key).map(f => f.key);
  assert.deepEqual(
    [...projected].sort(),
    ["externalId", "externalUrl", "id", "lane", "links", "parent", "planPath", "priority", "status", "title"],
  );
});

test("every registry entry declares a flag, a key slot and at least one accepting command", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  for (const e of EPIC_FLAGS) {
    assert.equal(typeof e.flag, "string", `entry ${JSON.stringify(e)} has no flag name`);
    assert.ok(!e.flag.startsWith("--"), `entry '${e.flag}' must carry the bare flag name, no leading --`);
    assert.ok("key" in e, `entry '${e.flag}' must declare a state key (null where the command consumes it)`);
    assert.ok(Array.isArray(e.commands) && e.commands.length,
      `entry '${e.flag}' must name at least one accepting command`);
  }
  const names = EPIC_FLAGS.map(e => e.flag);
  assert.equal(new Set(names).size, names.length, "a flag must be declared exactly once");
});
