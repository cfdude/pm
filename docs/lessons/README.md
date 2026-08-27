# Lessons learned — development process

**A lane separate from the product backlog, on purpose.** A finding about *what the tool should do
differently* becomes an issue and an epic — that loop works. A finding about *how we should work*
had nowhere to go and died in conversation transcripts. This is that second lane.

> **Use the `lessons` skill.** It does two things: matches your situation against every lesson's
> `trigger` and opens only what applies, **and** recognises when a new lesson has just been earned so
> it gets written while the cost is still measurable. This file is its index; reading the whole
> directory defeats the structure.

## How to read this directory

**Read this file. Read a lesson only when its trigger matches what you are about to do.** Every
lesson carries YAML frontmatter with `trigger`, `cost`, `rule` and `enforced_in`, so the table below
is generated from the files and stays honest. The body is cause and detail — worth reading when the
trigger fires, not before.

`rg -l "tags:.*git" docs/lessons` finds a topic without opening anything.

## The lessons

| Lesson | Trigger — read it when… | Rule | Hook |
|---|---|---|---|
| [`bind-rules-to-functions-not-enumerations`](bind-rules-to-functions-not-enumerations.md) | Writing a rule, guard, or invariant that applies "at every place X happens". | Derive the call-site set mechanically (`rg` for callers) and bind the rule to the FUNCTION, not to an enumeration that goes stale the moment a caller is added. | — |
| [`commit-without-push-is-one-disk`](commit-without-push-is-one-disk.md) | About to dispatch a wave of agents, end a work session, or step away — and the branch is ahead of its remote. | Push at every wave boundary and before stepping away. A commit is durable on ONE machine; a push is the backup. | 🔔 |
| [`editing-inside-a-generated-block`](editing-inside-a-generated-block.md) | About to hand-edit a file that a tool also generates — CLAUDE.md, AGENTS.md, PROJECT.md, any managed region. | Hand-written content goes BELOW the END marker, never inside the managed block. | 🔔 |
| [`git-commit-takes-the-whole-index`](git-commit-takes-the-whole-index.md) | About to commit while any other process (subagent, watcher, script) may be staging files. | Never run a bare `git commit` while another process may be staging. Use `git commit -- <paths>`, or check `git diff --cached --stat` immediately before. | — |
| [`hardcoded-live-data-claims-rot`](hardcoded-live-data-claims-rot.md) | Writing a test, task, or spec whose verification names a count drawn from live data. | State verifications relatively. Quote counts as dated snapshots, never as the assertion. | — |
| [`local-only-git-objects`](local-only-git-objects.md) | Pinning a commit hash into a test, doc, or fixture, or relying on `git` history being present in the checkout that runs it. | Derive hashes from `rev-list` at run time, never pin them; and if a test reads git history, the CI checkout must be `fetch-depth: 0`. | — |
| [`measuring-under-concurrent-writes`](measuring-under-concurrent-writes.md) | A test suite, lint run, or build goes red while background agents are writing to the tree. | Stop the writers before measuring. A red suite under concurrent writes is not evidence. | — |
| [`review-findings-are-not-a-mandate`](review-findings-are-not-a-mandate.md) | A review returns findings and you are deciding what to fix before proceeding. | Split findings into BLOCKS (implementing this ships a defect) and POLISH (correct and implementable). Fix BLOCKS, decline most POLISH, say why. A contradiction is never POLISH. | — |
| [`route-cross-repo-findings-do-not-file-them`](route-cross-repo-findings-do-not-file-them.md) | An audit or sweep produces findings about a codebase you do not own. | Route a cross-repo finding to the session that owns the code. Do not file it yourself. | — |
| [`shared-checkout-parallel-agents`](shared-checkout-parallel-agents.md) | About to run two or more subagents that will each commit to the same git checkout. | Parallel subagents get isolated worktrees or they run serially. Never two agents committing to one checkout. | 🔔 |
| [`slash-commands-run-the-installed-plugin`](slash-commands-run-the-installed-plugin.md) | Developing a plugin, CLI, or tool while also using that tool inside the same session. | When developing the tool itself, invoke the checkout directly (`node scripts/conductor.mjs <verb>`), never the installed slash command. | 🔔 |
| [`tcc-denial-breaks-getcwd`](tcc-denial-breaks-getcwd.md) | Tooling fails everywhere under one directory tree — `EPERM`/`uv_cwd`, "getcwd: cannot access parent directories", a shell hanging at startup — while single file reads still work. | Probe `getcwd` and directory-listing at each level before blaming the tool. A macOS TCC denial breaks every process needing an absolute path under the folder, and the responsible app is the one parented to launchd — usually tmux. | — |
| [`who-can-operate-the-switch`](who-can-operate-the-switch.md) | You are about to call a change a security problem, or you are adding a control something outside the tool's reach must set. | Name the audience before the risk. A plugin cannot reach past its project, so an outside-the-project control is a CONTRIBUTOR requirement by definition — document it in CONTRIBUTING.md and the README rather than treating it as a defect. | — |
| [`worktrees-with-claude-agents`](worktrees-with-claude-agents.md) | About to run Claude agents in git worktrees, or about to kill an agent that is running a test suite in one. | Worktrees fix CORRECTNESS, not RESOURCE contention. One writing agent per machine when the suite is expensive. Always run the preflight and the postflight — scripts/wt-preflight.sh and scripts/wt-cleanup.sh. | 🔔 |

## Where the rules actually live

🔔 = carries a `detect:` matcher, so `.claude/hooks/lessons-advisor.mjs` surfaces it automatically at `PreToolUse`. The rest are retrieval-only by design — a matcher that fires wrongly is worse than none.

A lessons file nobody reads is a data graveyard — the same objection that made the activity log
(#111) conditional on shipping its reader. So **every lesson names where its rule is enforced**:

| Lesson | Enforced in |
|---|---|
| `bind-rules-to-functions-not-enumerations` | required task 16.1 of this release; issue #115 |
| `commit-without-push-is-one-disk` | wave-boundary checklist in the orchestrator's own procedure; detect matcher fires when dispatching agents |
| `editing-inside-a-generated-block` | subagent brief template; product gap noted for pm |
| `git-commit-takes-the-whole-index` | subagent brief template (hard constraint) |
| `hardcoded-live-data-claims-rot` | tasks.md authoring brief |
| `local-only-git-objects` | scripts/test/conductor-15.test.mjs (`requireHistory`); .github/workflows/ci.yml `fetch-depth: 0` |
| `measuring-under-concurrent-writes` | habit — no mechanism |
| `review-findings-are-not-a-mandate` | .claude/skills/cross-spec-review/SKILL.md |
| `route-cross-repo-findings-do-not-file-them` | .claude/skills/dogfooding/SKILL.md |
| `shared-checkout-parallel-agents` | subagent brief template; CLAUDE.md § Subagents & worktrees |
| `slash-commands-run-the-installed-plugin` | subagent brief template; conductor.mjs self-hosting handoff (bootstrap-limited) |
| `tcc-denial-breaks-getcwd` | habit — the four-probe table in the lesson |
| `who-can-operate-the-switch` | CONTRIBUTING.md § Developing pm with pm; README.md § Development |
| `worktrees-with-claude-agents` | scripts/wt-preflight.sh, scripts/wt-cleanup.sh; detect matcher on worktree creation |

This repo measured the difference: a rule carried by a **required task** reached **14/14** adoption
in the audited corpus; the same rule as a **prose bullet** reached **3/15**. A lesson whose rule
lives only in prose is roughly 20% effective. Prefer a skill, a subagent brief, or a gate.

## What belongs here

A lesson qualifies when **repeating the mistake would cost real time, tokens, or recovery work** —
not "something surprising happened", but *"we spent four hours recovering, and the same setup would
do it again"*. `cost` is not decoration; it is the whole argument for following the rule instead of
rediscovering why it exists.

Not here: product defects (issue + epic), one-off judgment calls, or anything a skill or `CLAUDE.md`
already covers — those get **updated**, not re-logged.

## Adding one

One file per lesson, named for the **mechanism** rather than the date, so `rg` finds it by topic.
Frontmatter: `lesson`, `date`, `trigger`, `cost`, `rule`, `enforced_in`, `tags`. Body: cause and
enough detail to recognise the situation. Keep it short — the frontmatter is what gets read.

Then regenerate the tables above.

## Promotion and lane-crossing

A lesson that recurs across sessions has outgrown this directory — promote it into the thing that
enforces it and leave the pointer here. A lesson that turns out to be a **product** gap (the tool
could have prevented this) crosses lanes: file it as an issue and note the crossing.
