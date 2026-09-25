---
name: release-checklist
description: Repeatable checklist for cutting a pm release — engine + docs (README, SKILL.md, command docs) + the Mintlify site (pm-plugin.dev, including the Changelog page and Introduction's Real Numbers) + the dev→PR→CI→squash→sync branch dance. Use whenever bumping plugin.json's version, right after CI goes green on the PR that ships it, or when asked to "cut a release"/"ship a version."
---

This is repo-maintenance tooling for developing `pm` itself — it is **not** part of the
product `pm` ships to users (that's `skills/conductor/SKILL.md` and friends, which live in the
plugin's own `skills/` directory and get installed into every consumer's Claude Code). Nothing
here is a subagent or engine change; it's a checklist an interactive session follows by hand,
same instruction-layer spirit as the plugin it maintains.

CLAUDE.md's "Release discipline" and "Documentation currency" bullets state the *rules*; this
skill is the *procedure* that satisfies them end to end, including the parts that are easiest
to skip under momentum (this session skipped the dev→PR flow once and left Mintlify branches
dangling three times before this skill existed).

## When a version bump is "a release" vs. a routine commit

Any commit that bumps `.claude-plugin/plugin.json`'s `version` is a release. State-only
commits (stamping `pmVersion`, marking a story done, re-rendering `PROJECT.md`) are routine —
skip straight to the branch dance at the bottom.

## The checklist

1. **Engine + tests.** All THREE buckets green, including any new tests for the change:
   `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`
   (what the hook runs — BOTH rungs of the assertion half, one runner invocation),
   `node --test scripts/test/functional/*.test.mjs` (real git) and
   `node --test scripts/test/sweeps/*.test.mjs`. The two triggered buckets are also recorded by
   `node scripts/test/certify.mjs functional` and `… sweeps`. No `--no-verify`, ever — the
   pre-commit hook already enforces the assertion half, but re-run explicitly before touching
   version/changelog files so a failure is caught here, not mid-release.

   **The support floor — checked every release (0.49.0, runtime-support).** pm supports exactly
   the Node LTS lines that are not end-of-life, and the lowest is the support floor. Fetch the
   schedule and compute the set as of the RELEASE DATE:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/nodejs/Release/main/schedule.json -o /tmp/schedule.json
   node scripts/test/node-majors.mjs --schedule /tmp/schedule.json --today <release date, YYYY-MM-DD> \
     --fallback "$(rg 'PM_NODE_FALLBACK:' .github/workflows/ci.yml | rg -o '\[[0-9,]+\]')"
   ```
   It prints the set (exit 0) or names the computed set and the committed one (exit 1). If the
   oldest major's `end` is on or before the release date, or the set otherwise differs, move ONE
   UNIT in this release: `NODE_FLOOR_MAJOR` (`scripts/lib/runtime-support.mjs`),
   `PM_NODE_FALLBACK` (`.github/workflows/ci.yml`), the README's `Node N+` lines, CONTRIBUTING.md's,
   CLAUDE.md's and the engine header's (`scripts/conductor.mjs`), and the docs-site pages
   (installation, index, introduction, llms.txt). The per-commit suite holds all but the site
   together (`assert/ci-workflow`, `assert/support-floor`);
   the site is this step's alone. Look one release ahead too: the next `end` date on the schedule
   (2027-04-30 for Node 22) turns CI red on that day until such a release lands, by design.

2. **Version + CHANGELOG.md.** Bump `.claude-plugin/plugin.json`. Add a `## [x.y.z] — <date>`
   entry (`Added`/`Changed`/`Fixed` sections as needed). Get the date from the `datetimeday` MCP
   — never guess. If `state.json`'s schema changed in a way existing data must be *transformed*,
   add a `MIGRATIONS` entry (additive, idempotent — a state file from the prior version must
   still load).

3. **Agent-facing docs in this repo.** For anything user- or agent-visible (new subcommand,
   flag, epic-level-autonomy behavior, tracker behavior, rules-block wording):
   - `README.md` (the user-facing entry point — commands table, relevant guide section)
   - `skills/conductor/SKILL.md` (the agent-facing how-to)
   - the relevant `commands/*.md` doc
   A mechanical test already catches a new subcommand missing from README/SKILL.md; it does
   NOT catch new *prose* behavior (a rules-block wording change, a new instruction section) —
   that's a human/agent judgment call every time.

4. **Mintlify site — content pages, the Changelog page, and Introduction's "Real Numbers."**
   Follow the `mintlify-doc-sync` skill for the mechanics (checkout, escaping gotcha, merge +
   verify live, branch cleanup). Two release-specific additions on top of that skill's
   procedure:
   - **The Changelog page** (`/changelog`, under Guides) gets the new version's entry prepended
     — same content as the `CHANGELOG.md` section just written, converted to MDX.
   - **Introduction's "Real Numbers" table** claims to be mechanically derived — keep that true
     every release by recomputing, never estimating:
     ```bash
     rg -c '^## \[[0-9]' CHANGELOG.md                                 # releases shipped
     # NOT `grep -c '^## \['` — that counts the [Unreleased] placeholder as a release, and
     # did, publishing a number one too high on every release up to 0.39.0 before anyone checked.
     # tests in the engine: all three buckets — the assertion half's BOTH rungs, then the
     # two triggered ones — one invocation, one total. The reporter is FORCED and colour is OFF,
     # so the summary line is `ℹ tests N` on every supported Node (22's default is TAP's `# tests`,
     # and a forced colour breaks the `^ℹ` anchor).
     # THE WHOLE RUN IS SAVED, and it is the file the number is read from (#219): a run piped
     # straight into a count published a number from a run that ALSO failed, and kept nothing to
     # diagnose the failure with. The log is dated (UTC) and lives in the git common dir, beside
     # the certification record, so it outlives the terminal and is shared by every worktree. The
     # shell's PID is in the name so two runs in the same second keep two logs. The publish test
     # also demands pass = tests: a skipped or todo test ran no assertion, so it is not a pass.
     log="$(git rev-parse --path-format=absolute --git-common-dir)/pm-real-numbers/$(date -u +%Y-%m-%dT%H%M%SZ)-$$.txt"
     mkdir -p "$(dirname "$log")"
     FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs \
       scripts/test/functional/*.test.mjs scripts/test/sweeps/*.test.mjs >"$log" 2>&1
     code=$?
     echo "full run saved to: $log (runner exit $code)"
     n() { grep -m1 -E "^ℹ $1 " "$log" | awk '{print $3}'; }
     tests=$(n tests); pass=$(n pass); fail=$(n fail); cancelled=$(n cancelled)
     if [ "$code" -eq 0 ] && [ "${fail:-x}" = 0 ] && [ "${cancelled:-x}" = 0 ] && [ "${tests:-0}" -gt 0 ] && [ "${pass:-x}" = "$tests" ]; then
       echo "PUBLISH: tests $tests"
     else
       echo "STOP -- publish nothing: exit=$code tests=${tests:-?} pass=${pass:-?} fail=${fail:-?} cancelled=${cancelled:-?} -- read $log"
     fi
     # The inverse: the logs accumulate (a few hundred KB per run). Once the release is out and
     # nothing in them is still owed a diagnosis: rm -rf "$(git rev-parse --git-common-dir)/pm-real-numbers"
     wc -l scripts/conductor.mjs scripts/lib/*.mjs | tail -1         # engine LOC — the dispatcher is ~360
     # lines since the module split; the site's row counts the dispatcher plus scripts/lib (0.43.0).
     # external dependencies is always 0 — enforced by the zero-dependency hard constraint
     ```
     **On STOP, publish no number from that run — not even the `tests` count, which a failing run
     still prints.** A failed run is recorded BEFORE it is re-run: find the failing or cancelled test
     in the saved log (`grep -nE '^✖|not ok' "$log"`), comment it on #219 (or open an issue naming it,
     with the log's path and the runner exit), and only then re-run. Re-running until green and
     publishing the green run as if the red one never happened is the "retried silently" #219
     describes — the flake stays unidentified, and the table's "mechanically derived" claim is
     quietly false for the run that failed.

     If a metric can't be recomputed this way (e.g. a historical count with no durable log to
     re-derive it from), don't estimate or carry it forward unverified — drop the row. A number
     that fails the "pulled from git log" claim the section itself makes doesn't belong in it,
     regardless of whether it was ever accurate.

5. **Archive the release's changes, then the branch dance.** Each change in the release is
   archived (`/opsx:archive <id>`) after its Gate 2 and before the squash-merge. When committing
   that archive, stage openspec/ whole (or everything `git status --short openspec/` lists) — the archive rewrites openspec/specs too.
   Staging only `openspec/changes` leaves the main specs' edits in the working tree, where the next
   hard reset discards them (0.48.0 lost four requirements that way —
   `docs/lessons/an-archive-writes-outside-the-change-dir.md`). The archive commit is lifecycle
   bookkeeping and is never attributed to the epic.

   Then the `pm` repo's own branch dance. Follow the `pr-workflow` skill — commit on `dev`, PR
   into `main`, wait for CI green, squash-merge, sync both branches. Never commit a version
   bump directly to `main` — this bit a session once already.
   **Gate 2 for every change in the release is recorded before that squash-merge, from the
   authoring clone** (`pr-workflow` step 6). `record-gate-review --base-sha/--head-sha` resolves
   both bounds in the clone it runs in and refuses a commit that clone does not hold, so a range
   recorded after the squash from a clone without the `presquash/*` tags is refused, not stored. If the authoring
   clone is gone, `git fetch origin 'refs/tags/presquash/*:refs/tags/presquash/*'` first.

6. **If this repo's own `.conductor/state.json` needs a state-only update** (marking a story
    done, restamping `pmVersion` via `/pm:upgrade`) as a result of the release: edit with the
    `Edit` tool (a literal text replacement) rather than any script that re-parses and
    re-serializes the JSON — `json.dump`-style round-trips can silently re-escape existing
    Unicode (e.g. em dashes become `—`), corrupting unrelated content across the whole
    file. This is the same class of corruption `CHANGELOG.md`'s 0.9.3 entry documents from a
    hand-edit; the fix here is the same: never round-trip the whole file through a JSON
    library, only ever touch the exact bytes that need to change.

## Completeness self-check

Before calling a release done, confirm every one of these actually happened, not just the
code/changelog:
- [ ] `plugin.json` version bumped, `CHANGELOG.md` entry added, `MIGRATIONS` entry if needed
- [ ] README.md / SKILL.md / command docs updated for anything user-visible
- [ ] Mintlify content pages updated and their PR merged + verified live
- [ ] Mintlify Changelog page has the new version's entry, merged + verified live
- [ ] Introduction's Real Numbers table recomputed (or a stale/unverifiable row dropped)
- [ ] Merged `pm-docs` branches deleted
- [ ] `dev`→PR→CI→squash→sync completed on `cfdude/pm` itself, tests green post-merge
