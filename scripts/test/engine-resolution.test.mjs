// scripts/test/engine-resolution.test.mjs
// gh-139: no shipped instruction surface may resolve the engine from the PROJECT directory.
//
// Fourteen shipped docs used to open their engine-resolution snippet with
//
//   ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"
//
// tried FIRST and tested only with `-f`. Any project that happens to carry a file at
// `scripts/conductor.mjs` therefore got that file executed by `node` the moment a user typed a
// `/pm:*` command — no check that the project is pm, and nothing the project could not itself
// write. That arm was added for ONE audience (see 9e83963: "when the repo being worked on IS
// the pm plugin source"), and #134 now serves that audience through the environment instead:
// `PM_ENGINE_DELEGATION=<abs path>`, honoured at the top of conductor.mjs before dispatch, so
// it covers every entry point including the slash commands. The arm's beneficiary population is
// empty, so it was deleted rather than gated.
//
// This gate exists because the deletion is spread across fourteen hand-maintained copies and
// nothing else would notice a fifteenth being written. It walks EVERY shipped instruction
// surface — commands/, skills/, agents/, hooks/, .claude-plugin/ — not only the two directories
// the issue happened to name; a guard that covers the sites in one diff and not their identical
// siblings is this repository's dominant defect class, and it would be absurd to reproduce it
// in the guard against it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every directory whose contents ship to users as instructions an agent will act on. */
export const INSTRUCTION_ROOTS = ["commands", "skills", "agents", "hooks", ".claude-plugin"];

/** Patterns that mean "resolve the engine out of the project directory".
 *
 *  Deliberately NOT a bare `CLAUDE_PROJECT_DIR` match: the variable has legitimate mentions in
 *  prose (the engine banner is suppressed when it is set; a worktree caveat turns on which tree
 *  it names) and in `scripts/lib/constants.mjs`, which is not an instruction surface at all.
 *  What is banned is the variable being turned INTO AN ENGINE PATH. */
const BANNED = [
  // `${CLAUDE_PROJECT_DIR:+...}` — the parameter expansion the deleted arm used.
  /\bCLAUDE_PROJECT_DIR:\+/,
  // `$CLAUDE_PROJECT_DIR/scripts/conductor.mjs`, `${CLAUDE_PROJECT_DIR}/scripts/...`, quoted
  // or not — the same idea hand-rolled.
  /\bCLAUDE_PROJECT_DIR["'}]*\/scripts\/conductor\.mjs/,
];

/** Recursively collect files under `dir` (absolute paths). Missing dir → []. */
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (e.isFile()) out.push(abs);
  }
  return out;
}

/** Every `<file>:<line>` in the shipped instruction surfaces that resolves the engine from the
 *  project directory. Exported so the mutation test below drives the same function CI runs. */
export function projectDirEngineResolutions(repo = REPO) {
  const hits = [];
  for (const root of INSTRUCTION_ROOTS) {
    for (const abs of walk(path.join(repo, root))) {
      let text;
      try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
      text.split("\n").forEach((line, i) => {
        if (BANNED.some(re => re.test(line))) {
          hits.push(`${path.relative(repo, abs)}:${i + 1}`);
        }
      });
    }
  }
  return hits;
}

test("gh-139: no shipped command, skill, agent, hook or manifest resolves the engine from $CLAUDE_PROJECT_DIR", () => {
  assert.deepEqual(
    projectDirEngineResolutions(),
    [],
    "A shipped instruction surface resolves scripts/conductor.mjs out of the project directory. " +
    "That executes project-supplied code on a `-f` test alone. Developing pm uses " +
    "PM_ENGINE_DELEGATION (see CONTRIBUTING.md), not a path the project can write."
  );
});

test("gh-139: the guard actually detects the pattern it bans (mutation)", () => {
  // Both shapes of the defect, written into a throwaway tree the gate then walks. Without this
  // the assertion above is indistinguishable from a regex that matches nothing.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pm-gh139-"));
  fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "commands", "status.md"),
    'ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"\n'
  );
  fs.writeFileSync(
    path.join(dir, "hooks", "hooks.json"),
    '{"command": "node \\"${CLAUDE_PROJECT_DIR}/scripts/conductor.mjs\\" render"}\n'
  );
  assert.deepEqual(projectDirEngineResolutions(dir), [
    "commands/status.md:1",
    "hooks/hooks.json:1",
  ]);
});

test("gh-139: the guard does not trip on the legitimate prose mentions of CLAUDE_PROJECT_DIR", () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pm-gh139-"));
  fs.mkdirSync(path.join(dir, "skills", "conductor"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "skills", "conductor", "SKILL.md"),
    "The banner is suppressed whenever `$CLAUDE_PROJECT_DIR` is set (a self-hosting context).\n" +
    "With delegation set, `$CLAUDE_PROJECT_DIR` pointing at the main checkout decides.\n"
  );
  assert.deepEqual(projectDirEngineResolutions(dir), []);
});
