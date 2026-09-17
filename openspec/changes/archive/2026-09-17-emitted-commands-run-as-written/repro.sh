#!/usr/bin/env bash
# Reproduces every defect cited in proposal.md against the engine at E. Hermetic git.
set -u
E=${E:-/Users/robsherman/Documents/Repos/pm/scripts/conductor.mjs}
export GIT_TEMPLATE_DIR="" GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false PM_QUIET_ENGINE_BANNER=1
# Scratch repos live OUTSIDE the pm checkout: set PM_REPRO_WORK to a scratch directory, or a fresh
# temp dir is used. Never point it inside the repository.
W="${PM_REPRO_WORK:-$(mktemp -d)}"; mkdir -p "$W"
case "$W" in "$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"*) echo "PM_REPRO_WORK is inside the repo"; exit 98;; esac
fresh() { rm -rf "$W/$1"; mkdir "$W/$1"; cd "$W/$1"; git init -q; git config user.name t; git config user.email t@t
  export CLAUDE_PROJECT_DIR="$PWD"; echo x > a; git add a; git commit -qm init || { echo "SETUP FAILED"; exit 99; }; node "$E" init >init.out 2>&1 || { echo "INIT FAILED"; exit 99; }; export CLAUDE_PROJECT_DIR="$PWD"; }
say() { echo; echo "### $*"; }

say "A1 init stderr names a hand-edit"; fresh a; rg "Triage epics" init.out

say "B1-B3 jira primary (both) + github-issues secondary: rules block"
fresh b
node "$E" set-tracker --system jira --project ABC --direction both >/dev/null 2>&1
node "$E" set-tracker --role secondary --system github-issues --repo cfdude/pm >/dev/null 2>&1
node "$E" rules 2>/dev/null > rules.txt
rg -n "gh issue list|add-epic --id|epic list|^5\. For every epic ALREADY|Secondary tracker sync|^4\. For every epic linked" rules.txt
say "B3 the jira recipe filled from key ABC-123"
node "$E" add-epic --id jira-abc-ABC-123 --title T --status untriaged --external-id ABC-123 --external-url https://x.atlassian.net/browse/ABC-123 --external-updated-at 2026-09-01T00:00:00Z --lane superpowers --priority P2 2>&1; echo "exit=$?"
say "B7 brief: mirror claim + never-re-read remedy"
node "$E" add-epic --id gh-cfdude-pm-189 --title T --status untriaged --external-id 189 --external-url https://github.com/cfdude/pm/issues/189 --external-updated-at 2026-09-01T00:00:00Z --lane superpowers --priority P2 >/dev/null 2>&1
node "$E" set-active gh-cfdude-pm-189 >/dev/null 2>&1
node "$E" add-epic --id local-one --title L --status queued --lane superpowers --priority P1 >/dev/null 2>&1
node "$E" update-epic local-one --external-id ABC-7 --external-url https://x.atlassian.net/browse/ABC-7 >/dev/null 2>&1
node "$E" brief --platform claude-code 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hookSpecificOutput.additionalContext))' | rg -n "TRACKER SYNC|mirrored|never re-read"
say "C gate forms taught by docs"
node "$E" record-gate-review local-one --gate 1 --verdict pass 2>&1; echo "gate1 (child doc form) exit=$?"
node "$E" record-gate-review local-one --gate 2 --verdict pass 2>&1; echo "gate2 (child doc / archive-gate remedy form) exit=$?"
H=$(git rev-parse HEAD); node "$E" record-gate-review local-one --gate 1 --verdict pass --base-sha $H --head-sha $H 2>&1; echo "gate1 sha-only (SKILL.md/review-mode.md form) exit=$?"
say "C review-mode.md says there is no unset"
node "$E" update-epic local-one --review-mode thorough >/dev/null 2>&1; node "$E" update-epic local-one --clear review-mode >/dev/null 2>&1; echo "clear exit=$?"; node -e 'const s=require("./.conductor/state.json");console.log("reviewMode after --clear:",JSON.stringify(s.epics.find(e=>e.id==="local-one").reviewMode))'

say "B4-B6 github-issues primary, inward only, repo with a shell metacharacter; then vendor switch"
fresh c
node "$E" set-tracker --system github-issues --repo 'a/b; touch pwned' --direction inward 2>&1; echo "exit=$?"
node "$E" rules 2>/dev/null | rg -n "gh issue list|Sync after completing|writeback steps above|Completion status writeback"
node "$E" set-tracker --system jira --project ABC 2>&1; echo "exit=$?"
node "$E" rules 2>/dev/null | rg -n "Inward tracker sync|add-epic --id"
node "$E" set-tracker --remove >/dev/null 2>&1; echo "primary --remove exit=$?"; node -e 'console.log("tracker after primary --remove:",JSON.stringify(require("./.conductor/state.json").tracker))'
node "$E" set-tracker --system jira --project ABC --intent badpair >/dev/null 2>&1; echo "--intent badpair exit=$?"
say "gh default page size"; gh issue list --help 2>&1 | rg "limit"

say "D1-D2 integrity remedy for an openspec release member, and the refusal's own remedy"
fresh d
node "$E" add-epic --id cc-one --title cc --lane claude-code --status queued --priority P2 >/dev/null 2>&1
node "$E" add-epic --id os-two --title os --lane openspec --status queued --priority P2 >/dev/null 2>&1
node "$E" release r1 --intent rel --member cc-one --member os-two >/dev/null 2>&1
node "$E" update-epic cc-one --status archived --outcome delivered --no-deferrals >/dev/null 2>&1
node "$E" integrity 2>&1 | rg "os-two"
node "$E" update-epic os-two --status archived --outcome delivered --no-deferrals 2>&1; echo "integrity remedy exit=$?"
node "$E" record-gate-review os-two --gate 2 --verdict pass 2>&1; echo "archive-gate remedy exit=$?"

say "D3 unconsidered-outcomes offers delivered for an openspec-lane epic with no Gate 2 (#189)"
node --input-type=module -e '
import fs from "node:fs";
import { engineStamp } from "'"$(dirname "$E")"'/lib/disposition.mjs";
const p = ".conductor/state.json"; const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.epics.push({ id: "old-os", title: "old", priority: "P2", status: "archived", role: "epic", lane: "openspec", stories: [], links: [], disposition: engineStamp("migration", { recordedAt: "2026-08-01T00:00:00.000Z" }) });
fs.writeFileSync(p, JSON.stringify(s, null, 2));'
node "$E" unconsidered-outcomes 2>/dev/null | rg '"invocation"'
node "$E" update-epic old-os --status archived --outcome delivered --reason shipped --no-deferrals 2>&1; echo "delivered exit=$?"

say "B8 outward-only primary + secondary: the never-re-read count, what /pm:sync cannot clear, and what does"
fresh e
node "$E" set-tracker --system jira --project ABC --direction outward >/dev/null 2>&1
node "$E" set-tracker --role secondary --system github-issues --repo cfdude/pm >/dev/null 2>&1
node "$E" add-epic --id local-one --title L --status queued --lane superpowers --priority P1 >/dev/null 2>&1
node "$E" update-epic local-one --external-id ABC-7 --external-url https://x.atlassian.net/browse/ABC-7 >/dev/null 2>&1
tb() { node "$E" brief --platform claude-code 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).hookSpecificOutput.additionalContext;const i=c.indexOf("TRACKER SYNC");console.log(i<0?"(no TRACKER SYNC block)":c.slice(i,c.indexOf("\n\n",i)))})'; }
echo "before:"; tb
node "$E" rules 2>/dev/null | rg "^## " | rg -i "sync" | sed 's/^/rules-block sync heading: /'
node "$E" record-tracker-refresh local-one --verdict unchanged --external-updated-at 2026-09-01T00:00:00Z >/dev/null 2>&1; echo "record-tracker-refresh exit=$?"
echo "after:"; tb
say "gh accepts --limit 1000"; gh issue list --repo cfdude/pm --state all --limit 1000 --json number 2>&1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("items returned:",JSON.parse(s).length))'

say "B9 legacy github-issues primary with no recorded direction, switched to jira"
fresh f
node --input-type=module -e 'import fs from "node:fs"; const p=".conductor/state.json"; const s=JSON.parse(fs.readFileSync(p,"utf8")); s.tracker={system:"github-issues",repo:"o/n"}; fs.writeFileSync(p, JSON.stringify(s,null,2));'
node "$E" rules 2>/dev/null | rg "^## .*[Ss]ync" | sed 's/^/before: /'
node "$E" set-tracker --system jira --project ABC 2>&1 | tail -1
node -e 'console.log("tracker:", JSON.stringify(require("./.conductor/state.json").tracker))'
node "$E" rules 2>/dev/null | rg "^## .*[Ss]ync" | sed 's/^/after: /'
