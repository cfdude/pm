---
description: Initialize the PM conductor in this repo (scaffold state, register epics)
allowed-tools: Bash, Read, Edit
---

Initialize the `pm` conductor for the current project.

0. **Orient first (especially on a cold/first-time install).** Before scaffolding, load the
   **`conductor` skill** — it is the agent-facing how-to (the mental model, lanes, statuses, the
   detour → PUSH/POP → reconcile workflow, and the `state.json` reference). This is what lets you
   drive the plugin correctly even if you've never seen this version before. For deeper human
   reference, `${CLAUDE_PLUGIN_ROOT}/README.md` also ships with the plugin. (You do NOT need to
   re-read these every session — the persistent CLAUDE.md rules block written below carries the
   recurring essentials; this step is the one-time deep orientation.)

1. Run the engine's init (it creates `.conductor/state.json`, registers existing OpenSpec
   changes as untriaged epics, and renders `PROJECT.md`):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" init
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty, locate the engine first:
   `ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" init`

2. Read `.conductor/state.json` and help the user TRIAGE:
   - set `active` to the epic currently being built,
   - assign each epic a `priority` (P0–P3) and `status` (active | queued | later),
   - leave `detourStack` empty unless work is already paused.

3. **Offer external-tracker mirroring (optional).** Only if there is a *real* signal that work is
   actively managed in an issue tracker — a connected/in-use tracker MCP, issue-key conventions in
   history, or an explicit "we track work in X" note. **Being hosted on GitHub/GitLab/Bitbucket is
   NOT a signal** (every Git host has issues/PRs; hosting ≠ tracking there) — never infer a tracker
   from the remote. If there is a real signal, *offer it as a choice* and follow the `/pm:tracker`
   procedure on a yes. Make clear that saying no loses nothing: the conductor always tracks
   everything locally in `.conductor/state.json` + `PROJECT.md`; a tracker only *adds* an external
   mirror. Default to tracker-unaware.

4. Show the result with `/pm:status`.

Note: until this runs, the plugin's hooks stay dormant in this repo by design — like
`openspec init`. The conductor sits ABOVE OpenSpec and Superpowers; epics are lane-agnostic
(openspec | superpowers | claude-code | decision | external). It does not replace either.
