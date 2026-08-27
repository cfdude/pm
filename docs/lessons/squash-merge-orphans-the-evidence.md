---
lesson: squash-merge-orphans-the-evidence
date: 2026-08-27
trigger: About to squash-merge a PR in any repo whose records reference commit shas — an attribution array, a review verdict's range, a changelog entry, a design doc citing "fixed in <sha>".
cost: 36 recorded shas orphaned across two releases — every attributed commit and every gate verdict's range in this repo. Recovered only because `git gc` had not run yet; two PRs' history was already gone for good. The verdicts read perfectly the whole time.
rule: Tag the pre-squash tip and push the tag BEFORE merging. A squash-merge makes every commit on the branch reachable from nothing, and `gc` deletes them by default two weeks later — from every clone, permanently.
enforced_in: .claude/skills/pr-workflow/SKILL.md step 5 + step 8 verification; CONTRIBUTING.md § Branch workflow
detect: {"tool":"Bash","commandMatches":"gh pr merge .*--squash"}
tags: [git, verification, false-signal, evidence, process]
---

**Cause.** A squash-merge produces ONE commit on `main` whose only parent is `main`'s previous
tip. The branch's own commits are not parents of anything. They are reachable from no ref the
moment the branch is deleted — alive only in whichever clone happened to create them, until that
clone runs `gc` (default `gc.pruneExpire` two weeks, `gc.reflogExpireUnreachable` 30 days).

**Why it is worse than losing history.** Losing history is visible. This is not. A record that
names an orphaned sha still renders, still reads as evidence, and still passes every check —
because the honest way to handle "git cannot answer" is to treat it as *unknown* rather than
*false*, so a three-valued ancestry check goes quiet exactly when the commits vanish. The record
degrades from *verifiable* to *unfalsifiable* and says nothing about it.

Measured here: `.conductor/state.json` held 36 shas — `attributedCommits` on every epic and
`baseSha`/`headSha` on every gate verdict. After two releases, **all 36 were unreachable.** The
integrity suite was green throughout. The 0.27.0 verdict claiming "fresh-context review over
`d168b1e..04c54c8`" was a sentence about two commits nobody could look at.

**The fix costs one ref.**

```sh
git tag presquash/pr-<n> "$(gh pr view <n> --json headRefOid --jq .headRefOid)"
git push origin presquash/pr-<n>
```

`main`'s linear history is unchanged — that is the whole reason to squash, and the tag does not
touch it. Do it *before* merging, as part of the merge step, not as cleanup.

**Recovery, while it is still possible.** The forge remembers what the local repo forgot: a
merged PR's `headRefOid` survives on the PR record indefinitely. So every orphaned range is
recoverable until `gc` runs.

```sh
gh pr list --state merged --limit 100 --json number,headRefOid \
  --jq '.[] | "\(.number)\t\(.headRefOid)"' |
  while IFS=$'\t' read -r n sha; do
    git rev-parse --verify -q "$sha^{commit}" >/dev/null && git tag -f "presquash/pr-$n" "$sha"
  done
git push origin --tags
```

Run on this repo it recovered 58 of 60 PRs. The two it could not were CI-bump PRs merged four
weeks earlier, carrying nothing anything referenced — luck, not design.

**The generalizable shape.** *A record that points at something outside itself has a lifetime,
and it is the lifetime of the thing pointed at, not of the record.* Ask what deletes the target
and on what schedule. Here the answer was `gc`, on a two-week timer nobody set or thought about.
See [[local-only-git-objects]] — same mechanism one layer down, where it broke CI instead of
evidence, and [[hardcoded-live-data-claims-rot]] — same family, a claim outliving what made it true.
