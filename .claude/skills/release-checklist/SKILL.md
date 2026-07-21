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

1. **Engine + tests.** `node --test scripts/conductor.test.mjs` green, including any new tests
   for the change. No `--no-verify`, ever — the pre-commit hook already enforces this, but
   re-run explicitly before touching version/changelog files so a failure is caught here, not
   mid-release.

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
     grep -c '^## \[' CHANGELOG.md                                    # releases shipped
     node --test scripts/conductor.test.mjs 2>&1 | grep '^ℹ tests'    # tests in the engine
     wc -l scripts/conductor.mjs                                      # engine LOC
     # external dependencies is always 0 — enforced by the zero-dependency hard constraint
     ```
     If a metric can't be recomputed this way (e.g. a historical count with no durable log to
     re-derive it from), don't estimate or carry it forward unverified — drop the row. A number
     that fails the "pulled from git log" claim the section itself makes doesn't belong in it,
     regardless of whether it was ever accurate.

5. **The `pm` repo's own branch dance.** Follow the `pr-workflow` skill — commit on `dev`, PR
   into `main`, wait for CI green, squash-merge, sync both branches. Never commit a version
   bump directly to `main` — this bit a session once already.

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
