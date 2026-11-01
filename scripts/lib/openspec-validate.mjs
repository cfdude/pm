// scripts/lib/openspec-validate.mjs
// "Does the change a Gate 1 verdict is about currently validate?" (gh#243). Two sessions piped
// `openspec validate <id> --strict | tail -1`, which exits 0 whatever validate returned (the pipeline's status
// is tail's) and keeps only a summary line, hiding "a requirement over 500 characters". Gate 1 was then
// recorded against a spec that did not validate. The engine asks the question itself, unpiped, and reads the
// EXIT STATUS, so an agent has no pipeline to invent.
//
// ARCHITECTURAL LAW, restated because this file is the second place in the engine that runs `openspec`.
// pm is an INSTRUCTION layer, never an INTEGRATION layer: it opens no network connection and calls no
// external system. `openspec validate` is a LOCAL, READ-ONLY check of files on disk; it writes nothing. It DOES run
// OpenSpec's preAction hook, which sends telemetry unless disabled, so the spawn sets OPENSPEC_TELEMETRY=0 and
// DO_NOT_TRACK=1 (tool-currency.mjs validateSpawnEnv). The ONLY argv this file passes
// to the `openspec` binary besides `--version` is `validate <change-id> --strict`, and it is spawned from
// tool-currency.mjs, the ONE module that owns the `openspec` spawn allowlist (conductor-35). The source scans in
// scripts/test/assert/tool-currency.test.mjs and scripts/test/functional/tool-currency.test.mjs name exactly
// that. `openspec update`, `archive` and every other mutation stay emitted-as-text for the user to run.
//
// THREE ANSWERS, like tool-currency's version read. `pass` and `fail` are measured; `unknown` is "could not
// tell" (no CLI on PATH, a timeout, a signal, an id that is not safe to hand to argv) and NEVER refuses:
// a guard derived from a check that did not run would be inventing a failure. A reader and a computation
// only; it writes nothing.

import fs from "node:fs";
import path from "node:path";
import { engineRoot, escapeControls } from "./constants.mjs";
import { currentEnv } from "./invocation.mjs";
import { runOpenspecValidate } from "./tool-currency.mjs";

const LIVE_CHANGE = /^openspec\/changes\/(?!archive(?:\/|$))([^/]+)(?:\/.*)?$/;
/** An id safe to hand to argv: no leading `-` (it would read as a flag), no path separator. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALIDATE_TIMEOUT_MS = 60000;
const MAX_OUTPUT_LINES = 25;

const normalize = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/** The distinct LIVE change ids a list of recorded artifact paths names, in first-seen order. A path inside an
 *  archived change, or outside `openspec/changes/`, names none. */
export function liveChangeIdsOf(artifacts) {
  const ids = [];
  for (const a of artifacts || []) {
    const m = LIVE_CHANGE.exec(normalize(a));
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** `{ state: "pass" }`, `{ state: "fail", output }` or `{ state: "unknown" }` for one change.
 *  `PM_OPENSPEC_VALIDATE` is the test seam (`pass`, `unknown`, or `fail:<text>`), the family
 *  `PM_OPENSPEC_VERSION` belongs to. */
export function validateChange(id) {
  const seam = currentEnv().PM_OPENSPEC_VALIDATE;
  if (seam !== undefined) {
    if (seam === "pass") return { state: "pass" };
    if (seam.startsWith("fail:")) return { state: "fail", output: seam.slice(5) };
    return { state: "unknown" };
  }
  if (!SAFE_ID.test(id)) return { state: "unknown" };
  return runOpenspecValidate(id);
}

/** Is there an OpenSpec project here to validate against? Without `openspec/config.yaml` there is nothing for
 *  `validate` to resolve a change in, so the question does not apply (and a bare fixture tree is not refused). */
const hasOpenspecProject = () => fs.existsSync(path.join(engineRoot(), "openspec", "config.yaml"));

/** The refusal text when a Gate 1 PASS names a live change that does not validate, else `null`.
 *  Only the first failing change is reported; the verdict is refused as a whole. Output is control-escaped and
 *  capped, because it is a foreign tool's text echoed into the terminal. */
export function gate1ValidateRefusal(artifacts) {
  const ids = liveChangeIdsOf(artifacts);
  if (!ids.length || !hasOpenspecProject()) return null;
  for (const id of ids) {
    if (!fs.existsSync(path.join(engineRoot(), "openspec", "changes", id))) continue;
    const r = validateChange(id);
    if (r.state !== "fail") continue;
    const lines = String(r.output || "").split("\n").map(l => l.trimEnd()).filter(l => l !== "");
    const shown = lines.slice(0, MAX_OUTPUT_LINES);
    if (lines.length > MAX_OUTPUT_LINES) shown.push("... (more lines omitted)");
    const head = `conductor: a gate 1 'pass' cannot be recorded — \`openspec validate ${escapeControls(id)} --strict\` currently fails ` +
      "(run it yourself, UNPIPED, and read its exit status: a `| tail` reports the pipeline's status and hides the failure). " +
      "Fix the change, then record the review. Nothing was written.";
    return [head, ...shown, ""].map(escapeControls).join("\n");
  }
  return null;
}
