# Actions release notes, v5 → v7 (task 4.1)

Read 2026-09-24 with `gh api repos/actions/{checkout,setup-node}/releases/tags/<tag>` (the v5.0.0,
v6.0.0 and v7.0.0 bodies, which carry every breaking change of their major) and each action's
`action.yml` at the `v7` tag (`gh api "repos/actions/<r>/contents/action.yml?ref=v7"`).

**Latest tags, re-confirmed** (`gh api repos/actions/{checkout,setup-node}/releases/latest`):
`actions/checkout` **v7.0.1** (2026-07-20), `actions/setup-node` **v7.0.0** (2026-07-14). Both
`action.yml`s at `v7` declare `using: node24` (`'node24'` for setup-node). Same as at drafting.

## actions/checkout

| Major | Changed default / behaviour | Effect on `ci.yml` |
|---|---|---|
| v5.0.0 | Action runtime moved to node24; minimum runner v2.327.1 | None: GitHub-hosted `ubuntu-latest` runners are current. |
| v6.0.0 | Persisted credentials written to a separate file rather than into `.git/config` | None: the workflow never pushes and reads no credential. The integrity tests read history, not credentials. |
| v7.0.0 | Refuses to check out a fork PR under `pull_request_target` and `workflow_run`; module moved to ESM | None: `ci.yml` triggers on `push` and `pull_request` only. |

**`fetch-depth: 0` keeps its meaning.** v7's `action.yml` still documents `fetch-depth` as "Number of
commits to fetch. 0 indicates all history for all branches and tags", default `1`. The workflow keeps
passing `0` explicitly, so the integrity tests that check ancestry on real hashes still see the whole
history.

## actions/setup-node

| Major | Changed default / behaviour | Effect on `ci.yml` |
|---|---|---|
| v5.0.0 | **Breaking:** automatic dependency caching when `package.json` has a `packageManager` field (opt out with `package-manager-cache: false`); action runtime node24 | None: this repository has no `package.json`, so nothing is cached and there is nothing to opt out of. |
| v6.0.0 | **Breaking:** automatic caching limited to npm | None, for the same reason. |
| v7.0.0 | ESM; `cache-primary-key`/`cache-matched-key` outputs added; the dummy `NODE_AUTH_TOKEN` export removed; `mirrorToken` only when provided | None: the workflow publishes nothing and reads no auth token. |

`node-version` and `node-version-file` are unchanged in meaning at v7. The matrix passes
`node-version: ${{ matrix.node }}` (a bare major), and the `node-majors` job passes the support floor
the same way. `node-version-file` stays unset.

**Conclusion:** the bump from `@v4` to `@v7` changes no default this workflow relies on.
