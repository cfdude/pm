---
lesson: tcc-denial-breaks-getcwd
date: 2026-08-26
trigger: Tooling suddenly fails everywhere under one directory tree — `EPERM`/`uv_cwd`, "getcwd: cannot access parent directories", a shell that hangs at startup, or a builtin producing no output — while single file reads still work.
cost: An hour of misdiagnosis today, and it is the leading candidate for the earlier machine freeze that cost two worktree agents and ~40 minutes of recovery, and that was written up as undiagnosable.
rule: Before blaming the tool, probe getcwd and directory-listing at each level of the path. A macOS TCC denial on a protected folder breaks every process that needs an absolute path under it, and the responsible app is the process parented to launchd — usually tmux, not the terminal.
enforced_in: habit — the four-probe table below; no mechanism
tags: [macos, tcc, permissions, outage, false-signal]
---

**Cause.** macOS TCC gates the protected folders — Documents, Desktop, Downloads — per *responsible
process*. A denial does not block file access by path. It blocks `opendir`/`readdir`, and that
breaks `getcwd()`, which walks upward through the parents to build an absolute path. So:

| Operation | Under a denied folder |
|---|---|
| `test -f /abs/path` | works |
| `cat /abs/path` | works |
| `ls <dir>` | **denied** |
| `getcwd()` | **denied** — and therefore `node`, `git`, `python` all die at startup |

`node` fails with `EPERM: process.cwd failed … uv_cwd`. `git` fails with *"Unable to read current
working directory"* — even `git -C`, which calls `getcwd` before honouring `-C`. The shell prints
`shell-init: error retrieving current directory` on every invocation.

**Why it reads as anything but permissions.** Individual file reads keep working, so the tree looks
healthy. `cd` returns 0. Zsh's `pwd` builtin answers from `$PWD` and looks right. Only a real
`getcwd()` tells the truth.

**The probe that settles it in one command** — run it at each level, and read where the boundary is:

```sh
for d in ~/Documents/Repos/pm ~/Documents/Repos ~/Documents ~/Servers; do
  printf '%-40s %s\n' "$d" "$( (cd "$d" && /usr/bin/python3 -c 'import os;print("OK",os.getcwd())') 2>&1 | tail -1 )"
done
```

**Find the responsible app by walking to launchd.** TCC attributes to the ancestor whose parent is
pid 1, which under a multiplexer is **tmux**, not iTerm2 or Terminal:

```sh
p=$PPID; while l=$(ps -o pid=,ppid=,comm= -p "$p"); do echo "$l"; p=$(echo "$l"|awk '{print $2}'); [ "$p" = 1 ] && break; done
```

**Fix.** Grant that binary Full Disk Access — more durable than the per-folder toggle, which a
Homebrew version bump can strand when the symlink repoints to a new Cellar path. **The grant takes
effect live; no restart is needed** — verified by re-running the probe immediately after. Avoid
`tccutil reset SystemPolicyDocumentsFolder`: an unbundled binary has no bundle id, so the reset can
only be global and clears every app's decision.

**The trigger nobody sees.** An agent working under a protected folder springs the prompt on
whoever is at the keyboard. Answered "Don't Allow" — deliberately, or while debugging something
else — the denial is durable and silent. **A blocked, unanswered prompt also blocks the process**,
which is what a shell hanging with no output looks like from the inside.

That last point revises [[worktrees-with-claude-agents]], which recorded its outage as
undiagnosable. This is a candidate that fits every symptom it lists — a shell builtin producing
zero bytes for 140 seconds, git unable to clear a lock — and it is not worktrees. Not proven for
that incident; nothing recorded whether a prompt was pending. Probe before theorising next time.
