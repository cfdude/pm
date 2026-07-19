## 1. Schema + state helpers

- [x] 1.1 Write failing tests for `state.secondaryTrackers` upsert semantics using the
      namespace-prefixed key (`system:repo:<repo>` / `system:project:<projectKey>`): add new
      entry; merge into existing entry matched by the prefixed key; two distinct `repo` entries
      coexist; a `repo`-keyed and a `projectKey`-keyed entry with the same string value do NOT
      collide — in `scripts/conductor.test.mjs`
- [x] 1.2 Write failing tests confirming a `state.json` without `secondaryTrackers` loads and
      behaves exactly as today (no secondary trackers = current behavior, byte-for-byte)
- [x] 1.3 Add a small internal helper (e.g. `upsertSecondaryTracker(state, entry)`) implementing
      the namespace-prefixed-key upsert described in design.md Decision 2; make 1.1/1.2 pass
- [x] 1.4 Write failing tests for the `add-epic`/tracker-sync duplicate check: dedup matches on
      `externalUrl` when present on both sides; falls back to bare `externalId` only when neither
      side has a URL; two epics with the same bare `externalId` but different `externalUrl`
      values (e.g. issue `#42` in two different secondary-tracker repos) do NOT collide
- [x] 1.5 Update the duplicate-check logic in `addEpic()` to match Decision 5's `externalUrl`-first
      rule; make 1.4 pass

## 2. `set-tracker` CLI

- [x] 2.1 Write failing tests: `set-tracker` with no `--role` (and with `--role primary`) writes
      `state.tracker` exactly as today, `secondaryTrackers` untouched
- [x] 2.2 Write failing tests: `set-tracker --role secondary --system ... --repo ...` (or
      `--project`, matching the primary tracker's existing flag name — not a new `--project-key`)
      appends/merges into `secondaryTrackers`, `state.tracker` untouched
- [x] 2.3 Write failing tests: `set-tracker --role secondary ... --remove` deletes the matching
      entry and exits 0; `--remove` against a key with no matching entry exits non-zero with a
      clear "no matching secondary tracker" message and leaves `secondaryTrackers` unchanged
- [x] 2.4 Implement `--role` and `--remove` flag parsing in the `set-tracker` subcommand; make
      2.1-2.3 pass

## 3. Rules-block generation

- [x] 3.1 Write failing tests asserting `rulesBlock()` emits, for each entry in
      `secondaryTrackers`, an inward-pull section (dedup-by-`externalUrl`, same shape as today's
      `github-issues` block) plus a new status-writeback-on-archive instruction section that
      matches epics by `externalUrl` containing that entry's `repo` (or `instance`+`projectKey`)
- [x] 3.2 Write failing tests confirming the existing primary-tracker rules-block output
      (including the `github-issues`-as-primary suppression special case) is byte-for-byte
      unchanged when `secondaryTrackers` is empty/absent
- [x] 3.3 Thread a third parameter (`secondaryTrackers`, default `[]`) through `rulesBlock()`'s
      signature, and update both existing call sites (`writeRules()` and the `rules` CLI
      dispatch) to pass `currentSecondaryTrackers()` alongside `currentTracker()` — per
      design.md Decision 4
- [x] 3.4 Generalize the `github-issues`-specific inward-pull block in `rulesBlock()` into a loop
      over `secondaryTrackers`, parameterized by each entry's `system`/`repo`; add the new
      status-writeback instruction text; make 3.1-3.2 pass

## 4. Full-suite verification

- [x] 4.1 Run `node --test scripts/conductor.test.mjs`, confirm 100% pass including all new and
      pre-existing tests
- [x] 4.2 Manually exercise `set-tracker --role secondary` end-to-end against this repo's own
      `.conductor/state.json` in a scratch copy (not committed) to confirm the generated CLAUDE.md
      rules block reads correctly for a human

## 5. Documentation currency

- [x] 5.1 Update `commands/tracker.md`: document `--role primary|secondary`, `--remove`, the
      upsert key, and the new status-writeback behavior
- [x] 5.2 Update `skills/conductor/SKILL.md`'s Commands section to describe `--role`/`--remove`
      and the secondary-tracker concept. Note: the existing SKILL.md/README drift tests only
      assert that the `set-tracker` *subcommand name* is mentioned (they don't parse individual
      flags), so this is a manual documentation step, not something task 4.1's suite enforces —
      do not rely on CI to catch a missed update here
- [x] 5.3 Update `README.md`'s tracker section per this repo's standing documentation-currency
      rule: primary vs. secondary, the Jira-primary + GitHub-secondary example from this change's
      motivation
- [x] 5.4 Update Mintlify docs (`onvex-ai` deployment): `commands/tracker.mdx`,
      `guides/external-trackers.mdx`, and any `concepts/` page describing tracker sync — via
      `checkout` → `edit_page`/`write_page` → `save` (mode `pr`, left for human review per this
      repo's standing rule)
- [x] 5.5 Add a `.changesets/multi-tracker-primary-secondary-support.md` fragment describing the
      change for the next `CHANGELOG.md` consolidation; bump `.claude-plugin/plugin.json` version

## 6. Gate 2 review

- [ ] 6.1 Run a fresh-context implementation review (per this repo's `standard` review mode) over
      the full diff before archiving; record the verdict with `record-gate-review
      multi-tracker-primary-secondary-support --gate 2 --verdict pass|fail`
