# Comprehensive code review of pm 0.43.0 — findings

_Generated from `.conductor/state.json`; each finding below is the epic the review registered, verbatim._

## How it ran

Independent whole-repo review of pm 0.43.0 (e1820a9) via superpowers:requesting-code-review, fanned out to 10 fresh-context reviewers (5 areas x 2 lenses: gates/record, state/registry, hooks/CLI/autonomy, emitted instructions/render/sync, docs+tests). About 80 raw findings, deduplicated into 30 registered planned epics: 7 Critical at P1 (state.json unparseable-wipe, save race, reconcile-gate bypasses, unresolved commit shas, --help-after-positional writes plus unknown flags, rules-block writer destroying CLAUDE.md content, claim TTL crash), 21 Important at P2, 2 at P3 plus one minors batch, each linked relates-to this epic; new evidence added to gh-cfdude-pm-185 and gh-cfdude-pm-189 (and their GitHub issues). Two Criticals re-verified by the orchestrator in a scratch repo. No code changed: the ask was to log findings.

## Where the findings stand

| Priority | Finding | Status | Shipped in / notes |
|---|---|---|---|
| P1 | `claim-ttl-overflow-crashes-readers` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P1 | `commit-shas-stored-unresolved` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P1 | `every-verb-validates-its-argv` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P1 | `reconcile-gate-bypasses` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P1 | `rules-block-writer-destroys-hand-content` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P1 | `state-json-unparseable-loads-as-empty` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P1 | `state-write-race-loses-updates` | fixed | Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec … |
| P2 | `activity-log-detour-events-lose-epic` | open | open |
| P2 | `add-many-drops-input-silently` | open | open |
| P2 | `agent-docs-teach-stale-gate-evidence` | fixed | Carried into a 0.45.0 openspec change (see its supersedes link). |
| P2 | `archived-paused-epic-jams-detour-stack` | open | open |
| P2 | `autonomy-grants-have-no-revoke` | open | open |
| P2 | `commit-gate-tests-working-tree-not-index` | open | open |
| P2 | `commit-watch-misses-commits` | fixed | Carried into a 0.45.0 openspec change (see its supersedes link). |
| P2 | `disposition-references-unvalidated` | open | open |
| P2 | `drift-heal-leaves-claim-on-archive` | open | open |
| P2 | `emitted-text-says-hand-edit-state` | fixed | Carried into a 0.45.0 openspec change (see its supersedes link). |
| P2 | `gate-guard-bash-writes-unguarded` | open | open |
| P2 | `handoff-demand-blind-spots` | open | open |
| P2 | `hooks-not-silent-before-init` | open | open |
| P2 | `lesson-detect-matcher-hardening` | open | open |
| P2 | `no-network-law-test-is-weak` | open | open |
| P2 | `release-member-moves-silently` | open | open |
| P2 | `tracker-item-dedup-bypassed` | open | open |
| P2 | `tracker-sync-recipes-broken` | fixed | Carried into a 0.45.0 openspec change (see its supersedes link). |
| P2 | `user-text-unescaped-in-render-brief-integrity` | fixed | Carried into a 0.45.0 openspec change (see its supersedes link). |
| P2 | `verify-state-false-hand-edit` | open | open |
| P3 | `code-review-0-43-0-minors` | open | open |
| P3 | `sync-registers-ids-add-epic-refuses` | open | open |
| P3 | `triage-ignores-non-latin-text` | open | open |

---

## P1 findings (7 fixed, 0 open)

### ✅ `claim-ttl-overflow-crashes-readers`

**claim --ttl 1e12 is persisted, then owners, integrity and every other session's claim/unclaim crash with RangeError**

*claude-code lane · archived · superseded*

Code review 0.43.0 (B1). claim-shape.mjs claimExpiry builds new Date(t+mins*60000).toISOString() with no bound; claims.mjs ttlFrom accepts any number. The claim is written, then the report throws; from then on owners, integrity, claim/unclaim (with or without --steal) and claim --repo crash. The file's own comment promises an unreadable claim reads as EXPIRED. Fix: bound the TTL in ttlFrom; claimExpiry returns null for an invalid Date.

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


### ✅ `commit-shas-stored-unresolved`

**Commit identities are stored as typed, so a non-commit or symbolic ref defeats Gate 2 staleness; a headSha off the attributed line reads fresh**

*superpowers lane · archived · superseded*

Code review 0.43.0 (A1, A2). (1) `update-epic e --attribute-commit not-a-commit` makes the last entry unresolvable → gateStaleness 'unverifiable' → the archive gate (and the 0.43.0 regression check) accept an archive they refused a moment before. (2) `record-gate-review --base-sha main~1 --head-sha HEAD` stores the literal HEAD, re-resolved at every check, so later unreviewed commits read fresh; PROJECT.md renders pass (main~1..HEAD). (3) archive-gate.mjs gateStaleness `covers !== true → fresh`: a headSha on an unrelated branch archives delivered with a clean pass; the gate-integrity spec says it SHALL be stale. Fix: resolve every sha at write time with `git rev-parse --verify <x>^{commit}` (a local read), store the full sha, refuse what does not resolve; fresh only when the last attributed commit is equal to or an ancestor of headSha. Distinct from gate-staleness-reads-only-last-attribution (array order).

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


### ✅ `every-verb-validates-its-argv`

**--help after a positional performs the write (remove-epic e2 --help deletes e2), ~25 verbs accept unknown flags and stray positionals silently**

*superpowers lane · archived · superseded*

Code review 0.43.0 (C2, B1, A2, D2, E1; the remove-epic case verified by the orchestrator). conductor.mjs only intercepts a help token at argv position 0/1; `remove-epic e2 --help` exits 0 'removed 1 epic(s): e2'; `log-detour x --help` appends to the append-only log; set-active, set-autonomy, set-gate-guard off, set-activity-log on -h, push-detour … --help all write. The 0.41.0 fix for #187 turned 'exit 0, writes nothing' into 'exit 0, writes anyway'. Same root: verbs without requireKnownFlags — set-review-mode, set-tracker, set-lane-routing (no args writes laneRouting:{overrides:[]}), remove-epic, render, record-reconcile (--amendmnts typo records invalidated with []), record-tracker-refresh (--sumary), unconsidered-outcomes, set-autonomy (--levle). parseFlags drops non-`--` tokens: `add-epic --title My Title` stores 'My'. init reads --platform but is FLAGLESS: bare --platform ignored; `init --platform bogus` creates state.json then exits 1, ending dormancy. update-epic --outcome/--reason/--carried-to without --status archived are dropped with a false 'already holds' message (siblings --deferral/--correct-disposition refuse). help.mjs says hook verbs take no flags while hooks.json passes --platform. Fix: every verb calls requireKnownFlags from the registry; refuse leftover positionals; the help catch runs before any write.

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


### ✅ `reconcile-gate-bypasses`

**The reconcile gate ('no bypass') can be cleared without a real verdict: record-reconcile against any epic, an active-pointer move, or a later --no-reconcile push**

*superpowers lane · archived · superseded*

Code review 0.43.0 (A1, A2, B1, C2, E1 — found independently four times). (1) reconciler-writeback.mjs recordReconcile only checks that --detour names an existing epic: `record-reconcile p --detour p --verdict valid` (self) or against an unrelated epic clears reconcileNeeded, gate-guard goes 2→0, and a fabricated may-invalidate link is written while the real one stays unreconciled. (2) epic-progress.mjs reconcileArchived clears reconcileNeeded on any non-active epic: after pop-detour, `clear-active` or `set-active other` then any render erases the obligation; set-active back does not restore it — the exact state-transition-flag rule CLAUDE.md forbids. (3) detour-stack.mjs push assigns paused.reconcileNeeded = reconcileOnResume, so push-detour … --no-reconcile after a pop overwrites a pending obligation, and the Honcho line claims none was required. Also: AMENDMENTS 'none' stored as ["none"], amendments split on any ';'. Fix: require --detour to match an existing unreconciled may-invalidate link on an epic with reconcileNeeded:true; OR the flag on push; the heal never clears it; consider refusing set-active/clear-active while the active epic owes a reconcile.

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


### ✅ `rules-block-writer-destroys-hand-content`

**write-rules can delete hand-written CLAUDE.md content and still print 'refreshed' — markers matched as substrings, not whole lines**

*superpowers lane · archived · superseded*

Code review 0.43.0 (D1). rules.mjs writeRules detects the block with includes(BEGIN prefix) && includes(END) and a lazy regex starting at the first occurrence anywhere. Repro: a prose line mentioning '<!-- BEGIN pm-conductor rules' above '## My rules' above the real block → 'refreshed', the hand-written section is gone. Variants: prose naming both markers splices a second block and the real one is never refreshed again; a deleted END line appends a block and the next refresh swallows the text between; two blocks → only the first refreshed; a string (not function) replacement lets a `$` sequence in a tracker value splice file text in; CRLF files get LF blocks. Fix: whole-line markers, refuse unless exactly one BEGIN/END pair, function replacer, preserve line endings.

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


### ✅ `state-json-unparseable-loads-as-empty`

**An unparseable state.json loads as an empty record, so the next write wipes every epic and gate-guard fails open**

*superpowers lane · archived · superseded*

Code review 0.43.0 (B1, B2, C1; verified by the orchestrator). state.mjs readJSON swallows the parse error, loadState returns defaultState() at revision 0, diskRevision() also reads 0, so the revision guard passes. Repro: 3 epics, prepend a git conflict marker line to state.json, `add-epic --id new` exits 0 and the file holds only [new]. sync (hook-reachable) and upgrade wipe a truncated file too. gate-guard.mjs gateGuardCheck loads the same empty state, so an epic with reconcileNeeded is no longer blocked (exit 0); with epics:{} it crashes (exit 1 = allow). Writes also skip fsync before rename. Fix: loadState refuses (non-zero, naming the file) when state.json exists but does not parse or has the wrong shape; gate-guard exits 2 on that condition; fsync the temp file. A conflicted state.json after a merge is ordinary in a tracked repo.

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


### ✅ `state-write-race-loses-updates`

**Concurrent saveState calls still lose updates and both writers report success — the revision check and the rename are not atomic**

*superpowers lane · archived · superseded*

Code review 0.43.0 (B1). state.mjs saveState: two processes that loaded revision N both pass diskRevision(), both write N+1, and each read-back sees its own bytes. Repro: 16 parallel add-epic → 13 'added epic' with exit 0, 6 epics on disk; 24 parallel in-process saves → 16 ok, 9 epics, 0 errors. Breaks state-write-guard 'a write built on a superseded revision is refused' (a residual of the archived state-lost-update-concurrent-sessions fix). Fix: an O_EXCL lockfile around check+write+rename, stale lock broken by pid/age.

**Outcome:** Carried into a 0.44.0 openspec change (see its supersedes link); split by spec so each change gets its own Gate 1/Gate 2 and the release a cross-spec review.


## P2 findings (5 fixed, 15 open)

### ⬜ `activity-log-detour-events-lose-epic`

**Activity log records epic:null for every detour push/pop — frameEpic reads keys the stack never writes, and the test uses a fake frame**

*claude-code lane · planned*

Code review 0.43.0 (C2). activity-log.mjs frameEpic reads f.epic||f.epicId||f.id; detour-stack.mjs writes {pausedEpic, spawnedDetour}. The report's DETOURS byEpic is always empty and activity --epic drops detours. conductor-33.test.mjs asserts against {epic:'e1'}. record-reconcile, set-autonomy, priority change and set-review-mode log only as bare state-write. Fix: read pausedEpic, build the fixture with push-detour, emit named events for those verbs.


### ⬜ `add-many-drops-input-silently`

**add-many silently drops string links, stores target-less and dangling links, and ignores unknown top-level keys**

*superpowers lane · planned*

Code review 0.43.0 (B1, B2). add-many.mjs/links.mjs mergeLinks skips non-objects: links ["depends-on:base"] or "depends-on:base" vanish with exit 0; {type:'depends-on',epic:'ghost'} is stored dangling; {type:'blocks'} with no target is stored and cannot render; {parent,…,"epic":[…]} creates only the parent. Spec: a bulk write persists what it accepts or rejects by name. Fix: validate top-level keys and route links through parseLinkFlags-equivalent validation against existing plus batch ids.


### ✅ `agent-docs-teach-stale-gate-evidence`

**Agent- and skill-facing docs teach gate-recording forms the engine refuses, and the orchestrator and child docs disagree on who writes state**

*superpowers lane · archived · superseded*

Code review 0.43.0 (E1). agents/hierarchy-child-executor.md prints `record-gate-review <id> --gate 1|2 --verdict pass|fail [--reviewer]`, which exits 1 on both gates; skills/conductor/SKILL.md (3 places) and commands/review-mode.md say a pass requires --base-sha/--head-sha for Gate 1 (Gate 1 needs --artifact). SKILL.md's orchestrator section says children never write state.json, while the child doc has the child record verdicts and archive itself — parallel children then write the main checkout's state concurrently (ROOT = CLAUDE_PROJECT_DIR||cwd). Also drift: review-mode.md 'no unset' (update-epic --clear review-mode exists); SKILL set-gate-guard scope; upgrade.md names /pm:integrity; SKILL tracker shape omits direction; cross-spec-review.md runs node scripts/conductor.mjs (pm checkout only); SKILL/child doc ship pm-repo-only test instructions to users; verify-worktrees/verify-state have no command doc; --help omits required positional ids. Fix: copy epic.md's two-gate form; pick one state writer for hierarchy runs; fix the drift list.

**Outcome:** Carried into a 0.45.0 openspec change (see its supersedes link).


### ⬜ `archived-paused-epic-jams-detour-stack`

**Archiving a paused epic jams the detour stack: pop-detour refuses, remove-epic refuses, and the refusal names a verb that does not exist**

*superpowers lane · planned*

Code review 0.43.0 (B2). push-detour a→d, then `update-epic a --status archived --outcome killed …` succeeds; pop-detour exits 1 ('End the frame by removing the epic's pause deliberately' — no verb does), remove-epic exits 1 (frame drop:null), every frame beneath is stuck. The only exit is un-archiving a to paused, leaving an active epic with a killed disposition. Neither update-epic --status archived nor the drift heal checks the stack. Fix: refuse archiving an epic with a live frame, or ship an explicit frame-drop verb.


### ⬜ `autonomy-grants-have-no-revoke`

**set-autonomy pre-authorizations can never be revoked: --level off then autonomous silently restores every grant**

*superpowers lane · planned*

Code review 0.43.0 (B2, C1, C2). autonomy.mjs setAutonomy only appends preAuthorized; --level off keeps them; `--revoke x` exits 0 'already reads …'; `--preauthorize ":no action"` stores {action:""}. CLAUDE.md required item 1 cites this exact case as the measured safety-surface instance; it was instance (1) of archived sweep-covers-operation-pairs, whose rule shipped with no deferral. Fix: --revoke <action|category:x>, a clear-all, decide whether --level off clears grants, refuse an empty action.


### ⬜ `commit-gate-tests-working-tree-not-index`

**The pre-commit suite gate tests the working tree, not the index, and its 'fewer tests than declared' guard cannot fire; CI has no count guard**

*superpowers lane · planned*

Code review 0.43.0 (E2). .githooks/pre-commit runs node --test against the checkout: staging a failing test and restoring a passing copy unstaged commits green, and HEAD holds the failing test — required item 2 (the commit is the unit of verification) applied to the suite. The declared count uses the same glob as the runner, so renaming a test out of the glob drops it from both (repro: 1/1 passing with 5 tests present); conductor-09's test for the guard asserts status 0, and mutants flipping the comparison survive. ci.yml has no count guard and tests Node 18 only. Fix: run against the index (stash --keep-index or a worktree of the index), count declared tests across scripts/test/** by content, a fixture that must abort, and the same guard in CI.


### ✅ `commit-watch-misses-commits`

**commit-watch reads only the top reflog entry: commit-then-checkout is missed, two commits name only HEAD, out-of-band commits and amends are misattributed**

*superpowers lane · archived · superseded*

Code review 0.43.0 (C1, C2). commit-watch.mjs classifyMovement: `git commit …; git checkout -b tmp; git checkout main` in one call → no nudge, no log row (also commit && switch -c, commit && pull --rebase). Two commits in one call → the nudge names only HEAD; attribution is append-only so the record is permanently short. A commit from another terminal is logged as AUTO-DETOUR against the active epic on the next unrelated call; `commit --amend` writes a second row and prompts attributing a new sha after the orphaned one. Fix: walk rev-list baseline..head and report every commit; per-call PreToolUse snapshot; treat amend as replacement.

**Outcome:** Carried into a 0.45.0 openspec change (see its supersedes link).


### ⬜ `disposition-references-unvalidated`

**--carried-to and --deferral accept the epic itself, an unknown id, or ':' — and each satisfies the archive gate's handoff demand**

*superpowers lane · planned*

Code review 0.43.0 (A1, A2). update-epic.mjs pairs/carriedTo: `--status archived --outcome delivered --carried-to s1` on s1 with an open story archives (the gate's own message calls this a fabricated record; integrity cannot see a self-reference). `--deferral ":"` archives and stores {epic:"",section:""}, which dangling-epic-reference skips; `--deferral ghost:sec` is accepted. The empty-halves guard added to --declined-deferral never reached --deferral. Siblings --link, --parent, release --member/--defer and push-detour all validate ids. Fix: refuse unknown, empty or self ids for both.


### ⬜ `drift-heal-leaves-claim-on-archive`

**The archive-drift heal archives an epic but leaves its claim, and integrity then blames a hand-edit**

*claude-code lane · planned*

Code review 0.43.0 (B2). update-epic clears epic.claim on archive; epic-progress.mjs reconcileArchived (how /opsx:archive epics are usually archived) does not, and update-epic's comment listing removal sites omits the heal. Integrity then reports 'predates that rule or was hand-edited', which is false. Fix: clear the claim in the heal; add the heal to the comment's list.


### ✅ `emitted-text-says-hand-edit-state`

**Engine-emitted and shipped instructions still tell agents to hand-edit .conductor/state.json (commit nudge, SKILL.md, init.md, init stderr)**

*superpowers lane · archived · superseded*

Code review 0.43.0 (C1, D2, E1). subcommands.mjs runNudge prints after every commit 'Otherwise update .conductor/state.json if an epic's status or stories changed'; skills/conductor/SKILL.md §Keeping the index honest: 'On PUSH/POP/priority change: edit state.json (or use the verbs above)' and 'update state.json status'; commands/init.md tells the agent to set active/priority/status by reading state.json; init's stderr 'Triage epics in .conductor/state.json'. All contradict the rules block's NEVER hand-edit and skip the same-write reconcileNeeded stamp on POP. Fix: name push-detour/pop-detour/update-epic --priority/set-active everywhere.

**Outcome:** Carried into a 0.45.0 openspec change (see its supersedes link).


### ⬜ `gate-guard-bash-writes-unguarded`

**gate-guard's 'no bypass' covers Edit/Write/NotebookEdit only — a Bash heredoc or sed -i writes through, and the block message overclaims**

*superpowers lane · planned*

Code review 0.43.0 (C1). hooks.json PreToolUse matcher omits Bash; gate-guard.mjs block text says 'Completing the reconcile gate is the only way through'. Agents blocked on Edit commonly switch to `cat > f <<EOF` or `sed -i`. Fix: either state plainly that Bash writes are forbidden too (instruction) or add Bash with a conservative write-shape check; decide which and document.


### ⬜ `handoff-demand-blind-spots`

**The handoff demand reads 0/0 once /opsx:archive moves tasks.md, and adding one inline story hides every unticked tasks.md item**

*superpowers lane · planned*

Code review 0.43.0 (A1, A2). (1) epic-progress.mjs epicProgress: after the change moves under archive/, tasks.md is not found and archive-as-delivered is accepted with 2 of 3 tasks unticked; archivedTasksPath() exists but is used only for backfilled epics (the gate-integrity spec currently permits reading zero — a spec-level check that cannot fail). (2) Array.isArray(epic.stories) is preferred over the tasks source: tasks.md at 1/3, `--add-story x`, `--story 1 --done --status archived --outcome delivered` archives with PROJECT.md showing 1/1. Fix: read the archived tasks.md when the live one is gone (amend the spec); count tasks and stories together or refuse to switch source.


### ⬜ `hooks-not-silent-before-init`

**Hook verbs print detached-checkout and root-divergence warnings in repos pm never initialised, and nothing tests gate-guard or snapshot dormancy**

*superpowers lane · planned*

Code review 0.43.0 (C1, E2). conductor.mjs warnRootDivergence / warnDetachedTree run before any isInitialized() check: snapshot (PreCompact) in a non-pm detached repo prints a 4-line 'about to write .conductor/brief.txt' and writes nothing; commit-nudge prints 'WRITING A DIFFERENT REPOSITORY' when CLAUDE_PROJECT_DIR is a non-pm repo. Breaks hooks/README.md 'silent until /pm:init'. Tests: mutating gate-guard's dormancy return to exit 2 (blocks Edit in every repo on the machine) survives 176 tests; removing snapshot's guard survives 131. Fix: skip both warnings when !isInitialized(); add dormancy tests for gate-guard, snapshot and brief like the existing commit-nudge/write-rules/lesson-advice ones.


### ⬜ `lesson-detect-matcher-hardening`

**lesson-advice: a catastrophic regex hangs every Bash/Edit call ~60s, a typo'd detect key matches every tool call, CRLF frontmatter is silently inert**

*superpowers lane · planned*

Code review 0.43.0 (C1, C2). lessons.mjs matchLessons compiles commandMatches with no complexity or input bound: detect {tool:Bash, commandMatches:'^(a+)+$'} on a 31-char command burned 60.4s CPU in the hook, on every Bash/Edit/Write call. An unknown key applies no predicate: {tool:Bash, commandMatch:'gh pr merge'} matched `ls`. CRLF frontmatter (/^---\n/), a tool array and a bad regex are silently inert. Fix: allowlist detect keys, reject nested quantifiers or cap the matched text, accept CRLF, report rejects outside the hook.


### ⬜ `no-network-law-test-is-weak`

**The instruction-layer no-network test misses https/net/tls imports and spawning gh or curl**

*claude-code lane · planned*

Code review 0.43.0 (E2). conductor-35.test.mjs scans for fetch(, node:https? and require('https'). Mutants adding `import https from "https"; https.get(…)` or `import net from "node:net"; net.connect(443)` to a lib file survive conductor-35 and -39; node:tls, dgram, http2 and execFile('gh'|'curl') are unchecked. It is the only mechanical guard on a hard architectural law. Fix: allowlist import specifiers (node: built-ins minus net/http/https/http2/tls/dns/dgram, plus relative) and an argv[0] allowlist for spawn/exec.


### ⬜ `release-member-moves-silently`

**release --member silently moves an epic out of another release with no amendment; re-running --defer overwrites the recorded reason**

*claude-code lane · planned*

Code review 0.43.0 (A1, A2). releases.mjs member loop overwrites knownEpic(id).release and records nothing on the old release (the --unmember guard's own comment names this harm); `release show r1` then shows 0 members, no amendment, no stderr. Re-running --defer replaces 'depends on X landing' without keeping the prior reason. Fix: refuse or record an unmember amendment on the old release and say so; keep deferral reason history.


### ⬜ `tracker-item-dedup-bypassed`

**The one-epic-per-tracker-item guard runs only on add-epic --external-id; --external-url alone, update-epic and add-many skip it**

*superpowers lane · planned*

Code review 0.43.0 (B2, E1). add-epic.mjs EPIC_DEDUP_KEYS check sits inside `if (externalId !== undefined)`. Repro: five epics with the same issue URL, each command exit 0. Also: the add-epic duplicate message names external-id when the collision was the URL. Fix: one shared dedup check (URL-keyed) called by add-epic, update-epic and add-many.


### ✅ `tracker-sync-recipes-broken`

**Tracker sync recipes that cannot run as written: secondary pull lacks updatedAt, Jira keys fail the id format, gh issue list caps at 30, and direction text leaks**

*superpowers lane · archived · superseded*

Code review 0.43.0 (D1, D2, E1). rules.mjs: secondary `gh issue list --json number,title,url,labels` omits updatedAt though the add-epic line needs --external-updated-at, and there is no watermark step (commands/tracker.md:132 too); the test fills the placeholder with a constant. Once any secondary exists an outward-primary-linked epic reads 'never re-read' and nothing clears it. Inward recipe `add-epic --id jira-abc-<issue-number>` fails for key ABC-123 (format ^[a-z0-9]…); only github-issues recipes are executed in tests. No --limit: gh defaults to 30, items past 30 are never registered and the closed-item step proposes archiving them. The completion-sync reminder references writeback steps an inward primary never emits; its test checks a heading. commands/tracker.md 'ongoing responsibilities' tell every tracker to create issues regardless of direction. briefing.mjs prints '✓ all active epics are mirrored to jira' for an epic linked to a secondary (externalId single slot). A scope-less secondary emits add-epic --id null-<…>. --repo is emitted unquoted (set-tracker accepts 'a/b; touch x'). set-tracker has no requireKnownFlags, primary --remove is silently ignored, --intent badpair dropped. rules and rules.mjs name /pm:epic list which does not exist. Fix: declare the list step once with updatedAt and --limit, slug keys, add watermark steps, scope tracker.md by direction, count primary mirrors by URL scope, validate owner/name, add primary remove.

**Outcome:** Carried into a 0.45.0 openspec change (see its supersedes link).


### ✅ `user-text-unescaped-in-render-brief-integrity`

**Newlines and pipes in titles, detour reasons, disposition and withdrawal reasons forge lines in PROJECT.md, the brief and integrity**

*superpowers lane · archived · superseded*

Code review 0.43.0 (A1, D1, D2). render.mjs (titles, detour table reason, recent-detours note, dispositions table escapes | but not newline), briefing.mjs (detour reason forges a NOW: line and EPIC LINKS lines), integrity.mjs delivered-epic-attributed-no-commits prints `${w.sha} ("${w.reason}")` raw while its sibling checks use escapeControls(JSON.stringify()). Titles arrive from third-party tracker text via the inward recipe, and /pm:next reads PROJECT.md. Also raw: declinedPairs refusals, story-disposition refusal, release show. Fix: one shared escaper (archive-gate.mjs escapeControls plus | for tables) at every interpolation.

**Outcome:** Carried into a 0.45.0 openspec change (see its supersedes link).


### ⬜ `verify-state-false-hand-edit`

**verify-state reports an 'undetected hand-edit' after ordinary engine verbs that save without rendering**

*claude-code lane · planned*

Code review 0.43.0 (C2). worktree-hygiene.mjs verifyState compares state.json mtime to the render stamp: `init` → exit 0; `set-activity-log on` → exit 1 claiming a hand-edit; claims and platform recording trip it too. The one hand-edit detector accuses the engine. Fix: compare the state revision recorded in the stamp, not mtime.


## P3 findings (0 fixed, 3 open)

### ⬜ `code-review-0-43-0-minors`

**Minor findings from the 0.43.0 comprehensive code review (batch)**

*claude-code lane · planned*

Code review 0.43.0 minors, each reproduced or read by a reviewer: priority never validated (banana stored) in add-epic/update-epic/add-many; saveHookHeal records two conflict entries per skipped hook write (spec says one); worktree-hygiene.mjs isAncestorOfCurrentHead interpolates a sha into execSync (switch to execFileSync); --force described as working on every verb but refused by add-epic/update-epic/claim allowlists and unmentioned in the conflict message; state.json.tmp-* left behind on ENOSPC and not gitignored; remove-epic crashes on an untitled descendant (e.title.slice); record-tracker-refresh accepts a non-date or backwards watermark; handoff refusal wording '2 of 1/3 task(s)'; conductor-09.test.mjs:24 reconcileNeeded assertion cannot fail (the heal clears it); changelog --since garbage dumps everything; untested guards surviving mutation: destructuring outcome read escapes the conductor-13 scan, 0.3.0 and 0.32.0 migration never-overwrite guards, pop-detour's archived-epic refusal, linkOnce dedupe; remedy texts naming refused commands at archive-gate.mjs (record-gate-review without range flags) and integrity delivered-release-epic-left-open (sibling of #189).


### ⬜ `sync-registers-ids-add-epic-refuses`

**sync and the archive backfill register ids add-epic refuses, and sync silently archives an active epic on a name collision**

*superpowers lane · planned*

Code review 0.43.0 (D1). subcommands.mjs sync/backfillArchive register 'Add Auth', 'x|y', '.hidden', 'My Plan.md' (the id format is enforced only in add-epic); x|y breaks the Epics table and spaces break every emitted update-epic line. An active claude-code epic add-auth is archived with outcome unknown and the active pointer cleared because an unrelated archive/2025-01-01-add-auth exists; sync prints 'synced (0 new…)'. Fix: one id validator shared by all registration paths; the heal matches by recorded spec path, not bare name.


### ⬜ `triage-ignores-non-latin-text`

**triage finds no candidates for non-Latin text — tokenize splits on [^a-z0-9]**

*claude-code lane · planned*

Code review 0.43.0 (D1). triage.mjs tokenize: an epic titled in Cyrillic plus the identical ask returns candidates: [], indistinguishable from 'no overlap' at intake's mandatory first step. Fix: a Unicode-aware split (\p{L}\p{N}), or report that zero tokens were extracted.

