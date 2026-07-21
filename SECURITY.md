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

## Automated scanning

This repository runs Semgrep (SAST) and Trivy (filesystem vulnerability scanning) on every push
and pull request to `main`, plus a weekly scheduled run, with results published to the
repository's [Security tab](https://github.com/cfdude/pm/security). `main` is branch-protected:
no direct pushes, required CI status check, required commit signatures, enforced for admins too.
