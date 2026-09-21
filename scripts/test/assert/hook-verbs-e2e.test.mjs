// scripts/test/assert/hook-verbs-e2e.test.mjs
// 5.5's ASSERTION TWIN of scripts/test/functional/hook-verbs-e2e.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the six registrations in hooks/hooks.json run AS THE PROCESSES
// THEY REGISTER, through the real binary. The half of that which needs no process boundary is what
// this file carries: the registration set read off the same file, the argv parsed out of the same
// command strings, and the engine's answer for each of those argv driven IN PROCESS through the
// invocation entry point. So the fast half learns everything about the registrations except the one
// thing that is the boundary itself.
//
// NOTHING HERE SPAWNS AND NOTHING HERE RUNS GIT — that is the assertion half's property (5.2's own
// guard walks this directory and would fail this file if either changed). A registration's argv is
// parsed out of the command string and handed to the entry point; the command string is never
// executed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invokeEngine, run, tmpRepo } from "../fixtures/assert-harness.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOOKS_JSON = path.join(PLUGIN_ROOT, "hooks", "hooks.json");

/** The same derivation the functional file makes: every command hooks.json registers, with the event
 *  that reaches it and `${CLAUDE_PLUGIN_ROOT}` substituted. Re-declared rather than shared — importing
 *  the functional file would register ITS tests inside this half and pull a spawner into it. */
function registrations() {
  const doc = JSON.parse(fs.readFileSync(HOOKS_JSON, "utf8"));
  const out = [];
  for (const [event, groups] of Object.entries(doc.hooks)) {
    for (const group of groups) {
      for (const entry of group.hooks || []) {
        out.push({
          event,
          matcher: group.matcher,
          command: entry.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PLUGIN_ROOT),
        });
      }
    }
  }
  return out;
}

/** The ARGV a registration would run, read out of its command string rather than re-spelled. The
 *  command is `node "<abs>/conductor.mjs" <verb> <flags…>`, so everything after the script path is
 *  the argument list the engine sees — the same list the functional file's process route is handed.
 *  This is the part of the functional file's subject that survives without a process boundary. */
function argvOf(command) {
  const m = /conductor\.mjs"?\s+([\s\S]+)$/.exec(command);
  assert.ok(m, `hooks.json's command no longer names the engine: ${command}`);
  return m[1].trim().split(/\s+/);
}

const PAYLOAD_FOR = {
  SessionStart: { hook_event_name: "SessionStart" },
  PreCompact: { hook_event_name: "PreCompact" },
  PostToolUse: { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git status" } },
  PostToolUseFailure: { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" } },
  PreToolUse: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/x.js" } },
};

function pmRepo() {
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });
  return cwd;
}

test("hook verbs: the registration set is six commands over five verbs, each running the binary directly", () => {
  const regs = registrations();
  assert.equal(regs.length, 6, "hooks.json registers six commands (commit-nudge twice)");
  const argv = regs.map((r) => argvOf(r.command));
  assert.deepEqual([...new Set(argv.map((a) => a[0]))].sort(),
    ["brief", "commit-nudge", "gate-guard", "lesson-advice", "snapshot"], "the five hook verbs");
  for (const a of argv) {
    assert.equal(a[1], "--platform", `every hook verb is passed --platform as hooks.json passes it: ${a.join(" ")}`);
    assert.equal(a[2], "claude-code");
    assert.equal(a.length, 3, "and nothing else — a flag added to a registration is a flag the engine must declare");
  }
});

test("hook verbs: every registration's argv is accepted in-process, and answers 0", () => {
  const cwd = pmRepo();
  for (const reg of registrations()) {
    const r = invokeEngine(argvOf(reg.command), { cwd, input: JSON.stringify(PAYLOAD_FOR[reg.event]) });
    assert.equal(r.status, 0, `${reg.event} (${reg.matcher}) answered ${r.status}\n${r.stderr}`);
  }
});

test("hook verbs: the blocking status comes from the same argv in process — gate-guard's 2, commit-nudge's 2", () => {
  // The safety case reachable without a process boundary: the argv parsed out of the registration,
  // driven in process, in the state the block exists for.
  const cwd = pmRepo();
  for (const id of ["p", "d"]) run(["add-epic", "--id", id, "--lane", "claude-code", "--title", id], { cwd });
  run(["set-active", "p"], { cwd });
  run(["push-detour", "p", "--detour", "d", "--reason", "it touched shared code", "--reconcile"], { cwd });
  run(["pop-detour", "p"], { cwd });

  const gate = registrations().find((r) => /conductor\.mjs"?\s+gate-guard/.test(r.command));
  const r = invokeEngine(argvOf(gate.command), { cwd, input: JSON.stringify(PAYLOAD_FOR.PreToolUse) });
  assert.equal(r.status, 2, `gate-guard must block while a reconcile is owed; got ${r.status}\n${r.stderr}`);

  // commit-nudge's 2, in a conflicted repository: visible to the agent, blocking nothing.
  const conflicted = pmRepo();
  const statePath = path.join(conflicted, ".conductor", "state.json");
  fs.writeFileSync(statePath, "<<<<<<< HEAD\n" + fs.readFileSync(statePath, "utf8"));
  for (const reg of registrations().filter((x) => /conductor\.mjs"?\s+commit-nudge/.test(x.command))) {
    const n = invokeEngine(argvOf(reg.command), { cwd: conflicted, input: JSON.stringify(PAYLOAD_FOR[reg.event]) });
    assert.equal(n.status, 2, `${reg.event}'s registration answered ${n.status}; the documented status is 2`);
  }
});

test("hook verbs: brief's refusal is status 0 with the warning on the CALLER's stdout, not the process's", () => {
  const cwd = pmRepo();
  const statePath = path.join(cwd, ".conductor", "state.json");
  fs.writeFileSync(statePath, "<<<<<<< HEAD\n" + fs.readFileSync(statePath, "utf8"));
  const brief = registrations().find((r) => /conductor\.mjs"?\s+brief/.test(r.command));
  const r = invokeEngine(argvOf(brief.command), { cwd, input: JSON.stringify(PAYLOAD_FOR.SessionStart) });
  assert.equal(r.status, 0, "a SessionStart refusal reports rather than fails");
  assert.match(r.stdout, /\S/, "and the payload the harness renders arrives on the caller's stdout");
});

// ───────────────────────────── what this twin deliberately does NOT carry ─────────────────────────────
//
// THE PROCESS BOUNDARY. Nothing here spawns, so this file cannot observe the real binary's exit
// status, its real argv string, or `sh -c` resolving the command string as hooks.json writes it —
// which is the whole point of the functional file and the reason it exists. It also does not carry
// `signal`, `timeout`, or the case where the command string stops being runnable as written.
