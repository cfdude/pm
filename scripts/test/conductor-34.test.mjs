import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "./helpers.mjs";
import { GATE_PROCEDURE_ITEMS } from "../lib/rules.mjs";

// gh-89 / gh-90 / gh-114 / gh-154 — four INSTRUCTION-layer issues. Nothing here changes what
// the engine computes; all four change what pm EMITS. So every assertion below is made against
// the RENDERED text (`rules`) and the SHIPPED markdown, never against the generator's source —
// a test that greps `rules.mjs` passes for a line emitted on no reachable branch.

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shipped = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const rulesText = (cwd) => run(["rules"], { cwd });

/** The three shipped markdown mirrors of the emitted procedure — the same list conductor-16's
 *  drift guards use. Named here rather than imported so this file states its own population. */
const EMITTED_DOCS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];

const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Every numbered item in a body of emitted text, as `<n>. <title>` — the FORM check. A prose
 *  bullet does not appear here, which is what makes "downgraded to a bullet" a failing test
 *  rather than a cosmetic difference. 14/14 against 3/15 is why the form is asserted at all. */
const numberedItems = (text) =>
  text.split("\n").filter(l => /^\d+\. /.test(l.trim())).map(l => l.trim());

function initRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}

// ───────────── 34.1 (#154): the openspec-validate collision is documented where the marker is ─────────────
//
// `openspec validate --archived` counts raw checkboxes and knows nothing of `<!-- pm:lifecycle -->`,
// so it fails EVERY correctly archived pm change: the archive task is unticked at archive time by
// construction. Its own help text offers it for pre-commit linting, which is exactly how a repo
// acquires a hook that can never go green. pm cannot fix someone else's lint; what it can do is
// make sure the warning sits where the marker is documented, so the person about to wire it in
// reads it first.

test("34.1 every surface that documents the lifecycle marker also names the lint it collides with", () => {
  const surfaces = [
    ["rules block", rulesText(initRepo())],
    ...EMITTED_DOCS.map(rel => [rel, shipped(rel)]),
    ["README.md", shipped("README.md")],
  ];
  // Per-surface, deliberately: asserting against the surfaces JOINED would stay green when the
  // warning is deleted from three of the four.
  for (const [name, text] of surfaces) {
    const t = norm(text);
    assert.ok(t.includes(norm("openspec validate --archived")),
      `${name} documents the pm:lifecycle marker but never names the command that collides with it`);
    assert.ok(t.includes(norm("do not wire it into a pm-managed repo")),
      `${name} must say outright not to wire that lint into a pm-managed repo`);
    // The reason, not just the prohibition: without it a reader treats the failure as a bug in
    // their own tasks.md and "fixes" it by ticking the archive task, which is a false record.
    assert.match(text, /raw checkboxes/i,
      `${name} must say WHY the lint disagrees — it counts raw checkboxes`);
  }
});

test("34.1 the collision rides item 3's mustSay, so a reworded mirror cannot drop it", () => {
  const item = GATE_PROCEDURE_ITEMS.find(i => i.title === "Declare lifecycle bookkeeping.");
  assert.ok(item, "the lifecycle-bookkeeping item must still exist under that title");
  for (const claim of ["openspec validate --archived", "do NOT wire it into a pm-managed repo"]) {
    assert.ok(item.mustSay.some(c => norm(c) === norm(claim)),
      `"${claim}" must be declared in item 3's mustSay — otherwise conductor-16's 15.5 guard ` +
      "compares titles only and a mirror can drop the warning silently");
  }
  // It stays a NUMBERED required task item, not a prose bullet appended underneath it.
  const items = numberedItems(rulesText(initRepo())).join("\n");
  assert.match(items, /\*\*Declare lifecycle bookkeeping\.\*\*/);
});

// ───────────── 34.2 (#114): lane routing is instruction, not algorithm ─────────────
//
// What already shipped closed the CALL-SITE half: 0.27.0 stopped hardcoding a mirrored issue to
// `claude-code` and takes the lane from `suggest-lane`. What remains is the issue's primary
// complaint — routing reads the ask and has no product context to weigh — and it is not fixable
// in the engine without pm becoming something it is not. So the answer is a better INSTRUCTION:
// name the mechanical half, name the judgment half, make the tie-break asymmetric away from the
// lane that leaves no record, and demand the reason when the agent departs from the suggestion.
//
// The sweep that placed it: `rg 'lane: <chosen> not <routed>'` found that demand at BOTH inward
// tracker-sync sites in rules.mjs and at NO other registration path — intake, manual `epic add`,
// a roadmap read in-session. A one-site rule with untouched siblings is the defect gate-procedure
// item 1 exists to catch; intake is where it generalizes, because that section already declares
// it governs every path that registers an epic.

const INTAKE_HEADING = "## Intake — triage an ask against the whole backlog BEFORE registering it";

/** The intake section of an emitted rules block, sliced at its own heading. */
function intakeSection(text) {
  const start = text.indexOf(INTAKE_HEADING);
  assert.notEqual(start, -1, "the emitted block must carry the intake section");
  const rest = text.slice(start + INTAKE_HEADING.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

test("34.2 lane choice is a NUMBERED intake item, not a prose aside", () => {
  const section = intakeSection(rulesText(initRepo()));
  const items = numberedItems(section);
  assert.match(items.join("\n"), /\*\*Decide the lane; do not inherit it\.\*\*/,
    "the lane decision must be a numbered intake item — 14/14 against 3/15 is why the form matters");
  // Contiguous 1..N: an inserted item that leaves a gap breaks the "item N means the same thing
  // everywhere" claim the numbering carries.
  assert.deepEqual(items.map(l => Number(l.match(/^(\d+)\./)[1])), items.map((_, i) => i + 1),
    "intake's numbered items must run 1..N with no gap");
  assert.doesNotMatch(section, /^\s*[-*] \*\*Decide the lane/m, "not a bullet");
});

test("34.2 the emitted lane rule states the judgment half, the asymmetry, and the recorded reason", () => {
  const surfaces = [
    ["rules block", rulesText(initRepo())],
    ["skills/conductor/SKILL.md", shipped("skills/conductor/SKILL.md")],
    ["commands/lane-routing.md", shipped("commands/lane-routing.md")],
    ["README.md", shipped("README.md")],
  ];
  for (const [name, text] of surfaces) {
    const t = norm(text);
    // 1. The mechanical half is named as reading the ask ALONE — without this the reader takes
    //    the suggestion for a verdict, which is the behaviour the issue reports.
    assert.ok(t.includes(norm("reads THE ASK")) || t.includes(norm("reads the ask")),
      `${name} must say what routing actually reads`);
    // 2. The judgment half is named as ABSENT, not as something pm supplies.
    assert.ok(t.includes(norm("no milestone or product context")),
      `${name} must say outright that pm holds no milestone or product context to weigh`);
    // 3. The asymmetry, with its direction. A tie-break stated without a direction is not one.
    assert.ok(t.includes(norm("away from `claude-code`")),
      `${name} must state the DIRECTION an unresolved routing question resolves in — a tie-break ` +
      "without a direction is not a tie-break");
    assert.ok(t.includes(norm("no spec")) && t.includes(norm("no gate")),
      `${name} must say what the claude-code lane costs — no spec, no plan, no gate, no stories`);
    // 4. The recorded reason, as the exact line the tracker-sync procedures already demand.
    assert.ok(t.includes(norm('--notes "lane: <chosen> not <routed>')),
      `${name} must name the line that records a departure from the suggestion`);
  }
});

test("34.2 the recorded-reason demand is no longer a one-site rule", () => {
  // The sweep, mechanically, against the EMITTED text rather than the generator's source: the
  // demand must reach intake (which governs every registration path) as well as the tracker-sync
  // procedures that already carried it.
  const cwd = initRepo();
  run(["set-tracker", "--system", "github-issues", "--repo", "acme/widgets"], { cwd });
  const block = rulesText(cwd);
  const NOTE = 'lane: <chosen> not <routed>';
  assert.ok(intakeSection(block).includes(NOTE),
    "intake must carry the recorded-reason demand — it is the section that governs every path " +
    "that registers an epic, and the tracker-sync siblings had it alone");
  assert.ok(block.split(NOTE).length - 1 >= 2,
    "the demand must appear at intake AND at the inward tracker-sync procedure, not one of them");
});

// ───────────── 34.3 (#89): discovery is delegated, and the rule binds the ORCHESTRATOR ─────────────
//
// A subagent's transcript never enters the parent's context — only its final report does — so
// delegating discovery is a structural saving, not a stylistic one. The sweep that placed this:
// `rg 'dispatch|delegate|subagent'` across the shipped surfaces found delegation instructed for
// REVIEW (both gates, cross-spec, reconciler), EXECUTION (hierarchy-child-executor) and CONFLICT
// RESOLUTION (merge-conflict-resolver) — and for discovery, nowhere. Meanwhile the orchestrator is
// told to read/scan/grep inline at ~25 sites, the heaviest being the hierarchy preflight, which is
// a FULL read of every child's entire source before the first child is dispatched.
//
// It is NOT a gate-procedure item, deliberately: every member of that list is a per-change
// record-correctness obligation carried into `tasks.md` and checked at both gates. "Delegate
// discovery" is a per-action habit that fires dozens of times per change and cannot be ticked as
// a checkbox; adding it would dilute a list whose authority comes from every member being a
// genuine gate obligation. It lands instead as a NUMBERED operating rule (the same form, in the
// list that governs how the conductor is operated) plus a numbered step where the cost is
// concentrated.

test("34.3 delegating discovery is a NUMBERED operating rule, not a prose bullet", () => {
  const block = rulesText(initRepo());
  const items = numberedItems(block);
  const rule = items.find(l => /\*\*Delegate discovery/.test(l));
  assert.ok(rule, "the emitted block must carry the delegation rule as a numbered item — " +
    "14/14 against 3/15 for the same rule as a prose bullet");
  assert.doesNotMatch(block, /^\s*[-*] \*\*Delegate discovery/m, "not a bullet");
  // Its list is the operating rules, which run 1..N contiguously.
  const opsStart = block.indexOf("## PM Conductor — operating rules");
  const opsEnd = block.indexOf("## The gate procedure");
  assert.ok(opsStart !== -1 && opsEnd > opsStart);
  const ops = numberedItems(block.slice(opsStart, opsEnd));
  assert.deepEqual(ops.map(l => Number(l.match(/^(\d+)\./)[1])), ops.map((_, i) => i + 1),
    "the operating rules must run 1..N with no gap");
  assert.ok(ops.some(l => /\*\*Delegate discovery/.test(l)),
    "the rule belongs to the OPERATING rules, not to some other numbered list in the block");
});

test("34.3 the rule names the mechanism, binds the orchestrator, and does not weaken a full read", () => {
  const surfaces = [
    ["rules block", rulesText(initRepo())],
    ["skills/conductor/SKILL.md", shipped("skills/conductor/SKILL.md")],
    ["commands/hierarchy.md", shipped("commands/hierarchy.md")],
  ];
  for (const [name, text] of surfaces) {
    const t = norm(text);
    // The MECHANISM, stated — without it the rule reads as a style preference rather than the
    // structural fact that makes it worth following.
    assert.ok(t.includes(norm("transcript never enters")),
      `${name} must state WHY delegation saves anything — the subagent's transcript never ` +
      "enters the parent's context, only its report does");
    // WHO it binds. The child executors already have this discipline; the orchestrator did not.
    assert.ok(t.includes(norm("if you do not already know the file path")),
      `${name} must give the actionable line — delegate unless you already know the path`);
    // The exception, or the rule silently overrides the preflight's own "do not keyword-grep".
    assert.ok(t.includes(norm("full read")),
      `${name} must say that delegating does not weaken a full-read requirement — otherwise it ` +
      "contradicts the preflight scan, which forbids a keyword grep by name");
  }
  // The two surfaces that OWN the nuance must state the prohibition itself, not merely mention a
  // full read: "delegate discovery" and "read the whole document" only coexist if the text says
  // which one gives way, and neither does. (commands/hierarchy.md defers to the skill by name.)
  for (const rel of ["skills/conductor/SKILL.md"]) {
    assert.ok(norm(shipped(rel)).includes(norm("substituting a keyword grep for a full read")),
      `${rel} must forbid the substitution outright, not just mention a full read`);
  }
  assert.ok(norm(rulesText(initRepo())).includes(norm("substituting a keyword grep for a full read")),
    "the emitted block must forbid the substitution outright, not just mention a full read");
});

test("34.3 the hierarchy preflight — the heaviest inline read — is dispatched per child", () => {
  for (const rel of ["skills/conductor/SKILL.md", "commands/hierarchy.md"]) {
    const t = norm(shipped(rel));
    assert.ok(t.includes(norm("one subagent per child")) || t.includes(norm("subagent per child")),
      `${rel} must say the preflight scan is dispatched per child, not run in the orchestrator's ` +
      "own context — N children means N full source documents otherwise");
  }
  // And the depth requirement survives the delegation, stated in the skill that owns the scan.
  const skill = norm(shipped("skills/conductor/SKILL.md"));
  assert.ok(skill.includes(norm("about depth, not about who performs it")),
    "the skill must say the full-read requirement is about depth, not about who performs it");
});

// ───────────── 34.4 (#90): pm's reporting shape yields to the user's, where it is presentation ─────────────
//
// The naive fix is wrong in an interesting way, so the split matters more than the deference. A
// sweep of every prescribed shape in the shipped surfaces (`rg` for report templates, then a
// search for each one's CONSUMER) puts them in three bands:
//
//   RECORDED — engine writes. Not communication at all, so no communication contract reaches
//              them; "be brief" applied to a disposition's --reason is data loss.
//   PARSED   — a report another AGENT reads back. The orchestrator branches on `STATUS`, escalates
//              on `STATUS: uncertain`, and transcribes `VERDICT` into `record-reconcile`, whose
//              value space lib/reconciler-writeback.mjs enforces one hop later.
//   NARRATED — everything a human reads. Presentation, and it follows the user.
//
// Both halves are guarded below, because either one alone is the defect: deference without the
// carve-outs deletes obligations, and carve-outs without deference is the house style the issue
// was filed about.

const REPORTING_HEADING = "## Reporting — pm owns what is recorded and what is said; you own how you say it";

test("34.4 the emitted block carries the reporting split as its own numbered section", () => {
  const block = rulesText(initRepo());
  assert.ok(block.includes(REPORTING_HEADING),
    "reporting must be a section of its own, not a sentence inside another");
  const start = block.indexOf(REPORTING_HEADING);
  const rest = block.slice(start + REPORTING_HEADING.length);
  const cut = rest.search(/\n## /);
  const section = cut === -1 ? rest : rest.slice(0, cut);
  const items = numberedItems(section);
  assert.ok(items.length >= 5, "the split is carried as numbered items, not prose bullets");
  assert.deepEqual(items.map(l => Number(l.match(/^(\d+)\./)[1])), items.map((_, i) => i + 1),
    "the reporting items must run 1..N with no gap");
});

test("34.4 human-facing output defers to the user, and pm says its own headings are only a default", () => {
  const surfaces = [
    ["rules block", rulesText(initRepo())],
    ["skills/conductor/SKILL.md", shipped("skills/conductor/SKILL.md")],
    ["README.md", shipped("README.md")],
  ];
  for (const [name, text] of surfaces) {
    const t = norm(text);
    assert.ok(t.includes(norm("output style")) && t.includes(norm("communication contract")),
      `${name} must name both channels a user configures — an output style and a CLAUDE.md contract`);
    assert.ok(t.includes(norm("a default for a user who has")) || t.includes(norm("is a default, not a")),
      `${name} must say pm's headings are a DEFAULT, not a style that outranks the user's`);
  }
  // And the two command docs that literally prescribe a human-read shape say so at the shape.
  for (const rel of ["commands/status.md", "commands/next.md"]) {
    assert.ok(norm(shipped(rel)).includes(norm("a default, not a house style")),
      `${rel} prescribes a human-facing shape and must mark it as a default, not a house style`);
  }
});

test("34.4 the carve-outs are stated, so 'defer to the user' cannot delete an obligation", () => {
  const t = norm(rulesText(initRepo()));
  // Scope: this governs REPORTING, never DOING. Without it a brevity contract reads as licence to
  // skip a gate — the same failure the issue reports, pointed the other way.
  assert.ok(t.includes(norm("governs how you REPORT")),
    "the section must scope itself to reporting, never to what the other sections instruct");
  assert.ok(t.includes(norm("does not authorise skipping a required task item")),
    "it must say outright that a brevity contract does not excuse a required task item or a gate");
  // RECORDED band: a write is not a sentence.
  assert.ok(t.includes(norm("not sentences")) && t.includes(norm("data loss, not brevity")),
    "the recorded band must be named as writes, with the consequence of shortening one");
  // PARSED band: field names are a wire format.
  assert.ok(t.includes(norm("wire format")) && t.includes(norm("STATUS/DONE/DECISIONS/CONCERNS")),
    "the parsed band must name the machine-read blocks and say they do not bend");
  // The mapping mechanic: reshape, never drop.
  assert.ok(t.includes(norm("Reshaping is always allowed")) && t.includes(norm("ADD a slot")),
    "it must say to add a slot for a required element the user's shape has no room for, not drop it");
});

test("34.4 the inheritance rule is stated wherever a subagent's contract is decided", () => {
  // Per the sub-agents docs: CLAUDE.md reaches a subagent, an output style does not. Without this
  // an implementer reasonably assumes the output style covers the children, and they keep
  // ignoring it — which is the issue's second ask, and it is invisible without being said.
  const surfaces = [
    ["rules block", rulesText(initRepo())],
    ["skills/conductor/SKILL.md", shipped("skills/conductor/SKILL.md")],
    ["README.md", shipped("README.md")],
  ];
  for (const [name, text] of surfaces) {
    const t = norm(text);
    assert.ok(t.includes(norm("applies to the main conversation")),
      `${name} must say an output style applies to the main conversation only`);
    assert.ok(t.includes(norm("~/.claude/CLAUDE.md")),
      `${name} must say the whole CLAUDE.md hierarchy, including the user-level file, is inherited`);
  }
});

test("34.4 each dispatched agent's own file says its report block does not bend", () => {
  for (const rel of ["agents/hierarchy-child-executor.md", "agents/merge-conflict-resolver.md",
    "agents/reconciler.md"]) {
    const t = norm(shipped(rel));
    assert.ok(t.includes(norm("wire format, not a style")),
      `${rel} must say its report block is a wire format, not a style — the agent reads THIS file, ` +
      "not the orchestrator's copy of the rule");
    assert.ok(t.includes(norm("do NOT bend to a user's output style")),
      `${rel} must name what it does not bend to`);
    // …and that the prose inside the fields is ordinary writing, or the carve-out swallows the rule.
    assert.ok(t.includes(norm("prose inside")),
      `${rel} must say the prose inside a field DOES follow the user's contract`);
  }
});
