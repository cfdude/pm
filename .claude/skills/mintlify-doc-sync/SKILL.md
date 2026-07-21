---
name: mintlify-doc-sync
description: Update pm-plugin.dev (the Mintlify docs site) for any user-visible change, merge it live, and clean up — not just at release time. Use whenever README.md/commands/*.md changes and the mirrored Mintlify content needs to follow in the same PR cycle.
---

Repo-maintenance tooling for developing `pm` itself — not part of the product `pm` ships to
users. This is the procedure `release-checklist` and `CLAUDE.md`'s "Documentation currency"
rule both point at, factored out because it fires far more often than releases do — any PR
that changes README.md or a `commands/*.md` doc needs this too.

## Before you start — is this actually a release?

**If the change you're syncing includes a `.claude-plugin/plugin.json` version bump, this
skill alone is not enough.** Check first — don't just run this procedure and call it done.
This exact gap caused the live Changelog page to be missed for three consecutive releases in a
row (0.21.0, 0.21.1, then 0.22.0 again) before this warning existed: it's easy to sync the
*content* pages for a change and forget that a version bump also obligates the Changelog page
and Introduction's Real Numbers — those live under `release-checklist`, not here, because
they're release-specific, not general content-sync. If `plugin.json`'s version changed,
follow `release-checklist` in full (it calls back into this skill for the mechanics); don't
stop at this skill's steps alone.

## The procedure

1. **Checkout a fresh editing session.** Always check out fresh per logical change — a stale
   session (e.g. one whose branch was already merged and deleted) fails with
   `no_editor_metadata` or `Editor navtree doesn't exist`; re-checkout rather than debugging a
   dead session:
   ```
   mcp__Mintlify__checkout({ subdomain: "onvex-ai", slug: "<kebab-case-slug>" })
   ```

2. **Find every affected page.** Use `search` for the old wording (not just the obvious page) —
   a rename or behavior change can be mirrored on more than one guide/command page:
   ```
   mcp__Mintlify__search({ query: "<old phrase>" })
   mcp__Mintlify__list_nodes({ recursive: true })   # if you need the nav tree to find a page id
   ```

3. **Edit with `edit_page` (string-replace) for small changes, `write_page` (full overwrite)
   for large ones** (e.g. a full changelog-mirror page). `path` is the page's nav `href` —
   **no `.mdx` extension, no leading slash** (`commands/tracker`, not `/commands/tracker.mdx`);
   using the file-path-style form fails with `page_not_found`.

4. **MDX escaping gotcha — check before pasting large chunks.** A bare `<placeholder>` outside
   a backtick code span (e.g. `<=3 files`, a stray `<id>`) breaks MDX's JSX parser
   (`mdx_parse_failure: Unexpected character`). Inside a single- or multi-line code span,
   `<...>` is always safe. Before a large paste, scan for real offenders (split on backticks
   globally, not per-line — a code span can cross line breaks):
   ```python
   import re
   parts = text.split("`")
   for i in range(0, len(parts), 2):        # even indices = outside any code span
       for m in re.finditer(r'<[^<>\n`]+>', parts[i]):
           print(m.group())                  # wrap each hit in backticks before pasting
   ```

5. **Save as a PR, merge it live in the same pass — never leave it open for later review:**
   ```bash
   # mcp__Mintlify__save({ title, mode: "pr", body })  →  returns prUrl
   gh pr checks <n> --repo cfdude/pm-docs            # wait for the Mintlify Deployment check
   gh pr merge <n> --repo cfdude/pm-docs --squash --delete-branch=false
   ```

6. **Verify the actual content is live**, not just that the merge succeeded — Mintlify's own
   CDN can serve a stale edge cache for ~1-2 minutes after merge (this is Mintlify's
   infrastructure, unrelated to any Cloudflare account the repo owner has):
   ```bash
   curl -s "https://pm-plugin.dev/<page>" | grep -i "<new content marker>"
   ```

7. **Delete the merged session branch.** Each `checkout` creates an `admin-mcp/<slug>-<sha>`
   branch on `pm-docs`; a squash-merge with `--delete-branch=false` (required — see
   `pr-workflow`'s reasoning about persistent branches, though `pm-docs`' branches ARE
   throwaway here) leaves it behind, showing up as an unpublished-looking "branch draft" in
   the Mintlify dashboard even though the content is live:
   ```bash
   gh api -X DELETE "repos/cfdude/pm-docs/git/refs/heads/<branch-name>"
   ```
   Periodically sanity-check for any that slipped through: `gh api repos/cfdude/pm-docs/branches --jq '.[].name'` should show only `main`.

## When this applies

Any PR into `cfdude/pm`'s `main` that changes something a user or agent would read about
(README.md, a `commands/*.md` doc, epic-level-autonomy behavior, tracker behavior) needs this
in the same PR cycle — not deferred to "at release time." A genuinely internal change (a test,
an engine-internal refactor with no behavior change) doesn't.
