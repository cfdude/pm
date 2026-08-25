# 2026-08-23 → 24 — the 0.27.0 build

Lessons from proposing, reviewing and starting to implement a 20-issue release. The expensive ones
are first.

---

### Three subagents committing to one git checkout

**Cost:** ~1M tokens across two agents, 4+ hours of wall clock, one commit rewritten out of
existence taking three tasks' implementations with it, three commits carrying another agent's
message, ~20 wasted commit attempts, and a scrambled per-task audit trail that task 16.2 now has to
be told about. Roughly a third of one agent's entire budget went to fighting the index rather than
writing code.

**Cause:** `.git/index.lock` is held for the whole pre-commit hook (~4 minutes with the full suite),
so three agents serialise to about one commit per hook run. `COMMIT_EDITMSG` is a single shared
file, so concurrent `git commit` runs cross messages between trees. And one agent ran
`git commit --amend` on history another agent had built on, leaving HEAD importing a function that
no longer existed. None of this is unusual git behaviour — it is what a shared working tree does.

**Rule:** **Parallel subagents get isolated worktrees or they run serially. Never two agents
committing to one checkout.** For a task list of this size, serial was measurably cheaper than the
parallelism saved. `CLAUDE.md` § Subagents & worktrees already warns that an orphaned worktree
crashes every Claude Code instance, which is why serial is the default and worktrees are the
deliberate exception. → *Lives in the subagent brief template below, and in `CLAUDE.md` § Subagents.*

---

### `git commit` takes everything staged, not just what you staged

**Cost:** one task's entire implementation landed inside a commit labelled as an unrelated
bookkeeping change, leaving the release's own verify-against-the-commit remedy with nothing to audit
for that task. Recovered by splitting the commit, but only because it had not been pushed.

**Cause:** I ran `git add -A .conductor PROJECT.md` — correctly scoped — and then `git commit`,
which commits **the whole index**, including files a concurrently running agent had staged.

**Rule:** **While any other process may be staging, never run a bare `git commit`.** Use
`git commit -- <paths>` or verify `git diff --cached --stat` immediately before committing. Better:
do not commit at all while an agent is running. → *Lives in every subagent brief as a hard
constraint, and is the reason the orchestrator now holds its own commits until a wave boundary.*

---

### Editing inside a generated block

**Cost:** two hand-written `CLAUDE.md` sections — the cross-spec review and dogfooding rules,
roughly 30 lines — were silently deleted by the next `write-rules` regeneration. Noticed only
because an unrelated diff review showed 28 deletions.

**Cause:** I placed them after `Current mode: **standard**`, which sits *inside* the region bounded
by `<!-- BEGIN pm-conductor rules -->` / `<!-- END pm-conductor rules -->`. The engine rewrites that
region wholesale. Nothing warns you; the content simply stops existing.

**Rule:** **Hand-written content goes below the `END` marker, never inside the managed block.**
→ *Lives in every subagent brief. Also a product gap — pm invites edits to a file it regenerates and
marks the danger zone only with an HTML comment.*

---

### Measuring a suite while agents are writing to it

**Cost:** nearly acted on 4 phantom test failures. Would have sent an agent chasing a defect that
did not exist.

**Cause:** the tree was mid-write. The same suite ran green minutes later with no change.

**Rule:** **Stop the writers before measuring. A red suite under concurrent writes is not
evidence.** → *Lives here; it is a habit, not a mechanism.*

---

### Trusting the installed plugin while developing the plugin

**Cost:** `/pm:status` ran the **installed 0.26.0** engine and rewrote `PROJECT.md` with output
that predated the worktree's changes — which a broad `git add` would then commit as an apparent
regression.

**Cause:** slash commands resolve to the installed plugin, not the checkout you are editing.

**Rule:** **When developing `pm` itself, invoke `node scripts/conductor.mjs <verb>` — never the
slash command.** → *Lives in every subagent brief. Related product gap: #128, pm never asks whether
a tool it depends on is current.*

---

### Treating every review finding as a mandate

**Cost:** four cross-spec review rounds where three would have done. Each round found real defects
*and* generated the next round's work, because narrowing a requirement to fix a contradiction can
quietly remove every case where it could fail.

**Cause:** no stopping condition. "No findings" is not one — a review of a document this size always
returns something.

**Rule:** **Split findings into BLOCKS (implementing this ships a defect) and POLISH (correct and
implementable). Fix BLOCKS, decline most POLISH, say why.** The stopping condition is an empty
BLOCKS list with a falsifiability table from live data. A contradiction is never POLISH. → *Lives in
`.claude/skills/cross-spec-review/SKILL.md`, which was corrected mid-session for saying the
opposite.*

---

### Hardcoding live-data claims

**Cost:** a task list asserted "four zero-ticked epics" and "68 archived". Within the hour I
tombstoned an epic — a routine workaround for a known bug — and both numbers became five and 69. A
correct implementation would have **failed** the task's own verification, and the likely response is
to weaken the check rather than fix the number.

**Cause:** a verification that names a count is asserting a fact about a repository that keeps
changing, including as a side effect of the work itself.

**Rule:** **State verifications relatively** — "every archived epic carries an outcome; exactly
those with a passing Gate 2 read `delivered`" — and quote counts as **dated snapshots**, never as
the assertion. → *Lives in the `tasks.md` authoring brief.*

---

### Routing cross-repo findings instead of filing them

**Cost:** none — this one *saved*. Of 13 findings routed to the sessions that own each codebase,
**2 were refuted and 2 were confirmed with the wrong severity.** Filing them directly would have put
two false issues and two mis-severitied ones into other people's trackers.

**Cause:** a read-only cross-repo audit cannot query a live database, trace a caller, or remember
that a claim in a design doc was retracted three paragraphs later. All three happened.

**Rule:** **Route a cross-repo finding to the session that owns the code; do not file it yourself.**
Every one of the five method flaws that audit exposed came from an owning session, not from the
audit reviewing itself. → *Lives in `.claude/skills/dogfooding/SKILL.md`; worth promoting to
`CLAUDE.md` if it holds a second time.*

---

### The same seam, six times

**Cost:** every BLOCKS finding across six review rounds was the archive transition — a rule bound to
a set of paths that turned out to be incomplete. Three paths became four became five. The
requirement *claiming exhaustiveness* was wrong four separate times.

**Cause:** enumerating call sites from memory or from the obvious entry points, rather than from the
function's actual callers. `reconcileArchived()` is invoked from four places, two of which are
interactive verbs where the "no agent present" rationale was simply false.

**Rule:** **When a rule binds a set of call sites, derive the set mechanically (`rg` for the callers)
and bind the rule to the FUNCTION, not to an enumeration that goes stale the moment a caller is
added.** → *Lives as required task 16.1 in this release, and as issue #115.*
