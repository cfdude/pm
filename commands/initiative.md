---
description: Record an initiative (a multi-release effort delivering a capability), its initiative milestones and non-goals; read them back with `initiative show`
allowed-tools: Bash, Read
---

An **initiative** is a multi-release effort that delivers a valuable capability. It sits between the mission and the releases:
Mission > Initiative > Milestone > Release > Epic. It owns **initiative milestones** (notable achievements outside any single
release) and is the unit a roadmap prioritizes. The engine never writes an initiative it was not given: it stores what a
person or an agent says one is, with where it came from, and it is never deleted. Ending one records a work disposition.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" initiative <id> --title "<line>" --capability "<line>" [--source "<line>"]
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" initiative show [<id>] [--history]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" initiative show`

"Initiative milestone" is the name for a milestone that lives inside an initiative. A milestone cannot exist without one. It is
not the 0.55.0 mission milestone (a release) and not a plan's story milestones, so every surface says "initiative milestone".

| Operation | Effect | Its inverse |
| --- | --- | --- |
| `<id> --title "<line>" --capability "<line>"` | creates the initiative (both flags required; the id is an epic-style id; `show` is reserved). On an existing id either flag replaces its value. Title: one line, at most 200 characters; capability (the valuable capability it delivers): at most 400 | a new value (neither is clearable: both are required on create) |
| `--source "<line>"` | where the initiative was derived from, at most 300 characters. The literal `UNGROUNDED` is accepted: the agent could not ground it in the backlog, docs or issues | `--clear source` |
| `--off-mission-reason "<line>"` | the recorded answer to "does this serve the mission?", at most 300 characters. An initiative is challenged against the mission once | `--clear off-mission-reason` |
| `--add-milestone "<line>"` | appends an initiative milestone with the next stable id (`m1`, `m2`, ...), never reused. It carries no release | `--remove-milestone "mN:<why>"` (marks it removed, keeps it) |
| `--reach-milestone "mN:<evidence>"` | records the milestone reached, with the time and one line of evidence. No mechanical check decides it | `--unreach-milestone "mN:<why>"` (the human override; both events are kept) |
| `--add-non-goal "<line>"` | records something this initiative will not do (repeatable). See the `non-goals` shape in `commands/mission.md` | `--remove-non-goal "nN:<why>"` |
| `--end --outcome delivered\|abandoned\|superseded --reason "<why>"` | sets the status to `ended` and appends the event to the history. Refused when already ended. References to it stay | `--reopen --reason "<why>"` (status `open`, outcome and end time cleared, a `reopened` event appended) |

The `mN:<why>` and `nN:<why>` forms split at the first colon and are **not repeatable**, so one reason never covers two records.
`--reason` serves only `--end` and `--reopen`, and an ending or a reopening takes no other operation in the same call. Every
refusal writes nothing, and every value is checked before any write.

`initiative show` lists every initiative (`no initiatives` when none), `initiative show <id>` prints every field, its active
initiative milestones and non-goals, and `--history` adds the lifecycle events, removed milestones and removed non-goals. An
unknown id is refused. `show` writes nothing.

**Deriving initiatives.** Do not ask the user to name one. The `project-boards` skill's "First population" clusters the backlog,
docs and issues into candidates, records each `--source` (or `UNGROUNDED`), asks "Does this make sense?" and writes only what
was confirmed.

While at least one initiative is open the managed rules block carries a short `## Initiatives` section naming the challenge-once
rule. `board --json` carries `initiatives`; `integrity` reports an epic or release naming an initiative the record does not hold.
