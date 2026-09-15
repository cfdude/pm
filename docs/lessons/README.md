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
is built from the files, and `scripts/test/lessons-index.test.mjs` fails when it drifts — it said it
"stays honest" for six releases while six lessons were missing from it. The body is cause and detail — worth reading when the
trigger fires, not before.

`rg -l "tags:.*git" docs/lessons` finds a topic without opening anything.

## The lessons

| Lesson | Trigger — read it when… | Rule | Hook |
|---|---|---|---|
| [`a-fixture-reconstructed-from-live-data-dies-when-the-data-improves`](a-fixture-reconstructed-from-live-data-dies-when-the-data-improves.md) | You are writing a test that builds its fixture by reading the project's own live record and UNDOING something — peeling off a migration's stamps, reverting statuses, stripping a field — to reconstruct an earlier state. | Freeze the fixture. Never build a test's starting state by reading the project's own live record and undoing part of it — the tool improving that record is then what breaks the test, and the failure arrives mid-batch with nothing wrong. | — |
| [`a-guard-can-check-the-wrong-half`](a-guard-can-check-the-wrong-half.md) | About to rely on an existing test as proof that a behaviour holds — especially a guard someone wrote to protect a rule, and most especially one you or a teammate wrote recently. | A guard proves the half it asserts, not the half it is named for. Before trusting one, neuter the behaviour it claims to protect and watch it fail — and read the assertion itself, not the test's name or its comment. | — |
| [`a-silent-noop-edit-reports-success`](a-silent-noop-edit-reports-success.md) | About to apply an edit by string substitution — `str.replace`, `sed s///`, a scripted patch — to a file you are not going to read back, especially several edits in one script. | A substitution that misses is a no-op, and a no-op is indistinguishable from success unless you count matches. Assert the count — `re.subn` and compare, `grep -c` after `sed` — and make a miss exit non-zero. Never print "applied" from a line the substitution cannot reach. | — |
| [`an-unused-active-pointer-turns-a-true-check-into-noise`](an-unused-active-pointer-turns-a-true-check-into-noise.md) | You are working a release with several member epics, closing them one at a time, and you have not run `set-active` on the one you are actually working. | Run `set-active` on the member you are actually working. An in-flight release with no active pointer makes `delivered-release-epic-left-open` fire once per unfinished member — a true check turned into noise by an operator omission, not by a defect. | — |
| [`bind-rules-to-functions-not-enumerations`](bind-rules-to-functions-not-enumerations.md) | Writing a rule, guard, or invariant that applies "at every place X happens". | Derive the call-site set mechanically (`rg` for callers) and bind the rule to the FUNCTION, not to an enumeration that goes stale the moment a caller is added. | — |
| [`cite-a-symbol-not-a-line-number`](cite-a-symbol-not-a-line-number.md) | You are recording evidence for a finding — in an epic's notes, a disposition reason, a grooming verdict, a lesson's `enforced_in`, or a review comment — and you are about to write `file.mjs:123`. | Cite a symbol, a heading or a quoted phrase — never `file.ext:123`. A line number rots within days, and one frozen in a disposition reason or an archived epic is wrong permanently. | — |
| [`commit-without-push-is-one-disk`](commit-without-push-is-one-disk.md) | About to dispatch a wave of agents, end a work session, or step away — and the branch is ahead of its remote. | Push at every wave boundary and before stepping away. A commit is durable on ONE machine; a push is the backup. | 🔔 |
| [`editing-inside-a-generated-block`](editing-inside-a-generated-block.md) | About to hand-edit a file that a tool also generates — CLAUDE.md, AGENTS.md, PROJECT.md, any managed region. | Hand-written content goes BELOW the END marker, never inside the managed block. | 🔔 |
| [`editor-tools-decode-unicode-escape-text`](editor-tools-decode-unicode-escape-text.md) | You are about to write or edit source through the agent's Write, Edit or Bash tool, and the text contains a JavaScript or JSON escape spelled out as text (backslash, "u", four hex digits) that must land on disk as those six characters. | Never spell a backslash-u escape literally in any tool call. Apply the change with a script run through Bash that builds the escape from parts, refuse inside that script to write any raw control or separator character, and confirm `git show --stat` shows line counts, not `Bin`. | — |
| [`filter-at-read-time-not-at-capture-time`](filter-at-read-time-not-at-capture-time.md) | About to run a test suite, build, or long command in the background and pipe it through `tail`, `head`, `grep` or `rg` to keep the output small. | Redirect the WHOLE stream to a file, then filter when you read it. A filter in the capture pipeline discards the evidence permanently; a filter at read time costs nothing and can be re-run with a different pattern. | 🔔 |
| [`git-commit-takes-the-whole-index`](git-commit-takes-the-whole-index.md) | About to commit while any other process (subagent, watcher, script) may be staging files. | Never run a bare `git commit` while another process may be staging. Use `git commit -- <paths>`, or check `git diff --cached --stat` immediately before. | — |
| [`hardcoded-live-data-claims-rot`](hardcoded-live-data-claims-rot.md) | Writing a test, task, or spec whose verification names a count drawn from live data. | State verifications relatively. Quote counts as dated snapshots, never as the assertion. | — |
| [`local-only-git-objects`](local-only-git-objects.md) | Pinning a commit hash into a test, doc, or fixture, or relying on `git` history being present in the checkout that runs it. | Derive hashes from `rev-list` at run time, never pin them; and if a test reads git history, the CI checkout must be `fetch-depth: 0`. | — |
| [`measuring-under-concurrent-writes`](measuring-under-concurrent-writes.md) | A test suite, lint run, or build goes red while background agents are writing to the tree. | Stop the writers before measuring. A red suite under concurrent writes is not evidence. | — |
| [`review-findings-are-not-a-mandate`](review-findings-are-not-a-mandate.md) | A review returns findings and you are deciding what to fix before proceeding. | Split findings into BLOCKS (implementing this ships a defect) and POLISH (correct and implementable). Fix BLOCKS, decline most POLISH, say why. A contradiction is never POLISH. | — |
| [`route-cross-repo-findings-do-not-file-them`](route-cross-repo-findings-do-not-file-them.md) | An audit or sweep produces findings about a codebase you do not own. | Route a cross-repo finding to the session that owns the code. Do not file it yourself. | — |
| [`second-resolution-timestamps-collide-on-fast-machines`](second-resolution-timestamps-collide-on-fast-machines.md) | You are writing a test whose fixture makes two or more git commits, or two records stamped from the clock, and an assertion depends on their times being DIFFERENT. | Never assert that two timestamps merely differ. Set the times explicitly — GIT_AUTHOR_DATE and GIT_COMMITTER_DATE, or an injected clock — and assert each record against its OWN source. Git's `%cI` is second-resolution, so a fast machine writes both in the same second. | — |
| [`shared-checkout-parallel-agents`](shared-checkout-parallel-agents.md) | About to run two or more subagents that will each commit to the same git checkout. | Parallel subagents get isolated worktrees or they run serially. Never two agents committing to one checkout. | 🔔 |
| [`slash-commands-run-the-installed-plugin`](slash-commands-run-the-installed-plugin.md) | Developing a plugin, CLI, or tool while also using that tool in the same session — including any HOOK it installs, which fires without being invoked. | When developing the tool itself, invoke the checkout directly (`node scripts/conductor.mjs <verb>`), never the installed slash command. | 🔔 |
| [`squash-merge-orphans-the-evidence`](squash-merge-orphans-the-evidence.md) | About to squash-merge a PR in any repo whose records reference commit shas — an attribution array, a review verdict's range, a changelog entry, a design doc citing "fixed in <sha>". | Tag the pre-squash tip and push the tag BEFORE merging. A squash-merge makes every commit on the branch reachable from nothing, and `gc` deletes them by default two weeks later — from every clone, permanently. | 🔔 |
| [`stacked-background-commits-collide-on-the-lock`](stacked-background-commits-collide-on-the-lock.md) | About to start a background `git commit` in a repository whose pre-commit hook runs a test suite, when a previous commit may still be running one. | Serialize commits when the hook is slow. Before committing, wait until `.git/index.lock` is absent AND no `git commit` and no `hooks/pre-commit` process is running. Then verify the new SHA — `git log --oneline -1` before and after — because a failed commit leaves the old head in place and says nothing. | — |
| [`tcc-denial-breaks-getcwd`](tcc-denial-breaks-getcwd.md) | Tooling suddenly fails everywhere under one directory tree — `EPERM`/`uv_cwd`, "getcwd: cannot access parent directories", a shell that hangs at startup, or a builtin producing no output — while single file reads still work. | Before blaming the tool, probe getcwd and directory-listing at each level of the path. A macOS TCC denial on a protected folder breaks every process that needs an absolute path under it, and the responsible app is the process parented to launchd — usually tmux, not the terminal. | — |
| [`validate-the-value-you-write`](validate-the-value-you-write.md) | You are writing a refusal or validation for a CLI flag and normalise the value first (trim, lowercase, parse) into a local, while the write reads the flag again elsewhere. | Validate the exact value the write uses, and make the write iterate the validated variable, never the raw flag. Test with padded, multi-line and look-alike values and assert state.json is byte-identical. | — |
| [`who-can-operate-the-switch`](who-can-operate-the-switch.md) | You are about to describe a change as a security problem, OR you are adding a control that something outside the tool's reach has to set. | A plugin's reach ends at the project it runs in. A control living outside that boundary is therefore a CONTRIBUTOR requirement by definition — document it in CONTRIBUTING.md and the README, do not treat it as a defect. And name the audience before naming the risk: "developers of this tool need X" is a different conversation from "this is a security issue." | — |
| [`worktrees-with-claude-agents`](worktrees-with-claude-agents.md) | About to run Claude agents in git worktrees, or about to kill an agent that is running a test suite in one. | Worktrees fix CORRECTNESS, not RESOURCE contention. One writing agent per machine when the suite is expensive. Always run the preflight and the postflight — scripts/wt-preflight.sh and scripts/wt-cleanup.sh. | 🔔 |

## Where the rules actually live

🔔 = carries a `detect:` matcher **that actually parses**, so pm's `lesson-advice` `PreToolUse` hook surfaces it automatically. The rest are retrieval-only — most by design, because a matcher that fires wrongly is worse than none.

⚠️ **Six of them are retrieval-only by accident**, and that is worth stating rather than hiding in a
dash. `a-fixture-reconstructed-…`, `a-silent-noop-edit-reports-success`, `an-unused-active-pointer-…`,
`cite-a-symbol-not-a-line-number`, `second-resolution-timestamps-…` and
`stacked-background-commits-…` each declare a `detect:` written as a **bare regex** where the
contract wants a JSON object (`{"tool":"Bash","commandMatches":"…"}`). `JSON.parse` throws,
`matchableLessons()` skips them, and nothing anywhere reports it — when found, six of the twelve
matchers in the repository that owns the mechanism had never fired. Tracked as
[#194](https://github.com/cfdude/pm/issues/194). Four of the six additionally match on file
*content*, which `matchLessons()` has no field for: it sees `tool`, `file_path`, and the command's
first line only. Those need a capability before they can be expressed at all.

A lessons file nobody reads is a data graveyard — the same objection that made the activity log
(#111) conditional on shipping its reader. So **every lesson names where its rule is enforced**:

| Lesson | Enforced in |
|---|---|
| `a-fixture-reconstructed-from-live-data-dies-when-the-data-improves` | scripts/test/fixtures/state-pre-disposition-walk.json — the frozen pre-walk record, and the rename of `repoFromLiveState()` to `repoFromFrozenPreMigrationRecord()` in scripts/test/conductor-15.test.mjs that stopped the function claiming to read live state. |
| `a-guard-can-check-the-wrong-half` | habit — the neuter-before-trust step; no mechanism |
| `a-silent-noop-edit-reports-success` | habit — assert-the-match-count; no mechanism. The nearest mechanical cousin is the read-back verification `update-epic` performs after writing. |
| `an-unused-active-pointer-turns-a-true-check-into-noise` | Nothing mechanical. `integrity.mjs`'s own comment states the heuristic and names this exact failure; the gap is operator behaviour, which is why this is a lesson and not a guard. |
| `bind-rules-to-functions-not-enumerations` | required task 16.1 of this release; issue #115 |
| `cite-a-symbol-not-a-line-number` | Nothing mechanical — a line number is well-formed text and no test can tell a fresh one from a rotted one. This is a habit, which is why it is a lesson. |
| `commit-without-push-is-one-disk` | wave-boundary checklist in the orchestrator's own procedure; detect matcher fires when dispatching agents |
| `editing-inside-a-generated-block` | subagent brief template; product gap noted for pm |
| `editor-tools-decode-unicode-escape-text` | retrieval only; tooling friction reported to the Claude Code maintainers |
| `filter-at-read-time-not-at-capture-time` | detect matcher on a test run or git commit piped into tail/head/grep/rg on the command's FIRST line. It cannot see a pipe after a multi-line commit message — the exact shape of the repeat on 2026-09-14 — so it stays a habit for that case. |
| `git-commit-takes-the-whole-index` | subagent brief template (hard constraint) |
| `hardcoded-live-data-claims-rot` | tasks.md authoring brief |
| `local-only-git-objects` | scripts/test/conductor-15.test.mjs (requireHistory), .github/workflows/ci.yml |
| `measuring-under-concurrent-writes` | habit — no mechanism |
| `review-findings-are-not-a-mandate` | .claude/skills/cross-spec-review/SKILL.md |
| `route-cross-repo-findings-do-not-file-them` | .claude/skills/dogfooding/SKILL.md |
| `second-resolution-timestamps-collide-on-fast-machines` | scripts/test/conductor-39.test.mjs — the fixture now sets GIT_AUTHOR_DATE and GIT_COMMITTER_DATE explicitly, spaced a minute apart, and asserts each record against its OWN commit rather than merely against "not the other one". |
| `shared-checkout-parallel-agents` | subagent brief template; CLAUDE.md § Subagents & worktrees |
| `slash-commands-run-the-installed-plugin` | subagent brief template; conductor.mjs self-hosting handoff (bootstrap-limited) |
| `squash-merge-orphans-the-evidence` | .claude/skills/pr-workflow/SKILL.md step 5 + step 8 verification; CONTRIBUTING.md § Branch workflow |
| `stacked-background-commits-collide-on-the-lock` | habit — the wait-then-verify wrapper at `scratchpad/final-commit.sh`; pm's own pre-commit hook already holds a suite lock and prints "another worktree is running the suite — waiting", which is the mechanism this lesson wants and which does NOT cover the index lock. |
| `tcc-denial-breaks-getcwd` | habit — the four-probe table below; no mechanism |
| `validate-the-value-you-write` | scripts/lib/update-epic.mjs withdrawnGates; test 3.3a |
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
