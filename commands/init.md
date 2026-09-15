---
description: Initialize the PM conductor in this repo (scaffold state, register epics)
allowed-tools: Bash, Read, Edit
---

Initialize the `pm` conductor for the current project.

0. **Orient first (especially on a cold/first-time install).** Before scaffolding, load the
   **`conductor` skill** — it is the agent-facing how-to (the mental model, lanes, statuses, the
   detour → PUSH/POP → reconcile workflow, and the `state.json` reference). This is what lets you
   drive the plugin correctly even if you've never seen this version before. For deeper human
   reference, `${CLAUDE_PLUGIN_ROOT}/README.md` also ships with the plugin. If you need more than
   either of those covers, `https://pm-plugin.dev/llms.txt` is a lightweight, AI-agent-oriented
   index of every doc page (~7KB) — fetch `https://pm-plugin.dev/llms-full.txt` only if you
   genuinely need the entire site as one document (~200KB, tens of thousands of tokens; use
   sparingly). (You do NOT need to re-read any of these every session — the persistent CLAUDE.md
   rules block written below carries the recurring essentials; this step is the one-time deep
   orientation.)

1. Run the engine's init (it creates `.conductor/state.json`, registers existing OpenSpec
   changes as untriaged epics, and renders `PROJECT.md`):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" init
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty, locate the engine first:
   `ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" init`

   `init` takes no positional arguments and one flag of its own, `--platform
   <claude-code|hermes|codex>` (see `/pm:upgrade`), plus the `--force` every mutating verb accepts. A valueless or unknown `--platform`, or any other flag, is refused before
   anything is created, so a failed `init` leaves no `.conductor/` behind to end pm's dormancy:
   `conductor: --platform must be one of claude-code|hermes|codex`. `init --help` prints its flags
   and creates nothing.

   **`init` refuses, with exit 11 and nothing written, in two more cases** — both mean a file it
   depends on is in a state the engine will not guess about, and a human fixes the file:

   - **`.conductor/state.json` exists but cannot be read** (conflict markers, truncation, the
     wrong shape). `init` loads it before its first write, so it never writes over, beside or
     around it — not even `.gitignore`. The refusal names the reason and the remedies (see
     `/pm:gate-guard` for the full message). For a file git has never had, move it aside and
     re-run: `mv .conductor/state.json .conductor/state.json.damaged`, then `/pm:init`.
   - **The rules file's managed-block markers are ambiguous.** A BEGIN marker line with no END, an
     END with no BEGIN, or two blocks. Markers are whole lines — a marker string quoted in prose or
     inline code is ordinary text. The check runs before anything is created, so a fresh repo gets
     no `.conductor/`:

     ```text
     conductor: refused to write the pm rules block into CLAUDE.md — its marker lines are not exactly one BEGIN line followed by one END line, so which text is managed cannot be known:
       line 3: BEGIN
       Delete the stray marker line(s) from the shell, highest line number first, e.g.:
         sed -i.bak '<N>d' CLAUDE.md
       (a whole managed block is safe to delete; hand-written text between markers is yours to keep).
       Nothing was written. After fixing the markers, re-run the command.
     ```

     Delete the stray lines by hand, then run `init` again.

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
