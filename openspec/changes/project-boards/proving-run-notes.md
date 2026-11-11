# Proving run (task 7.1), 2026-11-11

Built pm-dev's two boards from `skills/project-boards/SKILL.md` as written.

- Backlog: https://claude.ai/artifact/96Suu2a3cnqFjRQ19b62vc (108 docs: 87 epics, 20 releases, `page/info`)
- Release plan: https://claude.ai/artifact/FrEqabKJZPUiSUYeAXSRvB (109 docs: the same plus `plan/state`)
- Both private. Mission is unset in pm-dev, so the release plan shows releases only; no mission was invented for the run.

## Page-written collections (declared rules)

Exactly `answers` and `backlogMeta` at `interact`, plus `proposals` (`rank`) at `admin`. Every other collection is `admin`.

## ArtifactData checks (as_level)

| Artifact | Probe | Result |
| --- | --- | --- |
| backlog | `backlogMeta` set/delete at interact | allowed |
| backlog | `epics` set at interact | refused |
| backlog | `proposals/rank` set at interact | refused |
| backlog | `backlogMeta` set at view | refused |
| release plan | `answers` set/delete at interact | allowed |
| release plan | `decisions` set at interact | refused |

Listing `epics` and `releases` returned 87 and 20 on both boards. A `proposals` list at a lower level reads empty, so it cannot tell a refused read from an empty collection; the set probe is the evidence.

## Instructions that did not run as written (filings, R.7)

1. The skill says "write in batches of at most 50" and gives no way to supply 108 documents. One inline batch of 50 is about 12 KB of tool input. The run used a local JSON file per document (`file_path` on each write) and had a subagent apply six batches. The skill should say this.
2. `board --json` prints an `engine ... @` line to stderr; piping stdout alone is fine, but the skill's fallback one-liner reads stdout only, so it works. No change needed.
3. `set-active` demoted the previously active epic to `queued` and made release 0.54.0 look delivered (seven false `delivered-release-epic-left-open` findings). Not a skill instruction, but tooling friction hit during the build; file as pm feedback.
