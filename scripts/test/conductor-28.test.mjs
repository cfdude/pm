import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, ENGINE, EMPTY_CACHE } from "./helpers.mjs";
import { GATE_PROCEDURE_ITEMS } from "../lib/rules.mjs";

// gh-127 + gh-132: two practices invented in this repo that never reached the product.
//
// #127 — the dogfooding rule lived only in `.claude/skills/` and in this repo's CLAUDE.md.
// #132 — the lessons practice lived only in `.claude/skills/` plus a `.claude/hooks/` script
//        wired by `.claude/settings.json`, so the one mode that works without recall — a
//        PreToolUse advisor firing on the SITUATION — reached exactly one repository.
//
// Both follow gh-126's precedent exactly: the skill moves into `skills/` (shipped, claimed in
// the parity ledger), the rule joins the emitted gate procedure as a NUMBERED REQUIRED TASK
// ITEM (14/14 adoption, against 3/15 for the same rule as a prose bullet), and the `.claude/`
// copy is reduced to a stub so repo practice and product cannot drift apart.

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shipped = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** Spawn the engine and return {status, stdout, stderr} — the advisor's EXIT CODE is part of
 *  its contract (it advises, it never blocks), so this cannot go through run()/execFileSync. */
function engine(args, { cwd, input = "" } = {}) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    encoding: "utf8",
    input,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** An initialized repo. */
function initRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}

/** Write a lesson file with the given frontmatter fields. */
function lesson(cwd, slug, fields) {
  const dir = path.join(cwd, "docs", "lessons");
  fs.mkdirSync(dir, { recursive: true });
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  fs.writeFileSync(path.join(dir, `${slug}.md`), `---\n${fm}\n---\n\nBody.\n`);
}

/** The advisor's additionalContext, or "" when it stayed silent. */
function advice(cwd, event) {
  const r = engine(["lesson-advice"], { cwd, input: JSON.stringify(event) });
  assert.equal(r.status, 0,
    `the advisor ADVISES and never blocks — a non-zero exit would make it a gate\n${r.stderr}`);
  if (!r.stdout.trim()) return "";
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

const EDIT_CLAUDE_MD = {
  detect: '{"tool":"Edit","pathEndsWith":"CLAUDE.md"}',
  rule: "Hand-written content goes BELOW the END marker, never inside the managed block.",
  trigger: "About to hand-edit a file that a tool also generates.",
};

// ─────────────────── 28.1: the advisor fires on the situation ───────────────────

test("28.1 a lesson whose detect matcher matches the pending tool call is surfaced", () => {
  const cwd = initRepo();
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  const out = advice(cwd, { tool_name: "Edit", tool_input: { file_path: "/x/CLAUDE.md" } });
  assert.match(out, /BELOW the END marker/, "the rule is what gets injected");
  assert.match(out, /editing-inside-a-generated-block\.md/,
    "the advice names the lesson file so the agent can read the cause");
});

test("28.1 the tool filter is honoured — a different tool is silence, not a hit", () => {
  const cwd = initRepo();
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  // Same path, different tool. A matcher that ignored `tool` would fire here, and a hook that
  // fires when it should not is the failure mode #91/#104 are open about: a warning wrong 7
  // times in 8 trains people to ignore the one time it is right.
  assert.equal(advice(cwd, { tool_name: "Read", tool_input: { file_path: "/x/CLAUDE.md" } }), "");
});

test("28.1 the path filter is honoured — a different path is silence", () => {
  const cwd = initRepo();
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  assert.equal(advice(cwd, { tool_name: "Edit", tool_input: { file_path: "/tmp/x.mjs" } }), "");
});

test("28.1 commandMatches fires on a Bash command, and commandLacks suppresses the safe form", () => {
  const cwd = initRepo();
  lesson(cwd, "git-commit-takes-the-whole-index", {
    detect: '{"tool":"Bash","commandMatches":"^git commit","commandLacks":"--\\\\s"}',
    rule: "Never run a bare `git commit` while another process may be staging.",
  });
  assert.match(advice(cwd, { tool_name: "Bash", tool_input: { command: "git commit -m 'x'" } }),
    /bare `git commit`/);
  // commandLacks is the suppression half: the explicit-pathspec form is the safe one.
  assert.equal(advice(cwd, { tool_name: "Bash", tool_input: { command: "git commit -- a.mjs" } }), "");
});

// ─────────────────── 28.2: precision — the constraint, not the feature ───────────────────

test("28.2 only the command's FIRST LINE is matched — a heredoc body is data, not a command", () => {
  const cwd = initRepo();
  // UNANCHORED on purpose. An anchored `^git commit` cannot tell the two implementations apart
  // — without the `m` flag, `^` means start-of-string either way — so the anchored form proves
  // nothing here, and a repo author writing a plain substring matcher is the realistic case.
  lesson(cwd, "git-commit-takes-the-whole-index", {
    detect: '{"tool":"Bash","commandMatches":"git commit"}',
    rule: "Never run a bare `git commit` while another process may be staging.",
  });
  // Positive control: the same matcher must still fire on the command actually being run, or
  // this test would pass against an advisor that matched nothing at all.
  assert.match(advice(cwd, { tool_name: "Bash", tool_input: { command: "git commit -m 'x'" } }),
    /bare `git commit`/);
  // Observed live in this repo: writing a lesson whose own text named a git command fired that
  // lesson's own matcher, twice. The command being RUN is line one; everything after is data.
  const heredoc = "cat > /tmp/note.md <<'EOF'\ngit commit is the thing this note is about\nEOF";
  assert.equal(advice(cwd, { tool_name: "Bash", tool_input: { command: heredoc } }), "",
    "a matched phrase inside a heredoc body must not fire the matcher");
});

test("28.2 a lesson with no detect: matcher is retrieval-only and never fires", () => {
  const cwd = initRepo();
  lesson(cwd, "a-guard-can-check-the-wrong-half", {
    trigger: "About to rely on an existing test as proof a behaviour holds.",
    rule: "Neuter the behaviour and watch THAT test fail before trusting it.",
  });
  // The honest outcome for a lesson that cannot be matched with near-certainty — NOT a gap to
  // close by loosening a regex.
  assert.equal(advice(cwd, { tool_name: "Edit", tool_input: { file_path: "/x/CLAUDE.md" } }), "");
});

test("28.2 an unparseable detect: is skipped without taking the other lessons down with it", () => {
  const cwd = initRepo();
  lesson(cwd, "broken", { detect: "{not json", rule: "never seen" });
  // `null` and `7` PARSE. Without a shape check the matcher dereferences a non-object and the
  // hook crashes — and a crashing PreToolUse hook is a broken tool call, not a missed hint.
  lesson(cwd, "null-detect", { detect: "null", rule: "never seen either" });
  lesson(cwd, "scalar-detect", { detect: "7", rule: "never seen either" });
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  const out = advice(cwd, { tool_name: "Edit", tool_input: { file_path: "/x/CLAUDE.md" } });
  assert.match(out, /BELOW the END marker/);
  assert.doesNotMatch(out, /never seen/);
});

test("28.2 a malformed REGEX in a matcher is that lesson's problem, not the corpus's", () => {
  const cwd = initRepo();
  // `detect:` parses fine as JSON; the regex inside it does not compile. Reachable from any
  // repo's frontmatter, and the failure would land on a hook that fires on every tool call.
  lesson(cwd, "bad-regex", {
    detect: '{"tool":"Bash","commandMatches":"["}', rule: "never seen",
  });
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  const r = engine(["lesson-advice"], {
    cwd, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }),
  });
  assert.equal(r.status, 0, "a bad regex must not crash the hook");
  assert.equal(r.stdout.trim(), "");
  // And the rest of the corpus is untouched by it.
  assert.match(advice(cwd, { tool_name: "Edit", tool_input: { file_path: "/x/CLAUDE.md" } }),
    /BELOW the END marker/);
});

// ─────────────────── 28.3: dormancy — silent where it has no business speaking ─────────────

test("28.3 dormant in a repo with no docs/lessons/ directory", () => {
  const cwd = initRepo();
  const r = engine(["lesson-advice"], {
    cwd, input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/x/CLAUDE.md" } }),
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "", "no corpus declared means nothing to advise");
});

test("28.3 dormant in a project that has never run /pm:init, even with a lessons corpus", () => {
  const cwd = tmpRepo();               // no .conductor/state.json
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  const r = engine(["lesson-advice"], {
    cwd, input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/x/CLAUDE.md" } }),
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "",
    "the plugin's hooks run in EVERY project at user scope — silent until /pm:init");
});

test("28.3 a malformed hook payload is silence, never a crash", () => {
  const cwd = initRepo();
  lesson(cwd, "editing-inside-a-generated-block", EDIT_CLAUDE_MD);
  for (const payload of ["not json at all", "", "null", "\"a string\""]) {
    const r = engine(["lesson-advice"], { cwd, input: payload });
    assert.equal(r.status, 0, `payload ${JSON.stringify(payload)} must not crash the hook`);
    assert.equal(r.stdout.trim(), "");
  }
});

// ─────────────────── 28.4: the hook is WIRED, and wired widely enough ───────────────────

test("28.4 hooks.json registers lesson-advice at PreToolUse, including Bash", () => {
  const hooks = JSON.parse(shipped("hooks/hooks.json"));
  const entries = (hooks.hooks.PreToolUse || []).filter(e =>
    (e.hooks || []).some(h => String(h.command).includes("lesson-advice")));
  assert.equal(entries.length, 1, "exactly one PreToolUse entry drives the lessons advisor");
  const matcher = entries[0].matcher;
  // Half the matchable lessons in this repo's own corpus match on a COMMAND. Shipping this with
  // the gate-guard's Edit|Write|NotebookEdit matcher would leave every one of them dead on
  // arrival, silently — coverage loss with no error anywhere.
  for (const tool of ["Bash", "Edit", "Write"]) {
    assert.match(tool, new RegExp(`^(?:${matcher})$`),
      `the advisor's matcher must cover ${tool}`);
  }
  assert.match(entries[0].hooks[0].command, /conductor\.mjs" lesson-advice/,
    "the hook goes through the engine, so PM_ENGINE_DELEGATION reaches it like every other hook");
});

test("28.4 the advisor is registered separately from the gate guard, which BLOCKS", () => {
  const hooks = JSON.parse(shipped("hooks/hooks.json"));
  const guard = (hooks.hooks.PreToolUse || []).find(e =>
    (e.hooks || []).some(h => String(h.command).includes("gate-guard")));
  const advisor = (hooks.hooks.PreToolUse || []).find(e =>
    (e.hooks || []).some(h => String(h.command).includes("lesson-advice")));
  assert.ok(guard && advisor && guard !== advisor,
    "different exit semantics (block vs advise) and different matchers — separate entries");
});

// ─────────────────── 28.5: shipped once, never twice ───────────────────

const MOVED_SKILLS = ["dogfooding", "lessons"];

test("28.5 both practices ship as pm skills", () => {
  for (const name of MOVED_SKILLS) {
    const text = shipped(`skills/${name}/SKILL.md`);
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`),
      `skills/${name}/SKILL.md must carry the skill frontmatter`);
    assert.match(text, /^description: .+/m, `skills/${name}/SKILL.md must declare a description`);
  }
});

test("28.5 the .claude/ copies are STUBS that redirect — two live copies is the drift this fixes", () => {
  for (const name of MOVED_SKILLS) {
    const stub = shipped(`.claude/skills/${name}/SKILL.md`);
    assert.match(stub, new RegExp(`skills/${name}/SKILL\\.md`),
      `.claude/skills/${name}/SKILL.md must point at the shipped copy`);
    // A stub carries no procedure of its own. gh-126's cross-spec-review stub is 20 lines; the
    // shipped skills are ten times that. A length bound is crude and it is the only mechanical
    // way to tell "redirects" from "quietly forked a second copy".
    const lines = stub.split("\n").length;
    assert.ok(lines < 40,
      `.claude/skills/${name}/SKILL.md is ${lines} lines — a stub redirects, it does not carry ` +
      "the procedure a second time");
  }
});

test("28.5 the duplicate advisor implementation under .claude/hooks/ is gone", () => {
  assert.equal(fs.existsSync(path.join(REPO, ".claude", "hooks", "lessons-advisor.mjs")), false,
    "the advisor ships in the engine — a second implementation is the drift gh-126 closed");
});

test("28.5 no local settings hook re-runs the advisor alongside the shipped one", () => {
  const p = path.join(REPO, ".claude", "settings.json");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  assert.doesNotMatch(text, /lessons-advisor/,
    "this repo consumes the shipped hook like any other user (PM_ENGINE_DELEGATION covers the " +
    "checkout-vs-installed problem)");
});

// ─────────────────── 28.6: the rule reaches every repo, as a REQUIRED TASK ITEM ───────────

const ROUTING_ITEM = "Route what the work taught you.";
const MIRRORS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];

test("28.6 the routing item is a numbered gate-procedure item, not a prose bullet", () => {
  const titles = GATE_PROCEDURE_ITEMS.map(i => i.title);
  assert.ok(titles.includes(ROUTING_ITEM),
    `the gate procedure must carry "${ROUTING_ITEM}" — measured here, a rule carried by a ` +
    "required task reached 14/14 subsequent changes and the same rule as prose reached 3/15");
});

test("28.6 the item names all three destinations of the fork, on every emitted surface", () => {
  const cwd = initRepo();
  const surfaces = [["rules block", run(["rules"], { cwd })],
    ...MIRRORS.map(rel => [rel, shipped(rel)])];
  for (const [name, text] of surfaces) {
    const numbered = new RegExp(`\\d+\\. \\*\\*${ROUTING_ITEM.replace(/\./g, "\\.")}\\*\\*`);
    assert.match(text, numbered, `${name} must carry the routing item as a NUMBERED item`);
    // Whitespace-normalized, exactly as conductor-16's mustSay guard does it: every surface
    // hard-wraps at its own width, so a claim that happens to straddle a line break on one of
    // them is still the same claim. Matching raw text would fail on wrapping, not on meaning.
    const flat = text.replace(/\s+/g, " ");
    // A practice you adopted -> your own backlog. Friction in pm itself -> /pm:feedback.
    // A process failure -> a lesson. Three destinations; naming two of them silently drops a lane.
    assert.match(flat, /feedback/i, `${name} must name the friction destination`);
    assert.match(flat, /docs\/lessons\//, `${name} must name the lessons destination`);
    assert.match(flat, /a workaround produces working output/i,
      `${name} must say why the friction direction is the one that gets missed`);
  }
});

test("28.6 no `{{pm:…}}` placeholder survives into the rendered block, on any platform", () => {
  const cwd = initRepo();
  // The placeholder is new machinery with a silent failure mode: a typo'd name renders
  // LITERALLY into the rules block and nothing else notices. platform.test.mjs catches the
  // resolved-to-the-wrong-form case; this catches the never-resolved-at-all case.
  for (const platform of ["claude-code", "codex", "hermes"]) {
    assert.doesNotMatch(run(["rules", "--platform", platform], { cwd }), /\{\{/,
      `an unresolved placeholder reached the ${platform} block`);
  }
});

test("28.6 the item declares mustSay claims, so a mirror cannot contradict the generator", () => {
  const item = GATE_PROCEDURE_ITEMS.find(i => i.title === ROUTING_ITEM);
  assert.ok(item, "the item must exist before its claims can be checked");
  assert.ok(Array.isArray(item.mustSay) && item.mustSay.length >= 2,
    "an item added without mustSay widens the gap conductor-16's 15.5 guard exists to close");
});

// ─────────────────── 28.7: the ledger claims what ships ───────────────────

test("28.7 every newly shipped artifact is claimed by exactly one capability", () => {
  const ledger = JSON.parse(shipped("docs/parity-ledger.json"));
  for (const rel of MOVED_SKILLS.map(n => `skills/${n}/SKILL.md`)) {
    const owners = ledger.capabilities.filter(c => c.artifacts.includes(rel));
    assert.equal(owners.length, 1, `${rel} must be claimed by exactly one capability`);
  }
});

test("28.7 lesson-advice declares its working-tree effect", async () => {
  const { VERB_EFFECTS } = await import("../lib/verb-effects.mjs");
  assert.equal(VERB_EFFECTS["lesson-advice"].effect, "read-only",
    "an advisory hook that fires on every tool call must never touch the tree");
});
