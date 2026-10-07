// scripts/test/assert/hook-machinery.test.mjs
// hook-fixtures-couple-to-every-hook-step — WHAT A HOOK FIXTURE COPIES IS DERIVED, NEVER TYPED.
//
// A fixture that runs the real `.githooks/*` must hold every script those hooks run, and every module
// those scripts reach. Until this epic that set was typed by hand in five places, and each addition of
// the 0.50/0.51 cycle had to be mirrored into them: a new hook STEP (the drift script, 6.4), a new
// IMPORT inside a script the hook runs (`js-lexer.mjs`, certification-record-redesign 3.1), and a new
// hook FILE (`commit-msg`, D4). Each time three unrelated tests went red pointing at the hook.
// `fixtures/hook-machinery.mjs` derives the set from the hooks' own code; this file proves it keeps up
// with all three shapes, over in-memory readers (nothing spawned, no git).

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  HOOKS_DIR, certifyMachinery, hookInvokedScripts, hookMachinery, hookNames, scriptClosure,
} from "../fixtures/hook-machinery.mjs";
import { REPO } from "../certification.mjs";

/** An in-memory repository: `files` maps a repo-relative path to its text; `modes` marks executables. */
function memRepo(files, { executable = [] } = {}) {
  const root = "/mem";
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  return {
    root,
    readFile: (abs) => {
      if (!(rel(abs) in files)) throw Object.assign(new Error(`ENOENT ${abs}`), { code: "ENOENT" });
      return files[rel(abs)];
    },
    exists: (abs) => rel(abs) in files,
    readdir: (abs) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${rel(abs)}/`))
      .map((p) => p.slice(rel(abs).length + 1).split("/")[0]))],
    isExecutable: (abs) => executable.includes(rel(abs)),
  };
}

const BASE = {
  ".githooks/pre-commit": '#!/bin/sh\n# the prose names scripts/test/certify.mjs, which the hook does not run\n' +
    'DRIFT="$SNAP/scripts/test/drift.mjs"\nnode "$DRIFT" --phase pre-commit\n' +
    "node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs\n",
  "scripts/test/drift.mjs": 'import fs from "node:fs";\nimport { a } from "./certification.mjs";\n',
  "scripts/test/certification.mjs": 'import { lex } from "./js-lexer.mjs";\n',
  "scripts/test/js-lexer.mjs": "export const lex = 1;\n",
  "scripts/test/certify.mjs": "",
};
const EXEC = [".githooks/pre-commit"];

test("the base: the hook's step and its import closure, and nothing its prose or globs name", () => {
  const r = memRepo(BASE, { executable: EXEC });
  assert.deepEqual(hookMachinery(r), ["scripts/test/certification.mjs", "scripts/test/drift.mjs", "scripts/test/js-lexer.mjs"]);
});

test("shape 1 — a NEW HOOK STEP running a new script: the fixture's set gains it and what it imports (the 6.4 shape)", () => {
  const files = {
    ...BASE,
    ".githooks/pre-commit": `${BASE[".githooks/pre-commit"]}node "$ROOT/scripts/test/new-step.mjs"\n`,
    "scripts/test/new-step.mjs": 'import "./new-step-dep.mjs";\n',
    "scripts/test/new-step-dep.mjs": "",
  };
  const set = hookMachinery(memRepo(files, { executable: EXEC }));
  assert.ok(set.includes("scripts/test/new-step.mjs"), `the new step's script is derived: ${set}`);
  assert.ok(set.includes("scripts/test/new-step-dep.mjs"), `and the module it imports: ${set}`);
});

test("shape 2 — a NEW IMPORT inside a script the hook already runs: the set gains it (the js-lexer shape)", () => {
  const files = { ...BASE, "scripts/test/js-lexer.mjs": 'export { x } from "./fixtures/lexer-table.mjs";\n', "scripts/test/fixtures/lexer-table.mjs": "" };
  const set = hookMachinery(memRepo(files, { executable: EXEC }));
  assert.ok(set.includes("scripts/test/fixtures/lexer-table.mjs"), `an import two hops down is derived: ${set}`);
});

test("shape 3 — a NEW HOOK FILE: it is installed, and the scripts it runs are derived (the commit-msg shape)", () => {
  const files = { ...BASE, ".githooks/commit-msg": '#!/bin/sh\nnode "$ROOT/scripts/test/coupling.mjs" "$1"\n', "scripts/test/coupling.mjs": "" };
  const r = memRepo(files, { executable: [...EXEC, ".githooks/commit-msg"] });
  assert.deepEqual(hookNames(r), ["commit-msg", "pre-commit"]);
  assert.ok(hookMachinery(r).includes("scripts/test/coupling.mjs"), `the new hook's script is derived: ${hookMachinery(r)}`);
});

test("a commented-out step, a glob and a non-executable file in .githooks/ are not machinery", () => {
  const files = {
    ...BASE,
    ".githooks/pre-commit": `${BASE[".githooks/pre-commit"]}  # node scripts/test/retired.mjs\n`,
    "scripts/test/retired.mjs": "",
    ".githooks/.DS_Store": "node scripts/test/stray.mjs\n",
    "scripts/test/stray.mjs": "",
  };
  const r = memRepo(files, { executable: EXEC });
  assert.deepEqual(hookNames(r), ["pre-commit"], "a non-executable file is not a hook git would run");
  const set = hookMachinery(r);
  for (const not of ["scripts/test/retired.mjs", "scripts/test/stray.mjs", "scripts/test/certify.mjs"]) {
    assert.ok(!set.includes(not), `${not} is not machinery: ${set}`);
  }
});

test("hookInvokedScripts: a path after a variable prefix counts; a # inside a word does not start a comment", () => {
  assert.deepEqual(hookInvokedScripts('X="$SNAP/scripts/a.mjs"\necho a#b scripts/b.mjs # scripts/c.mjs\n'), ["scripts/a.mjs", "scripts/b.mjs"]);
});

test("scriptClosure follows a repo-relative path a script spells in CODE (certify reaching OBSERVER), not one in a comment", () => {
  const files = {
    "scripts/test/certify.mjs": 'import { OBSERVER } from "./certification.mjs";\n',
    "scripts/test/certification.mjs": 'export const OBSERVER = "scripts/test/fixtures/observe-reads.mjs";\n// "scripts/test/fixtures/commented.mjs"\n',
    "scripts/test/fixtures/observe-reads.mjs": "",
    "scripts/test/fixtures/commented.mjs": "",
  };
  const set = scriptClosure(["scripts/test/certify.mjs"], memRepo(files));
  assert.deepEqual(set, ["scripts/test/certification.mjs", "scripts/test/certify.mjs", "scripts/test/fixtures/observe-reads.mjs"]);
});

test("scriptClosure refuses a root that does not exist — a hook naming a missing script is a gap, named", () => {
  assert.throws(() => hookMachinery(memRepo({ ".githooks/pre-commit": 'node "$R/scripts/test/gone.mjs"\n' }, { executable: EXEC })),
    /scripts\/test\/gone\.mjs/);
});

test("over THIS repository: every hook is installed, and the derived sets hold what the hooks and certify really need", () => {
  const onDisk = fs.readdirSync(path.join(REPO, HOOKS_DIR)).filter((n) => (fs.statSync(path.join(REPO, HOOKS_DIR, n)).mode & 0o111) !== 0).sort();
  assert.deepEqual(hookNames(), onDisk);
  const hook = hookMachinery();
  for (const need of ["scripts/test/drift.mjs", "scripts/test/certification.mjs", "scripts/test/js-lexer.mjs"]) {
    assert.ok(hook.includes(need), `hookMachinery() holds ${need}: ${hook}`);
  }
  const cert = certifyMachinery();
  for (const need of ["scripts/test/certify.mjs", "scripts/test/fixtures/observe-reads.mjs", "scripts/test/fixtures/temp-dir.mjs", ...hook]) {
    assert.ok(cert.includes(need), `certifyMachinery() holds ${need}: ${cert}`);
  }
  for (const p of [...hook, ...cert]) assert.ok(fs.existsSync(path.join(REPO, p)), `${p} exists`);
});
