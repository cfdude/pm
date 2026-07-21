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

4. **Mintlify site — content pages** (`pm-plugin.dev`, deployment `onvex-ai`, content repo
   `cfdude/pm-docs`). Use the Mintlify MCP, not manual git commits against `pm-docs` — `checkout`
   opens an isolated session/branch; `read`/`search`/`list_nodes` find affected pages under
   `commands/`, `concepts/`, or `guides/`; `edit_page`/`write_page` make the change; `save` (mode
   `pr`) opens the PR. Mirror whatever changed in `commands/*.md`/`README.md` into the matching
   `.mdx` page(s) — check with `search` for the old wording so nothing is missed.

5. **Mintlify site — the Changelog page** (`/changelog`, under Guides). Prepend the new
   version's entry — same content as the `CHANGELOG.md` section just written, converted to
   MDX. **Escaping gotcha:** any bare `<placeholder>` syntax outside a backtick code span (e.g.
   `<=3 files`, a stray `<id>` not in a code span) breaks MDX's JSX parser (`mdx_parse_failure:
   Unexpected character` errors). Inside a single- or multi-line backtick span, `<...>` is
   always safe — MDX never parses code-span content as JSX. Before pasting a large changelog
   chunk into `write_page`, check for bare angle brackets:
   ```python
   import re
   parts = text.split("`")
   for i in range(0, len(parts), 2):        # even indices = outside any code span
       for m in re.finditer(r'<[^<>\n`]+>', parts[i]):
           print(m.group())                  # wrap each hit in backticks before pasting
   ```

6. **Mintlify site — Introduction's "Real Numbers" section.** This table claims to be
   mechanically derived — keep that true every release by recomputing, never estimating:
   ```bash
   grep -c '^## \[' CHANGELOG.md                                    # releases shipped
   node --test scripts/conductor.test.mjs 2>&1 | grep '^ℹ tests'    # tests in the engine
   wc -l scripts/conductor.mjs                                      # engine LOC
   # external dependencies is always 0 — enforced by the zero-dependency hard constraint
   ```
   If a metric can't be recomputed this way (e.g. a historical "N agents dispatched" count with
   no durable log to re-derive it from), don't estimate or carry it forward unverified — drop
   the row. A number that fails the "pulled from git log" claim the section itself makes doesn't
   belong in it, regardless of whether it was ever accurate.

7. **Merge every Mintlify PR live in the same pass — never leave it open.**
   `gh pr merge <n> --repo cfdude/pm-docs --squash --delete-branch=false`, then verify the
   actual content is live:
   ```bash
   curl -s "https://pm-plugin.dev/<page>" | grep -i "<new content marker>"
   ```
   Allow ~1-2 min for edge-cache propagation (Mintlify's own CDN, not anything on this user's
   Cloudflare account) before concluding a miss is a real failure rather than lag.

8. **Clean up merged Mintlify branches.** Each `checkout` creates an `admin-mcp/<slug>-<sha>`
   branch on `pm-docs` that a squash-merge with `--delete-branch=false` leaves behind — these
   show up as unpublished-looking "branch drafts" in the Mintlify dashboard even though their
   content is live. After confirming a PR's content is live:
   ```bash
   gh api -X DELETE "repos/cfdude/pm-docs/git/refs/heads/<branch-name>"
   ```

9. **The `pm` repo's own branch dance** (`CONTRIBUTING.md`): commit on `dev`, push, open a PR
   into `main`, wait for CI green (`Monitor`, not manual polling/sleeping), squash-merge, then
   sync:
   ```bash
   git checkout main && git fetch origin && git reset --hard origin/main
   node --test scripts/conductor.test.mjs   # confirm green post-merge too
   git checkout dev && git reset --hard main && git push origin dev --force-with-lease
   ```
   Never commit a version bump directly to `main` — this bit a session once already.

10. **If this repo's own `.conductor/state.json` needs a state-only update** (marking a story
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
