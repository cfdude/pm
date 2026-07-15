# Research: autonomous issue-to-PR pipeline for cfdude/pm

Date: 2026-07-15
Epic: `autonomous-issue-resolution-agent` (lane: decision, parent: `cfdude-pm-repo-governance`)
Status: research pass only — no design, no implementation. Per the epic's own scoping,
this document exists to answer "what mechanism" before any design work starts.

## 1. What mechanisms exist today

### 1a. Official: `anthropics/claude-code-action` (GitHub Action)

Confirmed live and current (fetched directly from
`https://github.com/anthropics/claude-code-action`, `main` branch, 2026-07-15). This is
Anthropic's own, actively maintained GitHub Action — not something we'd have to build from
scratch on top of the raw Claude API.

Key facts pulled from the action's own README and `docs/security.md`:

- Install path: run `/install-github-app` from inside `claude` (Claude Code CLI) in the target
  repo. Requires repo admin. This sets up a GitHub App + required secrets automatically. There
  is also a fully manual path (custom GitHub App, docs/setup.md) for non-Anthropic-API auth
  (Bedrock, Vertex, Foundry).
- Modes: it "intelligently detects" activation context — `@claude` mentions in issues/PRs/
  comments, issue *assignment* to a bot user, or explicit-prompt automation (e.g. a scheduled
  workflow with a fixed prompt, no human trigger needed).
- Runs entirely on your own GitHub Actions runner — the runner executes Claude Code; only the
  model calls leave the runner (to Anthropic API / Bedrock / Vertex / Foundry, whichever you
  configure). No third-party hosting of your code.
- Tool access is configurable (`claude_args`, `--allowedTools`) — can be scoped down to just
  `Bash(gh issue view:*)` etc. This matters a lot for our threat model (see below).
- There is also a lower-level `claude-code-base-action` that just runs Claude Code with given
  inputs and does **not** do actor-permission checks or config restoration — the README
  explicitly says: use `claude-code-action`, not the base action, unless you're building your
  own trust layer on top. That's a strong signal we should not reinvent this on the base action.

**This is very likely the mechanism to build on, not a custom Claude API workflow.** Reasons:
- Access-control and prompt-injection mitigations are already built in and actively maintained
  by Anthropic (character-stripping of hidden markdown/HTML/invisible-unicode from untrusted
  issue/PR content, `allowed_bots`/`allowed_non_write_users` gating, subprocess env scrubbing).
  Reimplementing these correctly ourselves would be a substantial and easy-to-get-wrong project
  on its own.
- It already defaults to **not** auto-opening PRs (see 1b) — matching our "user is the final
  approver" requirement almost out of the box.
- It is a first-party, actively developed integration (not an abandoned community project),
  which matters for a governance-sensitive automation we intend to keep running long-term.

A custom GitHub Actions workflow that calls the Claude API/Agent SDK directly is possible (this
is essentially what `pm`'s own philosophy already assumes for its "instruction layer" — the
engine never calls external systems, an agent does), but would mean we own: sandboxing, actor
permission checks, prompt-injection sanitization of untrusted issue content, and PR-authorship
verification, all from scratch. Given `claude-code-action` already solves these, a custom
workflow is not recommended as the primary path — it would only make sense if we needed
behavior the action structurally cannot do (e.g. a wildly different runtime/sandbox model).

### 1b. Default PR-creation behavior already matches our constraint

Direct quote from the action's own docs (`docs/security.md`, "Pull Request Creation" section):

> In its default configuration, Claude does not create pull requests automatically... Instead:
> Claude commits code changes to a new branch; Claude provides a link to the GitHub PR creation
> page in its response; the user must click the link and create the PR themselves.

This is an important finding relative to the epic's stated goal ("opens a PR"): out of the box,
the action does NOT open the PR for you — it stops one step short and hands the human a
pre-filled PR-creation link. Actually opening the PR autonomously requires explicit additional
configuration/scripting on top of the action (using its GitHub API access with `Pull Requests
(Read & Write)` permission, which the GitHub App already requests). That is a deliberate design
choice by Anthropic specifically for human-oversight reasons — it lines up with, and to some
extent already implements, half of what our epic is asking for. Any design that chooses to make
PR-opening fully autonomous needs to consciously override this default and take on that
responsibility itself.

## 2. What "gate that the PR genuinely came from this trusted automation" requires

The action's own security model already provides several building blocks; a required CI check
in `cfdude/pm` would combine them:

1. **Author/actor identity.** GitHub Apps installed via the Claude GitHub App act as a
   distinguishable bot identity (`claude[bot]` or similar) distinct from any human or from a
   spoofed external contributor's account. A required check can assert
   `pull_request.user.login == 'claude[bot]'` (or whatever the installed app's login is) AND
   that the PR event's `installation.id` matches the repo's known GitHub App installation ID —
   the login alone is spoofable in theory if a malicious actor could also install a
   similarly-named app, but combined with (2) and (3) below this becomes solid.
2. **Commit signing.** The action supports two signing modes: (a) `use_commit_signing: true` —
   commits made via the GitHub API are automatically marked "Verified" by GitHub, attributed to
   the GitHub App; (b) an SSH signing key registered as a "Signing Key" on a specific GitHub
   account, used for git-CLI-based signing when more complex git operations are needed. A
   required check that all commits on the PR show `verified: true` (via `GET
   /repos/{owner}/{repo}/commits/{ref}` -> `commit.verification.verified`) plus that the
   signer/App identity matches your allowlist is a strong, hard-to-spoof mechanism — an external
   PR cannot present GitHub's own "Verified" badge without possessing the private signing
   key/App credentials.
3. **Branch naming convention + provenance metadata.** A required check enforcing a fixed prefix
   (e.g. `claude/issue-<n>-...`) is a weak signal alone (any contributor can name a branch
   anything) but useful as a fast-fail/defense-in-depth layer combined with (1)/(2). Better:
   have the automation write a small structured marker into the PR body/commit trailer (e.g. a
   `Source-Automation: claude-code-action` trailer, or a link back to the triggering Actions run
   ID) that the required check can independently re-verify against the Actions API
   (`GET /repos/{owner}/{repo}/actions/runs/{run_id}`) to confirm the run actually happened, was
   triggered by the expected workflow file, and actually produced this exact commit SHA. This
   closes the gap where someone manually crafts a PR that merely *claims* automation origin.
4. **`GITHUB_TOKEN` / GitHub App token scoping.** The GitHub App receives a short-lived,
   repo-scoped token (per the docs: "cannot access other repositories or perform actions beyond
   the configured permissions"). Scoping the workflow's own `permissions:` block to the minimum
   (`contents: write`, `pull-requests: write`, `issues: write` — no `admin`, no
   `actions: write` unless needed) limits blast radius if the automation itself is ever tricked
   via prompt injection into misusing its own credentials, but does not by itself prove PR
   provenance to a *reviewer* — it is a containment control, not an attestation control.

**Recommended combination for the required check:** author is the known bot login AND all
commits report `verified: true` AND the PR/commit provenance metadata cross-checks against a
real, matching Actions run. Any one of these alone is spoofable or weak; together they are a
solid gate. This required check would be a natural companion to (and should probably live
alongside) the sibling epic `branch-protection-and-pr-workflow` — that epic already owns "what
required checks exist on this repo," so the provenance check's implementation likely belongs
there, not as a separate mechanism.

## 3. Realistic scope/cost

This is **not** an afternoon project, and the epic's own title ("substantially bigger and more
novel than the other two governance items") is accurate. Rough phases:

- **Smallest useful version (days, not weeks):** Install the official GitHub App
  (`/install-github-app`), wire a workflow that triggers on issue assignment to the bot (or a
  label like `claude-fix`), scope `claude_args` tool access down hard (read + comment only,
  no `Bash`/`Edit`), and let Claude **propose a fix as an issue/PR comment** — no branch, no PR,
  no code write access at all. This validates whether the analysis quality is good enough to be
  worth pursuing further, with zero write-side risk. This is genuinely a 1-day setup task.
- **Next increment (roughly a week):** Allow the action to commit to a new branch and use its
  default behavior of posting a PR-creation link rather than opening the PR itself — this keeps
  a human click as the actual PR-creation gate, which is minimal extra engineering since it's
  the action's default. Add commit signing (`use_commit_signing: true` is the simpler of the two
  options — no extra secret/key infra beyond what the GitHub App already provides).
- **Full autonomous-PR version (multi-week):** Layer on: (a) fully automated PR creation
  (overriding the safer default — requires explicit design sign-off given it removes a
  human-in-the-loop step at PR-creation time, even though merge is still gated); (b) the
  provenance-verification required check described in section 2, which needs its own design,
  implementation, and testing against real spoofing attempts (e.g. try to actually forge a PR
  that fools a naive version of the check, to validate it before trusting it); (c) sandboxing
  and prompt-injection review specific to *our* issue templates and repo conventions — the
  action's built-in sanitization is generic, not specific to `pm`'s repo; (d) monitoring/alerting
  for when the automation does something wrong (cost controls, runaway-loop protection, a kill
  switch); (e) updating `branch-protection-and-pr-workflow`'s required-review rule so it also
  covers PRs from this bot (branch protection review requirements apply per-repo regardless of
  author, so this should already work, but needs explicit verification once the bot exists).

Order of magnitude: smallest useful version is genuinely small (under a day of setup once you've
read the docs); the full autonomous pipeline described in the epic title (auto-fix, auto-PR,
provenance-verified) is realistically a multi-week project once you include the
provenance-check design/build/verification and the security review it deserves given it's
allowing an LLM to write and (eventually) merge-request code changes to a real repo.

## 4. Mechanical enforcement of "human is always the final approver/merger"

Two independent layers, both already partially available:

1. **Branch protection requiring human review before merge.** This is GitHub's own mechanism
   (required PR reviews, required status checks, no direct pushes to the default branch) — it
   applies uniformly regardless of who/what opened the PR, so once
   `branch-protection-and-pr-workflow` (the sibling epic) is in place, it already covers bot-
   opened PRs with zero additional work, *provided* the bot's token/App does not itself have
   bypass/admin privileges on that branch protection rule. This needs an explicit check: GitHub
   Apps can be granted "Allow specified actors to bypass required pull requests" on a branch
   protection rule — the automation's App must NOT be added to that bypass list, or the whole
   guarantee is void. This is a one-line configuration fact that is easy to get wrong silently
   and should be an explicit item in any future design/proposal, and probably an explicit test
   (attempt a self-merge with the bot's token in a sandboxed repo, confirm it's rejected).
2. **The bot never receives merge permissions in the first place.** The GitHub App's requested
   permissions in the current `claude-code-action` are Contents (R/W), Pull Requests (R/W),
   Issues (R/W) — notably this does not include an explicit "bypass branch protection" or
   "admin" permission, so by default it should not be able to force-merge. This should still be
   explicitly verified rather than assumed (permissions models change between action versions,
   and org-level app installation settings can grant more than the action's manifest requests).

Both layers are policy-as-configuration, not code we'd write — which fits `pm`'s own
architectural law that it never becomes an integration layer; enforcement here is GitHub-native
configuration, with `pm`'s role limited to instructing the agent to check/report on it (e.g. an
epic checklist item: "confirm branch protection blocks the bot" before considering the pipeline
trustworthy).

## Recommendation

Build on `anthropics/claude-code-action` (the official, actively maintained Anthropic GitHub
Action), not a custom Claude API workflow. Start with the "propose a fix as a comment" smallest
useful version (no write access at all) to validate quality before investing in the PR-opening
and provenance-check phases. Treat the provenance-verification required check as a joint
deliverable with `branch-protection-and-pr-workflow`, since both live in the same "required
checks on this repo" surface area, rather than building it as a fully separate mechanism.

## Open questions requiring an explicit human decision before any real design

1. **Do we actually want fully-autonomous PR opening**, or is "comment with a proposed fix" /
   "commit to branch + human clicks PR-creation link" (the action's own default) sufficient?
   This is a real product-scope decision, not an implementation detail — it changes both the
   engineering scope (section 3) and the security surface (an autonomously-opened PR is a
   stronger claim on trust than a link a human has to click).
2. **Which repos does this apply to?** Just `cfdude/pm`, or also downstream repos that consume
   the `pm` plugin? Scope affects whether this is a one-off workflow file or something `pm`
   itself needs to help provision/document for other repos.
2a. Related: does this only fire on issues that are already "validated" in some sense (e.g.
    triaged, labeled, has a clear repro), and if so, who/what does that validation? The epic
    title says "analyzes a validated issue" — validation is currently undefined and would need
    its own design (human labels it? A separate triage step? pm epic status?).
3. **What is the actual identity we gate on** — the shared Anthropic-hosted `claude[bot]`/GitHub
   App used by everyone who installs `claude-code-action`, or a repo-specific custom GitHub App
   we register ourselves (more setup, but a provenance check against "our own App's installation
   ID" is unambiguous in a way that checking against a shared public bot identity is not, since
   in principle any repo that installs the same public app looks identical from a signature
   perspective — the differentiator becomes the installation ID / repo scoping, which needs to
   be explicitly confirmed as sufficiently unspoofable).
4. **Cost/budget controls** — Claude API usage per issue-resolution run is a real, ongoing cost;
   no budget/kill-switch design exists yet and needs a decision on acceptable spend and how it's
   monitored/capped.
5. **Failure/quality bar** — what happens when the agent's fix is wrong, incomplete, or
   introduces a regression? Is there an expectation of test-running before PR/comment (tying
   into whatever CI exists), or is review entirely manual? This affects both scope and the
   "propose as comment first" MVP's exit criteria (how do we decide it's ready to graduate to
   opening branches/PRs?).
6. **Prompt-injection posture specific to `pm`'s own issues** — the action's generic
   sanitization is a floor, not a ceiling; whether we need repo-specific hardening (e.g.
   restricting which labels/users can trigger the automation at all) is a decision, not
   something this research pass can resolve without knowing our actual issue-intake patterns.
