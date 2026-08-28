# Security Policy

## Supported versions

`pm` ships as a single, always-current Claude Code plugin — only the latest released version
is supported. There is no LTS branch; upgrading is a `/pm:upgrade` away and is designed to be
safe to run at any time (see `CHANGELOG.md` for release-by-release upgrade notes).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability. Instead, use
[GitHub's private vulnerability reporting](https://github.com/cfdude/pm/security/advisories/new)
for this repository, or email the maintainer directly (see the `author` field in
`.claude-plugin/plugin.json`).

Include what you'd include in any good bug report: the affected version (`pmVersion` in
`.conductor/state.json`, or the plugin version), a description of the issue, and reproduction
steps if you have them.

## Scope and architecture

`pm`'s engine (`scripts/conductor.mjs`) is a zero-dependency Node.js CLI — no npm packages, no
`package.json` dependencies, no supply chain beyond Node's own built-ins. It is also an
**instruction layer, not an integration layer**: the engine itself never opens a network
connection or calls an external system (Jira, GitHub, Linear, etc.) — it only shapes
instructions the interactive Claude Code agent acts on with its own tooling. This significantly
narrows the engine's own attack surface; most of what a security report would concern is either
in that instruction-shaping logic or in how a consuming repo's agent acts on it.

### The one place the engine executes code it did not ship

`pm` installs four hooks — `SessionStart`, `PreToolUse`, `PostToolUse`, `PreCompact` — which run
in **every** project on the machine, initialized or not, whether or not that project has ever run
`/pm:init`. With one exception, everything they execute ships with the plugin.

The exception is the self-hosting handoff (`scripts/lib/self-hosting.mjs`): so that developing
`pm` does not run an engine a release behind the checkout, the installed engine can re-exec
`<project>/scripts/conductor.mjs`. Because that is project-supplied code, the decision to do it
is **opt-in and comes solely from the environment**: it happens only when
`PM_ENGINE_DELEGATION` is set to an absolute path that resolves to the same tree as the project
being run in. Unset — the default, and what every ordinary user sees — no handoff is ever
considered.

Nothing readable from inside a repository can enable this. In particular the presence of
`scripts/conductor.mjs`, or a `.claude-plugin/plugin.json` naming `pm`, grants nothing: those are
sanity checks applied *after* authorization, on a path the user has already named, and they are
not a credential — a repository can write both. Any change that lets a project's own contents
influence whether its code is executed is a vulnerability in this file's terms, and is worth
reporting even if it looks like a convenience.

### The instruction surfaces the agent acts on

The engine is not the only thing that can name a path for `node` to run. `commands/*.md`,
`skills/`, `agents/` and `hooks/` are instructions an interactive agent executes, so an engine
path written there is executed just as surely as one the engine computes. Through 0.29.0
fourteen of those files resolved the engine from `$CLAUDE_PROJECT_DIR` on nothing but an `-f`
test, which handed any project carrying a `scripts/conductor.mjs` a `node` invocation whenever a
user typed a `/pm:*` command (#139). That arm is gone: the shipped surfaces now resolve the
engine only from the plugin — `$CLAUDE_PLUGIN_ROOT`, else the newest copy in
`~/.claude/plugins/cache/` — and `scripts/test/engine-resolution.test.mjs` fails CI if any file
under those directories reintroduces a project-directory engine path.

## Automated scanning

This repository runs Semgrep (SAST) and Trivy (filesystem vulnerability scanning) on every push
and pull request to `main`, plus a weekly scheduled run, with results published to the
repository's [Security tab](https://github.com/cfdude/pm/security). `main` is branch-protected:
no direct pushes, required CI status check, required commit signatures, enforced for admins too.
