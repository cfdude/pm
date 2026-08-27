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

2. **Tests green before committing.** `node --test scripts/test/*.test.mjs` — the
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

5. **Tag the pre-squash tip BEFORE merging, and push the tag.** This step is not optional and
   not bookkeeping — skipping it destroys evidence:
   ```bash
   git tag presquash/pr-<n> "$(gh pr view <n> --repo cfdude/pm --json headRefOid --jq .headRefOid)"
   git push origin "presquash/pr-<n>"
   ```
   A squash-merge collapses every commit on the branch into ONE commit on `main` whose only
   parent is `main`'s previous tip. The branch's own commits become reachable from **nothing**.
   They survive in the local object store until the next `git gc` — default prune expiry is two
   weeks — and then they are gone, from every clone, permanently.

   That matters here specifically because **`.conductor/state.json` records commit shas**:
   `attributedCommits` on every epic, and `baseSha`/`headSha` on every gate verdict. Those are
   the entire evidence base for "this Gate 2 reviewed that range." Orphan the commits and the
   record still *reads* fine while being unverifiable by anyone, on any machine — the exact
   failure mode 0.27.0 was built to eliminate, reintroduced by the merge step. Measured on this
   repo: **36 recorded shas, all of them orphaned**, recovered only because `gc` had not yet run.

   The tag makes the whole range reachable forever, costs one ref, and changes nothing about
   `main`'s linear history. Do it before the merge, while `gh pr view` can still tell you the
   head — after the branch is deleted the head oid is still on the PR record, but there is no
   reason to rely on that.

6. **Squash-merge once green** (never `--delete-branch` — `dev` is persistent, not a
   throwaway feature branch):
   ```bash
   gh pr merge <n> --repo cfdude/pm --squash --delete-branch=false
   ```

7. **Sync both local branches to the new `main` tip, and re-verify tests post-merge**
   (confirms the squash commit itself is sound, not just the pre-merge state):
   ```bash
   git checkout main && git fetch origin && git reset --hard origin/main
   node --test scripts/test/*.test.mjs
   git checkout dev && git reset --hard main && git push origin dev --force-with-lease
   ```
   `git reset --hard main` (not a plain `git merge`/`--ff-only`) is required here — after a
   squash-merge, `dev`'s and `main`'s histories have diverged (the squash commit has no common
   ancestor with `dev`'s pre-squash commits), so a fast-forward fails with "diverging branches."

8. **Verify every recorded sha is still reachable.** One command; it is the check the tag
   exists to satisfy, and running it is how you find out the tag step was missed:
   ```bash
   python3 - <<'EOF'
   import json, subprocess
   st = json.load(open(".conductor/state.json"))
   shas = [(e["id"], s) for e in st["epics"] for s in (e.get("attributedCommits") or [])]
   shas += [(f'{e["id"]} {g}.{k}', v[k])
            for e in st["epics"] for g in ("gate1", "gate2")
            for v in [(e.get("gateReview") or {}).get(g) or {}]
            for k in ("baseSha", "headSha") if v.get(k)]
   bad = [(i, s) for i, s in shas
          if not subprocess.run(["git", "for-each-ref", "--contains", s],
                                capture_output=True, text=True).stdout.strip()]
   print(f"{len(shas)} recorded shas, {len(bad)} unreachable")
   for i, s in bad: print("  UNREACHABLE", i, s)
   EOF
   ```
   Anything unreachable is recoverable **only** until the next `gc`. Recover it from the PR
   record — `gh pr list --state merged --json number,headRefOid` — and tag it now, not later.

## When this doesn't apply

A change that never needs to reach `main` (a scratch experiment, a throwaway branch you're
discarding) doesn't need this procedure. Everything that's meant to persist in `cfdude/pm`
does.
