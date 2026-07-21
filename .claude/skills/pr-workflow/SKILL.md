---
name: pr-workflow
description: The dev→PR→CI→squash-merge→sync branch dance for the cfdude/pm repo. Use for ANY commit that needs to reach main — not just releases — since this repo's main is protected (no direct pushes, required "test" status check, required signatures). Referenced by release-checklist rather than duplicated there.
---

Repo-maintenance tooling for developing `pm` itself — not part of the product `pm` ships to
users. `main` on `cfdude/pm` is protected (see `CONTRIBUTING.md`): no direct pushes, the `test`
CI check required (strict — must be up to date with base), commit signatures required,
enforced on admins too, squash-merge only. This is the procedure that satisfies that setup
without a manual mistake — this session committed straight to `main` once before this skill
existed and had to be untangled after the fact.

## The procedure

1. **Work happens on `dev`.** Confirm you're there before committing:
   ```bash
   git branch --show-current   # must be "dev", never "main"
   ```
   If you're on `main` with uncommitted work, `git checkout dev` first — working-tree changes
   carry over cleanly since `dev` and `main` share history between releases.

2. **Tests green before committing.** `node --test scripts/conductor.test.mjs` — the
   `.githooks/pre-commit` hook re-runs this on every commit and blocks on failure, but don't
   rely on the hook alone catching a break you already know about.

3. **Commit on `dev`, push, open the PR:**
   ```bash
   git push origin dev
   gh pr create --repo cfdude/pm --base main --head dev --title "<title>" --body "<body>"
   ```

4. **Wait for CI with `Monitor`, never manual polling/sleeping:**
   ```bash
   prev=""
   while true; do
     s=$(gh pr checks <n> --repo cfdude/pm --json name,bucket 2>/dev/null)
     cur=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s" | sort)
     comm -13 <(echo "$prev") <(echo "$cur")
     prev=$cur
     jq -e 'length>0 and all(.bucket!="pending")' <<<"$s" >/dev/null 2>&1 && break
     sleep 15
   done
   echo "CI settled"
   ```

5. **Squash-merge once green** (never `--delete-branch` — `dev` is persistent, not a
   throwaway feature branch):
   ```bash
   gh pr merge <n> --repo cfdude/pm --squash --delete-branch=false
   ```

6. **Sync both local branches to the new `main` tip, and re-verify tests post-merge**
   (confirms the squash commit itself is sound, not just the pre-merge state):
   ```bash
   git checkout main && git fetch origin && git reset --hard origin/main
   node --test scripts/conductor.test.mjs
   git checkout dev && git reset --hard main && git push origin dev --force-with-lease
   ```
   `git reset --hard main` (not a plain `git merge`/`--ff-only`) is required here — after a
   squash-merge, `dev`'s and `main`'s histories have diverged (the squash commit has no common
   ancestor with `dev`'s pre-squash commits), so a fast-forward fails with "diverging branches."

## When this doesn't apply

A change that never needs to reach `main` (a scratch experiment, a throwaway branch you're
discarding) doesn't need this procedure. Everything that's meant to persist in `cfdude/pm`
does.
