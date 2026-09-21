// scripts/test/functional/hook-verbs-e2e.test.mjs
// 5.5 — THE FIVE HOOK VERBS' END-TO-END INVOCATIONS (design D5's middle row).
//
// WHAT THIS FILE IS. The engine ships as a single file a hook runs DIRECTLY, and engine-invocation's
// last requirement is that this does not change: "the same verbs, the same accepted and refused
// command lines, the same exit statuses … nothing in the invocation requires a caller other than the
// process itself". The conformance set proves the STATUS EQUALITY between the two routes; this file
// proves the REGISTRATIONS — the six commands `hooks/hooks.json` actually carries, spelled exactly as
// the plugin's own hook configuration spells them, run as the process they register, through the real
// binary.
//
// WHY IT IS IN THE FUNCTIONAL HALF, AND WHY IT STILL SPAWNS. D5's placement rule is by SUBJECT, not
// by speed or by whether git is involved: "the functional half is the half that runs on a trigger and
// MAY spawn, so a real-spawn test belongs there whether or not git is its subject". This file runs no
// git — it is one of the two named cases (the conformance set is the other) of a functional-half file
// that needs a real process boundary. It therefore carries an assertion twin of the same id like any
// other functional id (5.4).
//
// THE COMMAND STRING IS NOT RE-SPELLED. It is read out of hooks/hooks.json and `${CLAUDE_PLUGIN_ROOT}`
// is substituted, so a command that stops being runnable as written — a flag renamed, a verb
// unregistered, the binary moved — fails HERE rather than at the top of a user's session, where
// nothing prompts and nobody looks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, tmpRepo } from "../fixtures/functional-harness.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOOKS_JSON = path.join(PLUGIN_ROOT, "hooks", "hooks.json");

// ───────────────────────────── the registrations, read from the plugin's own config ─────────────────────────────

/** Every command hooks.json registers, with the event and matcher that reach it. `$CLAUDE_PLUGIN_ROOT`
 *  is substituted the way Claude Code substitutes it. */
export function registrations() {
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

/** The payload each event's hook receives, from the harness's own event vocabulary. The engine reads
 *  `hook_event_name` to decide whether it is dormant, so a payload with the wrong event name would
 *  test the dormancy branch rather than the registration. */
const PAYLOAD_FOR = {
  SessionStart: { hook_event_name: "SessionStart" },
  PreCompact: { hook_event_name: "PreCompact" },
  PostToolUse: { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git status" } },
  PostToolUseFailure: { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" } },
  PreToolUse: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/x.js" } },
};

/** Run one registration AS THE PROCESS IT REGISTERS. `sh -c` rather than a split of the string: the
 *  command in hooks.json is a shell command, quoting and all, and splitting it here would be
 *  re-spelling the very thing this file exists to run as written. */
function runRegistration(reg, cwd, input) {
  const r = spawnSync("sh", ["-c", reg.command], {
    cwd, input: JSON.stringify(input ?? PAYLOAD_FOR[reg.event] ?? { hook_event_name: reg.event }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", signal: r.signal };
}

/** An initialized conductor repo — what a hook sees in a repository that uses pm. */
function pmRepo() {
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });
  return cwd;
}

// ───────────────────────────── the registrations themselves ─────────────────────────────

test("hook verbs: every command hooks.json registers is a real invocation of the shipped binary", () => {
  const regs = registrations();
  // SIX registrations over FIVE verbs (D5): commit-nudge is registered twice, for PostToolUse and
  // PostToolUseFailure. The count is asserted rather than described, because a registration lost to
  // an edit is a hook that silently stops firing.
  assert.equal(regs.length, 6, `hooks.json registers ${regs.length} commands; D5's table says six over five verbs`);
  const verbs = new Set(regs.map((r) => /conductor\.mjs"?\s+(\S+)/.exec(r.command)?.[1]).filter(Boolean));
  assert.deepEqual([...verbs].sort(), ["brief", "commit-nudge", "gate-guard", "lesson-advice", "snapshot"],
    "the five hook verbs");
  for (const r of regs) {
    assert.ok(r.command.includes(path.join(PLUGIN_ROOT, "scripts", "conductor.mjs")),
      `every registration runs the binary directly, with no wrapper: ${r.command}`);
  }
});

test("hook verbs: each registration exits 0 through the real binary in a pm repository", () => {
  // The healthy path, one real process per registration — the six the plugin ships. A registration
  // that stopped being runnable as written is a hook that fails at the top of a user's session.
  const cwd = pmRepo();
  for (const reg of registrations()) {
    const r = runRegistration(reg, cwd);
    assert.equal(r.status, 0,
      `${reg.event} (${reg.matcher}) exited ${r.status} (signal ${r.signal})\ncommand: ${reg.command}\n` +
      `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  }
});

test("hook verbs: the blocking status a hook RELIES on still comes out of the real registration", () => {
  // THE SAFETY CASE, and the reason 5.5 is not merely a smoke test. `gate-guard` exiting 2 is what
  // BLOCKS a tool call; an engine that stopped exiting 2 would not fail a test, it would stop
  // guarding. Driven through the registration's own command string, in a repository that owes a
  // reconcile, which is the state the block exists for.
  const cwd = pmRepo();
  for (const id of ["p", "d"]) {
    run(["add-epic", "--id", id, "--lane", "claude-code", "--title", id], { cwd });
  }
  run(["set-active", "p"], { cwd });
  run(["push-detour", "p", "--detour", "d", "--reason", "it touched shared code", "--reconcile"], { cwd });
  run(["pop-detour", "p"], { cwd });

  const gate = registrations().find((r) => /conductor\.mjs"?\s+gate-guard/.test(r.command));
  assert.ok(gate, "hooks.json still registers gate-guard");
  const r = runRegistration(gate, cwd);
  assert.equal(r.status, 2, `gate-guard must exit 2 while an epic owes its reconcile; got ${r.status}\n${r.stderr}`);

  // And the documented NON-blocking two: commit-nudge exits 2 to be VISIBLE to the agent and blocks
  // nothing, so its registration must also produce 2 in a state it refuses over. A registration that
  // exited 0 here would be a nudge that never arrives.
  const conflicted = pmRepo();
  const statePath = path.join(conflicted, ".conductor", "state.json");
  fs.writeFileSync(statePath, "<<<<<<< HEAD\n" + fs.readFileSync(statePath, "utf8"));
  for (const reg of registrations().filter((x) => /conductor\.mjs"?\s+commit-nudge/.test(x.command))) {
    const nudge = runRegistration(reg, conflicted);
    assert.equal(nudge.status, 2,
      `${reg.event}'s commit-nudge registration exited ${nudge.status}; the documented status for an ` +
      `unreadable state file is 2 (visible to the agent, blocking nothing)\n${nudge.stderr}`);
  }
});

test("hook verbs: a SessionStart refusal still exits 0 and reports on STDOUT, as the harness reads it", () => {
  // `brief`'s status is 0 even when it refuses, because a non-zero SessionStart hook shows its STDERR
  // to the human only — the warning has to arrive as the additionalContext payload on stdout. Asserted
  // through the registration rather than through the verb, because it is the REGISTRATION the harness
  // reads.
  const cwd = pmRepo();
  const statePath = path.join(cwd, ".conductor", "state.json");
  fs.writeFileSync(statePath, "<<<<<<< HEAD\n" + fs.readFileSync(statePath, "utf8"));
  const brief = registrations().find((r) => /conductor\.mjs"?\s+brief/.test(r.command));
  const r = runRegistration(brief, cwd);
  assert.equal(r.status, 0, `brief must exit 0 on an unreadable state file; got ${r.status}\n${r.stderr}`);
  assert.match(r.stdout, /\S/, "and its warning is the stdout payload the SessionStart hook renders");
});

// ───────────────────────────── what this file deliberately does NOT carry ─────────────────────────────
//
// The status EQUALITY between the process route and the in-process route — the same invocation, both
// ways, asserted equal for every refusal class — is the CONFORMANCE SET's subject, not this file's
// (design D10, `scripts/test/functional/conformance.test.mjs`). This file asserts only the half a
// conformance row cannot reach: that the strings hooks/hooks.json actually ships are runnable as the
// process they register, and that the statuses the hook harness depends on come out of THEM.
// The assertion twin, `scripts/test/assert/hook-verbs-e2e.test.mjs`, carries the behaviour that needs
// no process boundary: the registration set read off the same file, the argv parsed out of it, and
// the engine's in-process answer for each.
