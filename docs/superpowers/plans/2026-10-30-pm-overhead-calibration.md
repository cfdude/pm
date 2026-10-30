# pm-overhead-calibration-and-feature-switches — survey the transcripts, run one reduced pair, shrink intake under the threshold

Epic `pm-overhead-calibration-and-feature-switches` (lane `superpowers`). It carries the two unticked items of the
archived `pm-overhead-baseline` change (0.3 Rob's go, 3.2 the calibration run;
`openspec/changes/archive/2026-10-20-pm-overhead-baseline/tasks.md:26-27,56-57`) and the one open switch question
from `docs/measurement/2026-10-feature-switch-audit.md` (`rules:intake` at the 1,000-token line).

Rob's decisions (2026-10-29), which this plan builds and does not reopen:

1. A READ-ONLY transcript survey over `~/.claude/projects/*/*.jsonl`. Per session it keeps token COUNTS of the
   first assistant message, the model id, the project directory and whether pm's brief was present. No message
   text reaches any output. Dev tooling: no model tokens, no effect on the zero-dependency engine.
2. Then a REDUCED synthetic pair: 1 pm-off run, 1 pm-on run, protocol of
   `docs/measurement/2026-10-pm-overhead-baseline.md` section 2. Hard ceiling 150k tokens for the pair, a stop at
   100k per run. A material disagreement between survey and pair escalates to the full 3+3 under a 500k cap, which
   needs Rob's SEPARATE confirmation. This plan never runs the 3+3.
3. Shrink `rules:intake` under 1,000 estimated tokens instead of building a switch.

## Facts this plan was written against (re-check each one before acting on it)

- `node scripts/conductor.mjs overhead --all-features` on 2026-10-29 (engine 0.53.0): `rules:intake` is
  **4,059 bytes, ~1,015 tokens**, not the 4,021 / 1,006 the audit and README carry (the `--ask=` hint landed since).
  `estimateTokens = Math.ceil(bytes / 4)` (`scripts/lib/session-cost.mjs:32`), so under 1,000 means <= 3,996
  bytes. The target is **<= 3,600 bytes (~900 tokens)**: the audit itself called a 6-token margin noise.
- The section is `intakeLines(platform)` in `scripts/lib/rules.mjs:433`, spliced in at `rules.mjs:812`. Its bytes
  vary by platform through `pmCmd(platform, "triage")` (`PLATFORM_COMMAND_PREFIX`, `rules.mjs:124`).
- The repository is PUBLIC (`gh repo view cfdude/pm`), and 18 of the 112 directories under `~/.claude/projects`
  carry `highway` in their encoded name. Committed output must not name projects. See Needs Rob, Q1.
- A real first assistant message here read `input 2, cache_creation 86,283, cache_read 29,574`. `input +
  cache_creation` alone shifts with cache warmth across sessions, so a second run that reads the first run's cached
  prefix reports a smaller figure for the same context. Every count below records `cacheRead` too, and the headline
  delta is on the total prompt (`input + cacheCreation + cacheRead`). See Needs Rob, Q2.
- pm's brief reaches a transcript as an `attachment` entry, `attachment.type == "hook_success"`, `hookName`
  `SessionStart:<source>`, whose `attachment.command` is `node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" brief
  --platform claude-code` with `exitCode` 0. That COMMAND field is the signal: it names pm's hook without reading
  any content. pm's SessionStart matcher is `startup|resume|compact` (`hooks/hooks.json`), NOT `clear`, so a
  `clear` session in a pm repo has no brief by design and says nothing about pm on or off.
- Sampled 2026-10-29, the 300 newest transcripts: 278 are `entrypoint: "sdk-py"` with NO SessionStart attachment at
  all (automated runs; hooks unobservable), 15 `cli`, 4 `sdk-cli`. Only `startup` sessions from `cli` / `sdk-cli`
  can show pm on or off, so the comparable population is small and the survey must report its n.
  `parseEntry` (`scripts/lib/spend-reader.mjs:135`) IGNORES attachments, so brief detection is a separate check.
- Some project directory names begin with `-` (`--tmp-claude-501-...`): shelling out to `ls` breaks on them. The
  walker uses `fs.readdirSync`, never a shell.
- `parseEntry` and `foldRows` (`spend-reader.mjs:135,181`) are pure and already build counts-only rows from an
  explicit field list (`ROW_FIELDS`). The survey reuses them and does not re-implement the fold.
- The headless-run isolation already exists in `evals/fixtures.py:95-157` (`claudeMdExcludes` with absolute paths
  incl. `~/.claude/rules/**`, `autoMemoryEnabled: false`, installed pm disabled via `enabledPlugins`) and
  `evals/runners.py:18-34` (`HONCHO_ENABLED=false` so no run writes to Honcho). Not `--bare`, not
  `--setting-sources` (`~/.claude/projects/-Users-robsherman-Documents-Repos-pm/memory/isolating-user-memory-for-headless-evals.md`).
- `claude --help` lists `--strict-mcp-config`, `--mcp-config`, `--tools`, `--plugin-dir`, `--output-format`.

## Parallel groups

| Group | Tasks | Runs | Shares files with the other group |
| --- | --- | --- | --- |
| A — intake shrink | A1 to A3 | one agent, its own worktree, ONE commit | none |
| B — measurement | B1, then B2 and B4 in parallel, then B3, then B5 (after Group A merges), then B6 | B1 first; B2 and B4 may be two agents (both import B1's core, neither edits it) | none; B5 only reads A's result |
| G — gate items | G1 to G7 | orchestrator, after A and B merge | reads both |

A and B can start at the same time. A demands `certify functional` and `certify sweeps` (`rules.mjs` is engine
source, README is in the functional subject); B's files sit outside both subjects (`scripts/measure/` is not
`scripts/lib/`) — confirm with `node scripts/test/drift.mjs --phase pre-commit` rather than trusting this line.

## Tasks

### Group A — `rules:intake` under the threshold

- [x] A1. RED (UNIT). `scripts/test/unit/overhead.test.mjs`: a new `unitTest` asserting `rules:intake`'s
      `estimatedTokens <= 900` (the 3,600-byte target) from the `overhead` verb over `memoryEngine(emptyRecord())`, and, for every key of
      `PLATFORM_COMMAND_PREFIX`, `estimateTokens(byteLength(intakeLines(p).join("\n")))` <= 900. Watch it fail at
      ~1,015. A budget assertion, so the section cannot creep back over the line unseen.
- [x] A2. GREEN. `scripts/lib/rules.mjs` `intakeLines` (and its JSDoc above `:433`) to <= 3,600 bytes on every
      platform. KEEP verbatim, because tests pin them (sweep G1 lists each holder):
      the heading `## Intake — triage an ask against the whole backlog BEFORE registering it`; five numbered items
      running 1..5 with no gap; the bold `**Decide the lane; do not inherit it.**`; the phrases `reads THE ASK`,
      `no milestone or product context`, ``away from `claude-code` ``, `no spec`, `no gate`,
      `--notes "lane: <chosen> not <routed>`, `triage "`, `--outcome declined`, `externalUrl`; the `--ask=` hint.
      EVERY backticked command in the section stays a complete, valid invocation: the `--link
      "relates-to:<id>:<why>"` and `"supersedes:<id>:<why>"` shapes, `--outcome superseded --reason`, and the full
      declined archive line INCLUDING `--no-deferrals` (the archive gate refuses it without). `certify functional`
      (`emitted-invocations`) would catch a broken one, but at ~4.5 minutes a retry.
      CUT first: the two measured-evidence sentences ("four live pairs ..." and "83% of epics ... 51 ...", ~360 B),
      replaced by one pointer `(evidence: the conductor skill, Intake)` — the evidence already lives in
      `skills/conductor/SKILL.md:990-1046`, so it moves rather than disappears. Then tighten wording in items 1, 3
      and the closing paragraph until the budget holds with margin. Run, one at a time:
      `scripts/test/unit/overhead.test.mjs`, `unit/conductor-34.test.mjs`, `assert/conductor-34.test.mjs`,
      `unit/triage.test.mjs`, `unit/managed-rules-block.test.mjs`, `unit/positional-and-help-tokens.test.mjs`,
      `assert/dev-log-capture.test.mjs`. If an interpolation inside `intakeLines` changed, re-judge its row in
      `scripts/test/sweeps/output-interpolations.judged.mjs:65`.
- [x] A3. Follow-ons, same commit. `README.md:1818` row (new estimate; "no switch: below the threshold after the
      shrink"); a dated addendum at the end of `docs/measurement/2026-10-feature-switch-audit.md` (do not rewrite
      its 4,021 / 1,006 rows: they were true when measured); `docs/rules-block-session-cost.md:40,61` byte figures;
      changeset `.changesets/pm-overhead-calibration-and-feature-switches.md` (emitted text changed, no new flag).
      Whole assertion half once, stage exactly, `drift.mjs --phase pre-commit`, `certify.mjs functional` and
      `sweeps`, then commit `fix(rules): shrink the intake section under the 1,000-token switch threshold`.
      Do NOT edit this repo's `CLAUDE.md` managed block: the orchestrator runs `/pm:upgrade` after merge.
      Report for the orchestrator: the Mintlify page mirroring README's overhead table (`mintlify-doc-sync`).

### Group B — measurement

- [x] B1. TDD (UNIT). `scripts/measure/overhead-survey-core.mjs`, Node built-ins plus imports from
      `scripts/lib/spend-reader.mjs` only.
      FIRST, validate the detection rule before coding it: over this repo's transcripts
      (`~/.claude/projects/-Users-robsherman-Documents-Repos-pm/*.jsonl`), tally `entrypoint x SessionStart source x
      brief-hook-seen`, reading only entry types, `attachment.hookName`, `attachment.command`, `exitCode`. Expect
      `startup` sessions from `cli`/`sdk-cli` to show the brief hook and `clear` sessions not to. If the tally
      contradicts the rule below, stop and report rather than adapt it silently. Put the tally in the B3 doc.
      Pure functions over strings:
      `BRIEF_HOOK = /scripts\/conductor\.mjs"? brief\b/`; `firstMessage(lines)` returns `{model, input,
      cacheCreation, cacheRead, briefPresent, start, entrypoint}` or `{skip: <closed reason>}` — main chain only
      (`isSidechain !== true`), the FIRST assistant `message.id` folded with `foldRows`; `briefPresent` true only
      for a `SessionStart:*` `hook_success` attachment BEFORE that message whose `command` matches `BRIEF_HOOK` and
      whose `exitCode` is 0 (the command string is tested in memory and dropped; no `content`/`stdout` is read);
      `start` the closed enum from the hook name suffix (`none` when no SessionStart attachment); `entrypoint` a
      closed enum (`cli`, `sdk-cli`, `sdk-py`, `other`). `projectClass(encodedDir)` returning `excluded` or
      `included`: build it NOW with the Q3 recommendation (case-insensitive `highway`, `-Documents-Highway-`, and
      the four employer-hosted repo names); Rob's answer can only widen the exclusion. `aggregate(rows)` over the
      HEADLINE population only (`start == "startup"`, `entrypoint` `cli` or `sdk-cli`, `included`), per
      `briefPresent x model`: `n`, median, p10, p90, min, max of each count and of the total prompt; plus the
      WITHIN-PROJECT delta (median over projects holding both sides on the same model of their median difference,
      with how many projects contributed); plus counts of every excluded class by reason. No project or session id
      in it. Tests in `scripts/test/unit/overhead-survey.test.mjs`, with fixtures shaped like the observed entries
      (a `startup` session with pm's hook, a `clear` session without, an `sdk-py` session with no hook
      attachment): sidechain skipped; fragments of one id folded; a brief hook AFTER the first message does not
      count; a non-zero `exitCode` does not count; `BRIEF_HOOK` matches the SessionStart command in
      `hooks/hooks.json` (read on the FILE rung in B2's test, since the unit guard refuses a read); `clear`,
      `resume`, `compact` and `sdk-py` sessions are outside the headline but counted; the serialised aggregate's
      keys are an allowlist and no fixture string (prompt text, project name, session id) appears in it. Commit
      `feat(measure): survey core`.
- [x] B2. TDD (FILE). `scripts/measure/overhead-survey.mjs`, the walk and CLI. Lists `<root>/*/*.jsonl` (top level
      only; `<session>/subagents/` is not read), root from `transcriptRoot(process.env, os.homedir())`. Streams
      each file with `node:readline` and CLOSES it once the first message is folded (the corpus is 3.9 GB). Writes
      the aggregate to `docs/measurement/2026-10-overhead-survey.json` and per-session rows to
      `docs/measurement/.raw/overhead-survey-rows.json`, a path added to `.gitignore` here. Flags `--root`,
      `--out`, `--rows-out`. Test in `scripts/test/assert/overhead-survey.test.mjs` over a fixture tree in a temp
      dir: `BRIEF_HOOK` matches the SessionStart command in the real `hooks/hooks.json`; a project dir named with a
      leading `-` is walked; a `subagents/` file is not read; a file whose bytes after the first message are garbage still parses
      (the early close); neither output file contains any fixture text; the rows file never lands outside
      `.raw/`. Commit `feat(measure): transcript survey walk`.
- [x] B3. RUN the survey (zero model tokens). `/usr/bin/time -l node scripts/measure/overhead-survey.mjs` with
      output redirected; record wall-clock and peak RSS; a run over 3 minutes or 1 GB peak is a defect to fix, not
      to accept. Before staging, `rg -i "highway|robsherman|listreports"` and `rg` for three sampled session ids over
      the committed JSON must find nothing. Write section 1 of `docs/measurement/2026-10-pm-overhead-calibration.md`
      (new): method, date, Claude Code and pm versions, the aggregate table, every exclusion with its count. Commit
      `docs(measurement): transcript survey of first-message size`.
- [x] B4. TDD (UNIT, real-run split). `scripts/measure/overhead-pair.mjs`. Pure parts in the core module, each
      unit-tested in `scripts/test/unit/overhead-pair.test.mjs`: `fixtureSettings(arm, home, pmIds)` (the same keys
      as `evals/fixtures.py:140-151`, absolute paths, installed pm ids `false` in BOTH arms);
      `nextRunAllowed(spent, last, caps, pmEstimate)` with caps `{perRun: 100000, pair: 150000}`: stop when
      `last.total > perRun`, or when `spent + last.total + pmEstimate > pair`, `spent` already including the last run (the next run is estimated as the
      pm-off run's total plus the pm-on fixture's `overhead --json` `total.estimatedTokens`); and the whole
      orchestration over an INJECTED runner, so the mocked twin proves pm-off runs first, the stop fires between
      runs, and nothing runs after a stop. ONE pm tree for the whole pm-on arm, recorded by sha: pm-on runs with
      `--plugin-dir <this checkout>` (installed pm disabled), and `init` and `overhead --json` run from that same
      `scripts/conductor.mjs`; pm-off passes no `--plugin-dir`. The doc states whether that sha is before or after
      Group A's shrink (prefer AFTER: it measures what ships next). The real runner: two `mkdtemp` fixture dirs,
      `git init` both, `init` in the pm-on one only; `HONCHO_ENABLED=false`; `claude -p "Reply with the single
      word ok." --output-format json --strict-mcp-config` with built-in tools left ON (the skill and command
      listings are part of pm's cost); the run must show pm's brief hook in the pm-on transcript and not in the
      pm-off one (B1's `briefPresent`), or the pair is void; transcript found at `transcriptRoot / encodeProjectPath(realpath(fixture)) /
      <session_id>.jsonl` (`realpath`: macOS temp dirs sit under `/private`); counts from B1's `firstMessage`;
      the run's spend from every assistant message in its transcript (`rowTotal`), not the first alone. Installed pm
      ids resolved from `claude plugin list` (check its JSON flag with `--help` at build time; refuse to run if
      none is found, since an installed pm left on would double the hooks in the pm-on arm and leak into pm-off). The real runner is NOT in any test bucket. Commit `feat(measure): reduced calibration pair`.
- [ ] B5. RUN the pair (Rob approved it on 2026-10-29 under these caps; no further go needed). Record per run: model,
      `input`, `cacheCreation`, `cacheRead`, `output`, run total, Claude Code version, pm version, date; the
      pm-on fixture's `overhead --json` `total.estimatedTokens`; the delta on the total prompt and, separately, on
      the archived method's `input + cacheCreation`; the measured-to-estimate ratio. A stop at either cap is a
      recorded result, not a failure. Write section 2 of the calibration doc; mark section 2 of
      `docs/measurement/2026-10-pm-overhead-baseline.md` RUN with a pointer. The `overhead` verb's label stays an
      estimate whatever the ratio (baseline protocol step 5). Commit `docs(measurement): calibration pair result`.
- [ ] B6. Compare, against the threshold Rob sets in Q4, written into the doc BEFORE B5 runs. Material → stop and
      put the 3+3 request (500k cap) in the report; do not run it. Not material, or no project holds both sides →
      say so; the pair stands. Section 3 of the calibration doc. Commit with B5 if it lands in the same session.

### Group G — the gate procedure (CLAUDE.md "The gate procedure")

- [ ] G1. **Call-site completeness sweep**, re-derived with `rg` at build time, never this table typed again from
      memory:

      | Rule / thing guarded | Holders found (2026-10-29) | Holds | Omission and why |
      | --- | --- | --- | --- |
      | intake heading | `scripts/test/fixtures/helpers.mjs:512` (`ALWAYS_ON_HEADINGS`), `unit/conductor-34.test.mjs:59`, `assert/conductor-34.test.mjs:87`, `unit/overhead.test.mjs:171` (slug), `scripts/lib/overhead.mjs:53` (`rules:intake` id) | unchanged, so the id and slug hold | none |
      | intake item shape | `unit/conductor-34.test.mjs:73` (1..N, bold lane item) | kept | none |
      | intake phrases | `assert/conductor-34.test.mjs:101-140` (also reads `skills/conductor/SKILL.md`, `commands/lane-routing.md`, README), `unit/triage.test.mjs:259-268` | kept | none |
      | intake wording elsewhere | `skills/conductor/SKILL.md:980-1060` (long form), `commands/triage.md`, README `:951` | not shrunk: not injected per session | the skill keeps the evidence the block now points at |
      | intake size figures | README `:1818`, `feature-switch-audit.md:20-34`, `rules-block-session-cost.md:40,61`, `openspec/specs/pm-overhead/spec.md:48` (names the id only) | updated in A3 | the archived change's own files are history and stay |
      | this repo's managed block | `CLAUDE.md` | stale until `/pm:upgrade` | orchestrator, by rule |
      | `parseEntry` / `foldRows` | `rg "parseEntry\(|foldRows\("`: `spend-ledger.mjs` and now the survey | the survey consumes, never changes them | a later change to them changes the survey: name it in the survey's header |
      | brief marker | `briefing.mjs:181`; B1's test | pinned by test | none |
      | transcript location | `transcriptRoot`, `encodeProjectPath` reused | one definition | none |

      Data references: none added (no `state.json` field). Inverses: the survey and pair are reads whose outputs a
      rerun regenerates; `.gitignore` gains one line, removable; the intake shrink is emitted text with no state,
      its inverse is a revert. None owed.
- [ ] G2. **Verify against the commit.** For each task above, `git show --stat <sha>` and assert every file it
      names is in THAT commit. A file present in the tree but absent from its commit fails the task.
- [ ] G3. **Lifecycle bookkeeping** carries `<!-- pm:lifecycle -->` on G6's line (done below).
- [ ] G4. **Attribute every commit**, in landing order: `update-epic pm-overhead-calibration-and-feature-switches
      --attribute-commit <sha>` (orchestrator only; builders list shas). Then one fresh-context review (`standard`,
      after `spend-guard pm-overhead-calibration-and-feature-switches`, marker `role=review phase=review round=1`)
      over the merged range.
- [ ] G5. **Cross-spec review**: not applicable — superpowers lane, no spec files in this epic. Stated, not skipped.
- [ ] G6. **Disposition.** `update-epic pm-overhead-calibration-and-feature-switches --status archived --outcome
      delivered --reason "<survey + pair recorded; intake at N tokens>"` with `--deferral "<epicId>:3+3 calibration"`
      if B6 escalated and Rob registered it, else `--declined-deferral "3+3 calibration:<why not needed>"`, and
      `--declined-deferral "feature switches:no unconditional surface at or above 1,000 after the intake shrink"`
      (re-check `overhead --all-features` first). <!-- pm:lifecycle -->
- [ ] G7. **Route lessons**, each named as practice, friction or process. Candidates to check, not conclusions:
      a PROCESS lesson if B5 shows the archived `input + cache_creation` method under-counts a warm second run;
      FRICTION to file (`/pm:feedback`) if `overhead` has no per-platform or per-section budget flag and A1 had to
      compute one by hand.

## Decisions

- Survey and pair live in `scripts/measure/`, not `scripts/lib/`: outside the engine, the sweeps subject and the
  parity-ledger directories. They import from `scripts/lib/` read-only.
- The pair is Node, not a Python script in `evals/`, so the survey and the pair read first-message counts through
  ONE parser. The isolation settings mirror `evals/fixtures.py` key for key and B4's test pins them.
- `--strict-mcp-config` in both arms cuts the shared base (MCP listings) identically; built-in tools stay on,
  because `--tools ""` could drop the skill and command listings, which are about 2,180 of pm's estimated tokens.
- pm-off runs first: it is the smaller run, and its total sets the estimate `nextRunAllowed` checks against 150k.
- A3 records new figures as an addendum and leaves the audit's original rows as measured.

## Needs Rob

- Q1. The repository is public. Committed output: aggregates only, no project names, per-session rows in a
  gitignored `docs/measurement/.raw/`? My recommendation is yes.
- Q2. Record `cacheRead` and take the headline on the total prompt, beyond your "input + cache_creation" spec? It is
  a count like the others. My recommendation is yes: without it a warm second run under-reports.
- Q3. Highway project directories: read them at all? My recommendation is to exclude them: names containing
  `highway` or `-Documents-Highway-`, plus the four employer-hosted repos CLAUDE.md lists (`claude-chatbot`,
  `mortgage-closer`, `bitbucket-mcp`, `zendesk-mcp`), since a transcript directory has no git remote to test.
- Q4. "Disagree materially" as a number, fixed before B5: my recommendation is the survey's within-project delta
  (5 or more sessions on each side) differing from the pair's by more than 25% of the pair's delta.
- Q5. By `nextRunAllowed`, if the pm-off run's total exceeds `(150k - ~14.6k estimate) / 2`, about 67k, the pair
  cannot fit and stops after run 1. Accept that as
  the result, or raise the pair cap? My recommendation is to accept it and report it.
