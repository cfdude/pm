# Epic-Hierarchy Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent epic's children run unattended as a group — batched by dependency and
priority, preflight-scanned all at once, dispatched via fresh subagents (parallel within a
batch, sequential across batches), and summarized in one consolidated end-of-hierarchy report.

**Architecture:** A new deterministic engine verb (`plan-hierarchy`) computes the batch order
from data pm already has (`parent`, `priority`, `depends-on` links, each child's `autonomy`
block from epic-level autonomy) — no new persistent state. A new packaged agent
(`agents/hierarchy-child-executor.md`) is dispatched once per child by the interactive agent,
per instructions added to the `conductor` skill. Reuses epic-level autonomy's preflight scan and
decision rule unchanged.

**Tech Stack:** Node 18+ built-ins only (`node:fs`, `node:path`, `node:child_process`,
`node:url`) — zero dependencies, per `scripts/conductor.mjs`'s existing constraint. Tests via
`node --test`.

## Global Constraints

- `scripts/conductor.mjs` is Node 18+ built-ins only — never add an npm dependency.
- All tests pass via `node --test scripts/conductor.test.mjs` before any commit — no exceptions.
- Every new CLI subcommand needs a matching command doc under `commands/` and coverage in
  `conductor.test.mjs`.
- The engine never opens a network connection or dispatches an agent itself — `plan-hierarchy`
  only emits a JSON plan; the interactive agent (per `SKILL.md` instructions) does the actual
  dispatching, consistent with pm's instruction-layer law.
- A feature release bumps `.claude-plugin/plugin.json` `version` and adds a `CHANGELOG.md`
  entry. No `MIGRATIONS` entry is needed here — this feature introduces no new persistent state
  (see the design doc's "recompute, don't remember" section); everything `plan-hierarchy` reads
  already exists (`parent`, `priority`, `links`, `autonomy`).
- Design source: `docs/superpowers/specs/2026-07-14-epic-hierarchy-orchestration-design.md`.
  Read it before Task 1 if anything below is ambiguous.

---

### Task 1: `plan-hierarchy --parent <id>` engine verb

**Files:**
- Modify: `scripts/conductor.mjs` (new `findCyclePath()` helper, new `planHierarchy()` function,
  dispatch table, usage string)
- Test: `scripts/conductor.test.mjs`

**Interfaces:**
- Produces: CLI verb `plan-hierarchy --parent <id>`. Prints JSON to stdout on success:
  `{ parent: "<id>", batches: [{ batch: 0, epics: [{ id, priority, autonomous }] }] }`. On a
  dependency cycle, exits non-zero with a stderr message naming the cycle path
  (`a -> b -> a`). Later tasks (`SKILL.md`, the command doc) reference this exact JSON shape and
  this exact verb name — do not rename either.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/conductor.test.mjs`, at the end of the file (after the last existing test):

```js
// ──────────────── epic-hierarchy orchestration: plan-hierarchy ────────────────

function setupHierarchy(cwd, childOverrides = {}) {
  run(["init"], { cwd });
  run(["add-epic", "--id", "sprint", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "child-a", "--lane", "claude-code", "--parent", "sprint", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "child-b", "--lane", "claude-code", "--parent", "sprint", "--priority", "P0"], { cwd });
  run(["add-epic", "--id", "child-c", "--lane", "claude-code", "--parent", "sprint", "--priority", "P2"], { cwd });
  if (childOverrides.applyLinks) childOverrides.applyLinks(cwd);
}

test("plan-hierarchy batches independent children together, ordered by priority within a batch", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.equal(out.parent, "sprint");
  assert.equal(out.batches.length, 1);
  assert.deepEqual(out.batches[0].epics.map(e => e.id), ["child-b", "child-a", "child-c"]); // P0, P1, P2
});

test("plan-hierarchy sequences a depends-on chain into separate batches", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["update-epic", "child-b", "--link", "depends-on:child-a:needs a's output"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.equal(out.batches.length, 2);
  assert.deepEqual(out.batches[0].epics.map(e => e.id), ["child-a", "child-c"]); // no unresolved deps
  assert.deepEqual(out.batches[1].epics.map(e => e.id), ["child-b"]);            // waits on child-a
});

test("plan-hierarchy ignores a depends-on link to an epic outside the hierarchy", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["add-epic", "--id", "outsider", "--lane", "claude-code"], { cwd });
  run(["update-epic", "child-a", "--link", "depends-on:outsider:unrelated"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.equal(out.batches.length, 1); // outsider isn't a sibling, so it doesn't force a second batch
});

test("plan-hierarchy detects and rejects a dependency cycle among children, naming the cycle path", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["update-epic", "child-a", "--link", "depends-on:child-b:x"], { cwd });
  run(["update-epic", "child-b", "--link", "depends-on:child-a:y"], { cwd });
  const err = expectFail(() => run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.ok(err, "expected a cycle rejection");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /dependency cycle/);
  assert.match(msg, /child-a/);
  assert.match(msg, /child-b/);
});

test("plan-hierarchy annotates each child's autonomy status", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["set-autonomy", "child-a", "--level", "autonomous"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  const byId = Object.fromEntries(out.batches[0].epics.map(e => [e.id, e.autonomous]));
  assert.equal(byId["child-a"], true);
  assert.equal(byId["child-b"], false);
  assert.equal(byId["child-c"], false);
});

test("plan-hierarchy on a parent with no children returns an empty batches array", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "lonely-parent", "--lane", "claude-code"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "lonely-parent"], { cwd }));
  assert.deepEqual(out.batches, []);
});

test("plan-hierarchy rejects an unknown parent id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["plan-hierarchy", "--parent", "ghost"], { cwd })));
});

test("plan-hierarchy requires --parent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["plan-hierarchy"], { cwd })));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/conductor.test.mjs`
Expected: FAIL — `plan-hierarchy` is not a recognized subcommand yet.

- [ ] **Step 3: Add `findCyclePath()` and `planHierarchy()`**

Find `parseLinkFlags()` in `scripts/conductor.mjs` (the function immediately before
`parentError()`):

```js
function parseLinkFlags(raw, knownEpicIds) {
  return (raw || []).filter(s => typeof s === "string").map(s => {
    const [type, epic, ...rest] = s.split(":");
    if (!type || !epic) {
      throw new Error(`bad --link '${s}': expected "<type>:<epic>[:<reason>]"`);
    }
    if (!knownEpicIds.has(epic)) {
      throw new Error(`bad --link '${s}': '${epic}' is not a known epic id`);
    }
    const reason = rest.join(":").trim();
    return reason ? { type, epic, reason } : { type, epic };
  });
}
```

Insert immediately after it (before `parentError`):

```js
/** DFS cycle-path finder over a dependency map (id -> Set of ids it depends on), restricted
 *  to `stuckIds` (the set Kahn's algorithm couldn't place). Returns the actual cycle as an
 *  array of ids ending back at its start (e.g. ["a","b","a"]), for a debuggable error message
 *  instead of an unordered dump of every stuck id. */
function findCyclePath(stuckIds, deps) {
  const stuckSet = new Set(stuckIds);
  const visited = new Set();
  const stack = [];
  const onStack = new Set();
  function dfs(id) {
    stack.push(id); onStack.add(id); visited.add(id);
    for (const dep of deps.get(id)) {
      if (!stuckSet.has(dep)) continue;
      if (onStack.has(dep)) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!visited.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop(); onStack.delete(id);
    return null;
  }
  for (const id of stuckIds) {
    if (!visited.has(id)) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return stuckIds; // defensive fallback — Kahn's algorithm guarantees a real cycle exists
}

/** `plan-hierarchy --parent <id>` — computes execution batches for a parent epic's children,
 *  recomputed fresh from existing data every call (no new persistent state): `depends-on`
 *  links BETWEEN SIBLINGS drive a topological sort into batches (Kahn's algorithm); within a
 *  batch, order by priority (P0 first, ties broken by id). Each child is annotated with
 *  whether it already has `autonomy.level === "autonomous"` — dispatching one that doesn't
 *  would immediately hit the epic-autonomy decision rule's "no context to act on" stop.
 *  A dependency cycle among children is rejected outright (exit 1), naming the cycle path,
 *  rather than producing a bogus order. Pure read + stdout — no state mutation. */
function planHierarchy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const parent = typeof f.parent === "string" ? f.parent : undefined;
  if (!parent) { process.stderr.write("usage: conductor.mjs plan-hierarchy --parent <id>\n"); process.exit(1); }
  const state = loadState();
  if (!state.epics.some(e => e.id === parent)) {
    process.stderr.write(`conductor: epic '${parent}' not found\n`); process.exit(1);
  }
  const children = state.epics.filter(e => e.parent === parent);
  const childIds = new Set(children.map(e => e.id));

  const deps = new Map(children.map(e => [e.id, new Set()]));
  for (const e of children) {
    for (const l of (e.links || [])) {
      if (l && l.type === "depends-on" && childIds.has(l.epic)) deps.get(e.id).add(l.epic);
    }
  }

  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, "P?": 9 };
  const placed = new Set();
  const batches = [];
  while (placed.size < children.length) {
    const ready = children.filter(e =>
      !placed.has(e.id) && [...deps.get(e.id)].every(d => placed.has(d)));
    if (!ready.length) {
      const stuck = children.filter(e => !placed.has(e.id)).map(e => e.id);
      const cycle = findCyclePath(stuck, deps);
      process.stderr.write(
        `conductor: plan-hierarchy: dependency cycle among children of '${parent}': ${cycle.join(" -> ")}\n`);
      process.exit(1);
    }
    ready.sort((a, b) => ((rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)) || a.id.localeCompare(b.id));
    batches.push(ready);
    for (const e of ready) placed.add(e.id);
  }

  const plan = {
    parent,
    batches: batches.map((epics, i) => ({
      batch: i,
      epics: epics.map(e => ({
        id: e.id, priority: e.priority,
        autonomous: !!(e.autonomy && e.autonomy.level === "autonomous"),
      })),
    })),
  };
  process.stdout.write(JSON.stringify(plan) + "\n");
}
```

- [ ] **Step 4: Wire the dispatch table and usage string**

Find:

```js
  "set-gate-guard": setGateGuard,
  "gate-guard": gateGuardCheck,
  upgrade,
  changelog,
  rules: () => process.stdout.write(rulesBlock(currentTracker(), currentReviewMode())),
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|add-epic|add-many|update-epic|set-active|clear-active|set-tracker|set-autonomy|set-review-mode|set-gate-guard|gate-guard|upgrade|changelog|rules|write-rules\n");
  process.exit(1);
```

Replace with:

```js
  "set-gate-guard": setGateGuard,
  "gate-guard": gateGuardCheck,
  "plan-hierarchy": planHierarchy,
  upgrade,
  changelog,
  rules: () => process.stdout.write(rulesBlock(currentTracker(), currentReviewMode())),
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|add-epic|add-many|update-epic|set-active|clear-active|set-tracker|set-autonomy|set-review-mode|set-gate-guard|gate-guard|plan-hierarchy|upgrade|changelog|rules|write-rules\n");
  process.exit(1);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/conductor.test.mjs`
Expected: PASS, all tests including the seven from Step 1.

- [ ] **Step 6: Commit**

```bash
git add scripts/conductor.mjs scripts/conductor.test.mjs
git commit -m "feat(pm): add plan-hierarchy CLI verb (priority + depends-on batching, cycle detection)"
```

---

### Task 2: `agents/hierarchy-child-executor.md` — packaged agent

**Files:**
- Create: `agents/hierarchy-child-executor.md`

**Interfaces:**
- Consumes: nothing programmatically — it's a prompt file the interactive agent hands to the
  Agent/Task tool when dispatching one child epic from a `plan-hierarchy` batch.
- Produces: the fixed report-back contract (`STATUS`, `DONE`, `DECISIONS`, `CONCERNS`) that
  Task 3's `SKILL.md` section and any future controller code refer to by name — do not rename
  these fields without updating Task 3 too.

- [ ] **Step 1: Create the agent file**

```markdown
---
description: >
  Executes ONE child epic from an epic-hierarchy orchestration batch, start to finish,
  without asking the orchestrating agent for guidance except at a genuine stop the
  epic-level-autonomy decision rule already defines. Front-loaded with the epic's full
  context and its autonomy grant. Runs in a clean context so nothing it does pollutes the
  orchestrator's — the context is discarded once it reports back.
model: sonnet
tools: Read, Grep, Glob, Bash, Edit, Write, Task
---

You are executing **one epic** as part of a larger epic-hierarchy orchestration run. You will
be given:

- The child epic's id and lane.
- Its full source (whichever its lane uses: OpenSpec `tasks.md`/`proposal.md`/`design.md`,
  a Superpowers `planPath`, or inline `stories[]`).
- Its `autonomy` block from `.conductor/state.json` — `preAuthorized` actions, `context` notes
  supplied during the hierarchy's preflight step.

## Your job

Build this epic to completion using its lane's normal workflow — OpenSpec
propose→apply→archive, Superpowers TDD (red→green→refactor), or direct claude-code work,
whichever fits. Work through it exactly as the epic-level-autonomy decision rule (documented in
the `conductor` skill's "Epic-level autonomy" section) specifies:

a. An action already covered by `preAuthorized`? → proceed, note it.
b. No backup/restore path for a destructive action? → STOP regardless of anything else.
c. Destructive but restorable (backed up first)? → proceed, but log it as a decision.
d. No context to act on — a genuine unresolved unknown, not something you can infer from the
   supplied `context`? → STOP.
e. Consequential and not yet reflected in your `context`? → proceed, but flag it in your report.

**Do not ask the orchestrating agent a question mid-run** unless you hit (b) or (d) above — the
whole point of this dispatch is that context/approvals were already front-loaded during the
hierarchy's preflight step. If you hit a genuine stop, that IS your report; return immediately
with `STATUS: stopped-for-genuine-unknown` rather than guessing.

## Report format (return this as your final message — nothing else)

```
STATUS: done | blocked | stopped-for-genuine-unknown
DONE: <what you actually built/changed, concretely>
DECISIONS: <anything from (a)/(c)/(e) above — decisions made without asking, one per line, or "none">
CONCERNS: <anything the orchestrator or the human should know about before trusting this is finished, or "none">
```

Do not narrate your process. The report above is the entire deliverable — the orchestrating
agent uses `STATUS` to decide whether to continue to the next batch, and folds `DECISIONS` +
`CONCERNS` into the consolidated end-of-hierarchy report.
```

- [ ] **Step 2: Verify the file is well-formed**

Run: `node -e "const fs=require('fs'); const t=fs.readFileSync('agents/hierarchy-child-executor.md','utf8'); if (!t.startsWith('---')) throw new Error('missing frontmatter'); console.log('ok, ' + t.split(String.fromCharCode(10)).length + ' lines')"`
Expected: `ok, N lines` (no error) — confirms the frontmatter delimiter is present or your
Write tool preserved the content;  this file has no automated test since it's a prompt, not
code.

- [ ] **Step 3: Commit**

```bash
git add agents/hierarchy-child-executor.md
git commit -m "feat(pm): add hierarchy-child-executor packaged agent"
```

---

### Task 3: `SKILL.md` — "Epic-hierarchy orchestration" section

**Files:**
- Modify: `skills/conductor/SKILL.md`

**Interfaces:**
- Consumes: the exact verb name `plan-hierarchy` and its JSON shape (Task 1), the exact agent
  filename `agents/hierarchy-child-executor.md` and its report field names `STATUS`/`DONE`/
  `DECISIONS`/`CONCERNS` (Task 2) — do not use different names than what those tasks produced.
- Produces: a documented end-to-end process any future agent invocation follows. Task 4's
  command doc references this section by name (`"Epic-hierarchy orchestration"`).

- [ ] **Step 1: Insert the new section**

Find, in `skills/conductor/SKILL.md`:

```markdown
This same read-and-scan process is the one reused, unchanged, by any future work that needs to
scan several epics at once (e.g. a parent epic's children) — it takes one epic id at a time
regardless of caller.

## state.json reference
```

Replace with:

```markdown
This same read-and-scan process is the one reused, unchanged, by any future work that needs to
scan several epics at once (e.g. a parent epic's children) — it takes one epic id at a time
regardless of caller.

## Epic-hierarchy orchestration

Runs a whole parent epic's children unattended — batched by priority and dependency, each
dispatched as a fresh subagent. Builds on epic-level autonomy above; read that section first if
you haven't. No new persistent state: everything below is recomputed fresh from `parent`,
`priority`, `links`, and each child's `autonomy` block every time.

**When:** the user wants to run an entire hierarchy (a parent epic + its children) unattended,
not just one epic.

**The process:**

1. **Preflight EVERY child up front, not one at a time.** Run the epic-level-autonomy preflight
   scan (above) against every child of the parent. Consolidate all findings into ONE batch of
   questions presented to the user — across the whole hierarchy, not per-child. Record answers
   per child exactly as epic-level autonomy already works: `set-autonomy <child-id>
   --preauthorize "<action>:<reason>"` / `--context "<note>"`, then `set-autonomy <child-id>
   --level autonomous` once a child is cleared.
2. **Get the execution plan:** `node "$ENGINE" plan-hierarchy --parent <id>`. This prints
   `{ parent, batches: [{ batch, epics: [{ id, priority, autonomous }] }] }`. If any epic in the
   plan shows `autonomous: false`, that child wasn't cleared in step 1 — resolve that before
   dispatching it (do not dispatch a non-autonomous child; it will immediately hit decision-rule
   item (d), "no context to act on").
   - If `plan-hierarchy` exits non-zero naming a dependency cycle, that's a real data problem
     (two children `depends-on` each other) — fix the `links` before re-running, don't retry
     blindly.
3. **Dispatch batch by batch, in order.** For each batch: dispatch one
   `agents/hierarchy-child-executor` per epic in that batch — **in parallel** (multiple
   dispatches in the same turn) when the batch has more than one epic, since batch membership
   already means they have no dependency on each other. Do **not** start the next batch until
   every dispatch in the current batch has reported back.
   - A dispatch reporting `STATUS: blocked` — do not advance to a LATER batch that depends on
     that child (check the plan's batch order); batches unrelated to it may still proceed. Flag
     the blocked child for the human in the end-of-hierarchy report; do not auto-retry it.
   - A dispatch reporting `STATUS: stopped-for-genuine-unknown` — this is decision-rule item (d)
     firing correctly, not a bug. Surface it to the human now, same as a single-epic stop would.
4. **After all batches, write ONE consolidated end-of-hierarchy report:** what was asked (the
   step-1 preflight batch), what was done (fold in every dispatch's `DONE`), every `DECISIONS`
   entry across the whole hierarchy, and an explicit **controversial** flag on anything from
   `CONCERNS` or a WARN-class decision — these may affect other backlog items, which is exactly
   the seed a future portfolio-consistency pass would need. The parent epic's own status is
   **never auto-archived** by this process — that stays a human call, same as epic-level
   autonomy never auto-closes an epic either.

## state.json reference
```

- [ ] **Step 2: Verify the exact heading and cross-references**

Run: `rg -n "^## Epic-hierarchy orchestration$" skills/conductor/SKILL.md`
Expected: one match. Then: `rg -n "plan-hierarchy|hierarchy-child-executor" skills/conductor/SKILL.md`
Expected: multiple matches confirming both names appear exactly as Task 1/2 produced them.

- [ ] **Step 3: Commit**

```bash
git add skills/conductor/SKILL.md
git commit -m "docs(pm): document epic-hierarchy orchestration in the conductor skill"
```

---

### Task 4: Command doc, CHANGELOG, and version bump

**Files:**
- Create: `commands/hierarchy.md`
- Modify: `CHANGELOG.md`
- Modify: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: nothing (documentation + metadata only).
- Produces: user-facing docs for `plan-hierarchy`; a versioned, changelog-documented release.

- [ ] **Step 1: Create the command doc**

Read `commands/epic.md` in full first (needed to match its existing heading/list style — the
"Grant epic-level autonomy" section near the end is the most directly comparable precedent).
Create `commands/hierarchy.md`:

```markdown
---
description: Run a parent epic's children as a batched, unattended hierarchy
allowed-tools: Bash, Read, Task
---

Compute the execution plan for a parent epic's children, then dispatch them — batched by
priority and `depends-on` links, preflighted all at once, each child run by a fresh
`hierarchy-child-executor` subagent. See the `conductor` skill's "Epic-hierarchy orchestration"
section for the full process; this doc is the quick-reference for the CLI piece.

## Get the plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" plan-hierarchy --parent <id>
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" plan-hierarchy --parent <id>`

Prints `{ parent, batches: [{ batch, epics: [{ id, priority, autonomous }] }] }`. Batches run in
order; epics within a batch have no dependency on each other and may dispatch in parallel. A
dependency cycle among children exits non-zero, naming the cycle — fix the offending `links`
before retrying.

**Before dispatching:** every epic in the plan should show `autonomous: true`. One that doesn't
was not cleared in the preflight step (see the `conductor` skill) — resolve that first; don't
dispatch a non-autonomous child.

## No new state

`plan-hierarchy` is a pure read — it recomputes the plan fresh from `parent`, `priority`,
`links`, and each child's `autonomy` block every time. There is no "hierarchy in progress" flag
to get out of sync; re-running it any time reflects current reality.
```

- [ ] **Step 2: Add a CHANGELOG entry**

Read `CHANGELOG.md`'s existing `[0.9.3]` entry first (for exact heading/list style), then insert
a new section immediately below the `---` separator and above `## [0.9.3]`:

```markdown
## [0.10.0] — 2026-07-14

### Added

- **`plan-hierarchy --parent <id>` — batched execution plan for a parent epic's children.**
  Computes batches from data pm already tracks (no new persistent state): `priority` and
  `depends-on` links between siblings drive a topological sort — children with no dependency on
  each other land in the same batch (dispatchable in parallel), children in a dependency chain
  land in separate, ordered batches. Each child is annotated with whether it already has
  `autonomy.level: "autonomous"` (from epic-level autonomy), so a hierarchy dispatch never fires
  a child that hasn't been preflighted. A dependency cycle among children is rejected outright,
  naming the cycle path, rather than producing a bogus order.
- **`agents/hierarchy-child-executor.md` — a packaged subagent** dispatched once per child epic
  in a batch: front-loaded with the epic's full context and its autonomy grant, works the epic
  to completion using its lane's normal workflow, follows epic-level autonomy's decision rule
  for genuine stops, and returns a fixed report (`STATUS`/`DONE`/`DECISIONS`/`CONCERNS`).
- The `conductor` skill documents the full end-to-end process: preflight every child up front
  (reusing epic-level autonomy's scan, consolidated into one batch of questions) → `plan-hierarchy`
  → dispatch batch by batch (parallel within a batch, sequential across batches) → one
  consolidated end-of-hierarchy report flagging anything controversial.
- Deferred to a later release: the fuller execution-strategy-selection framework (plain
  subagents vs. the Workflow tool vs. other execution modes) — this release covers only
  subagent-per-child dispatch.

---

## [0.9.3] — 2026-07-14
```

- [ ] **Step 3: Bump the plugin version**

In `.claude-plugin/plugin.json`, change:

```json
  "version": "0.9.3",
```

to:

```json
  "version": "0.10.0",
```

- [ ] **Step 4: Run the full test suite one last time**

Run: `node --test scripts/conductor.test.mjs`
Expected: PASS — every test in the file, not just the ones added in this plan.

- [ ] **Step 5: Commit**

```bash
git add commands/hierarchy.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "docs(pm): document plan-hierarchy, changelog 0.10.0, bump plugin version"
```

---

## After implementation: manual validation (not a coded task)

Per the design's Testing section, the agent/skill side (Tasks 2-3) isn't unit-testable — it
needs a live dogfood run, the same way epic-level autonomy was validated twice before being
trusted. Once this plan is fully implemented and merged:

1. Create a real small hierarchy in this repo (a throwaway parent epic + 2-3 real child epics —
   e.g. small, genuinely independent claude-code-lane fixes from the backlog, or fabricated toy
   epics if none are available).
2. Run the full process from `SKILL.md`'s new section: preflight all children, `plan-hierarchy`,
   dispatch the batches, collect the consolidated report.
3. Judge honestly: was the report actually useful? Did parallel-within-a-batch dispatch work as
   expected? Did a deliberately-introduced dependency or block get handled the way the design
   says it should? Only trust this for real work once that judgment is positive — this is a
   usage/judgment activity, not a file-changing task, so it isn't broken into plan steps here.
