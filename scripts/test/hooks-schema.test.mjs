// scripts/test/hooks-schema.test.mjs
// THE guard behind "pm's hooks.json validates clean against Claude Code's own schema".
//
// pm shipped `"comment"` keys beside `matcher` and `hooks` in every matcher group. The harness
// validates that object against a closed schema, so it printed
//
//   pm: hooks.json: unknown keys "comment" in hooks.SessionStart[0], … ignored
//
// at the TOP OF EVERY SESSION, in EVERY repository with the plugin installed — 27 of them on the
// development machine when this was found. The hooks themselves kept working, which is precisely
// why it survived: nothing was broken, so nothing prompted, and the only cost was a warning every
// user read past every day.
//
// The rationale those comments carried was real and is now in hooks/README.md. This test is what
// stops someone putting it back into the JSON to keep it co-located.
//
// The check is a CLOSED set, not a blocklist of "comment": an allowlist fails on the next unknown
// key somebody invents, where a blocklist would only ever catch the one mistake already made.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HOOKS = new URL("../../hooks/hooks.json", import.meta.url).pathname;
const README = new URL("../../hooks/README.md", import.meta.url).pathname;

/** Exactly what Claude Code's hook schema accepts, at each level. */
const GROUP_KEYS = new Set(["matcher", "hooks"]);
const ENTRY_KEYS = new Set(["type", "command", "timeout"]);

const doc = JSON.parse(fs.readFileSync(HOOKS, "utf8"));

test("hooks.json has no key outside the harness's schema — an unknown key warns in EVERY session", () => {
  assert.deepEqual(Object.keys(doc), ["hooks"], "the only top-level key is `hooks`");

  const offenders = [];
  for (const [event, groups] of Object.entries(doc.hooks)) {
    groups.forEach((group, i) => {
      for (const k of Object.keys(group)) {
        if (!GROUP_KEYS.has(k)) offenders.push(`"${k}" in hooks.${event}[${i}]`);
      }
      (group.hooks || []).forEach((entry, j) => {
        for (const k of Object.keys(entry)) {
          if (!ENTRY_KEYS.has(k)) offenders.push(`"${k}" in hooks.${event}[${i}].hooks[${j}]`);
        }
      });
    });
  }

  assert.deepEqual(offenders, [],
    "Claude Code reports these at the top of EVERY session in EVERY repo with pm installed. " +
    "If the key was documentation, it belongs in hooks/README.md — see that file's opening " +
    "paragraph for why.");
});

test("the scan reaches real groups — an empty walk would pass this file vacuously", () => {
  const groups = Object.values(doc.hooks).flat();
  assert.ok(groups.length >= 4, `expected at least 4 matcher groups, walked ${groups.length}`);
  assert.ok(groups.every(g => typeof g.matcher === "string" && g.matcher.length > 0),
    "every group declares a non-empty matcher");
  assert.ok(groups.flatMap(g => g.hooks || []).length >= 4, "every group carries at least one command");
});

/** The engine verb a matcher group's first hook runs — `gate-guard`, `lesson-advice`, `brief`… This
 *  is what the README assertion is KEYED ON, and the reason is a real vacuity: the assertion used to
 *  key on `` `<event>` — matcher `<matcher>` `` alone, and the moment the gate guard's matcher
 *  widened to the lesson advisor's, both PreToolUse groups produced the SAME heading string. One
 *  section then satisfied both iterations, so deleting the gate-guard section still passed — the
 *  check went vacuous at exactly the commit that made it matter. The verb differs per entry and is
 *  derived from hooks.json rather than typed. */
function verbOf(group) {
  const command = String(((group.hooks || [])[0] || {}).command || "");
  const m = /conductor\.mjs"?\s+([a-z][a-z-]*)/.exec(command);
  return m ? m[1] : null;
}

/** Every matcher group whose section the README does not carry, as `<event>/<verb>` strings. A
 *  function, not an inline loop, so the guard itself can be MUTATED and watched to fail. */
export function undocumentedGroups(readme, hooks) {
  const missing = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      const verb = verbOf(group);
      const heading = `\`${event}\` — matcher \`${group.matcher}\``;
      const found = readme.split("\n").some(line => line.includes(heading) && verb && line.includes(`(${verb})`));
      if (!found) missing.push(`${event}/${verb || "?"}`);
    }
  }
  return missing;
}

test("every hook's rationale survived the move — README documents each event, matcher and verb", () => {
  const readme = fs.readFileSync(README, "utf8");
  assert.deepEqual(undocumentedGroups(readme, doc.hooks), [],
    "hooks/README.md must document each group as `<event>` — matcher `<matcher>` (<verb>) — the " +
    "comments were moved out of hooks.json, and a hook whose reasoning is nowhere is a hook " +
    "someone deletes. The verb is in the key because two PreToolUse groups now share one matcher");
});

test("the README assertion is not vacuous — deleting a section fails it", () => {
  // The guard proves the half it asserts, not the half it is named for. Mutate the thing it claims
  // to protect and watch it fail: with the gate-guard section cut out of a COPY of the README, the
  // check must name it. Under the old matcher-only key this mutation passed.
  const readme = fs.readFileSync(README, "utf8");
  const start = readme.indexOf("## `PreToolUse`");
  assert.notEqual(start, -1, "the README carries a PreToolUse section to cut");
  const next = readme.indexOf("\n## ", start + 1);
  const mutated = readme.slice(0, start) + (next === -1 ? "" : readme.slice(next + 1));
  const missing = undocumentedGroups(mutated, doc.hooks);
  assert.ok(missing.length > 0,
    "removing a PreToolUse section from the README must be detected; the assertion reported nothing");
  assert.ok(missing.some(m => m.startsWith("PreToolUse/")), `expected a PreToolUse group, got ${missing}`);
});
