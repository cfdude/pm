#!/usr/bin/env bash
# One JSONL line per event, into the MAIN checkout so every worktree agent writes to one place.
#
# Exists because the previous multi-agent run produced a machine freeze that could not be
# diagnosed afterwards: nothing recorded what each agent was doing at the moment it stopped. The
# leading explanation turned out to be a denied macOS TCC prompt
# (docs/lessons/tcc-denial-breaks-getcwd.md), which is invisible in a transcript and obvious in a
# log that stamps cwd and a getcwd probe.
#
# usage: scripts/agent-log.sh <agent-id> <event> [detail]
set -euo pipefail
id="${1:?agent id}"; event="${2:?event}"; detail="${3:-}"
# --git-common-dir resolves to the MAIN .git from inside a worktree, so all agents converge here.
root="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
dir="$root/.conductor/agent-logs"; mkdir -p "$dir"
# A getcwd probe on every line: the failure mode this log exists for shows up as EPERM here
# while every other field still looks healthy.
cwd="$(/usr/bin/python3 -c 'import os;print(os.getcwd())' 2>&1 | tail -1)"
esc() { printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'; }
printf '{"at":"%s","agent":%s,"event":%s,"detail":%s,"pid":%s,"cwd":%s,"branch":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(esc "$id")" "$(esc "$event")" "$(esc "$detail")" \
  "$$" "$(esc "$cwd")" "$(esc "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')")" \
  >> "$dir/$id.jsonl"
