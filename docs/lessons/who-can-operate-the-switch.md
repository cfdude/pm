---
lesson: who-can-operate-the-switch
date: 2026-08-27
trigger: You are about to describe a change as a security problem, OR you are adding a control that something outside the tool's reach has to set.
cost: An argument that ran three rounds and nearly deleted a working feature. The maintainer had to say "I don't think I got a straight answer" before the actual question — who needs this? — got answered in one sentence.
rule: A plugin's reach ends at the project it runs in. A control living outside that boundary is therefore a CONTRIBUTOR requirement by definition — document it in CONTRIBUTING.md and the README, do not treat it as a defect. And name the audience before naming the risk: "developers of this tool need X" is a different conversation from "this is a security issue."
enforced_in: CONTRIBUTING.md § Developing pm with pm; README.md § Development
tags: [security, boundaries, communication, scope, oss]
---

**Cause.** A real bug got a real fix, a review found a real hole in the fix, and the fix's fix was
a sound gate. Every step was defensible. What went wrong was the *framing*: the gate was presented
as a security matter, so a bounded question about contributor tooling got argued as a question
about product safety. Three rounds later the maintainer asked plainly — *do I need this personally,
as the developer of this project?* — and the answer was one sentence that had never been said.

**The one sentence.** *You, and only you — because you are developing the tool.* Everything else
followed from it, and none of it was in dispute once it was said.

**Why the boundary makes this a documentation task, not a defect.** A plugin is installed into a
host and invoked on a project. It cannot write your shell profile, your environment, or your global
config; it can only influence the project it is running in. So a control that must live outside the
project can never be set by the product for anybody — which sounds like an argument for deleting
it, and is not. It is an argument about **who the control is for**:

- Needed by ordinary users → the product cannot deliver it. Redesign or drop it.
- Needed by people **developing the product** → correct and expected. Developers configure their
  own environment; that is what a development environment is. It belongs in **CONTRIBUTING.md**
  and in the README's contributor section, labelled as required setup that users do not need.

This is free and open source. Shipping a developer tool in the product is fine, and other
contributors will need the same setup. What is not fine is shipping it undocumented, where the
only person who knows it exists is the person who wrote it.

**Worked example.** pm's hooks invoke `${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs` — the INSTALLED
plugin. Developing pm therefore ran an engine a release behind the working tree, rewriting a
tracked file with stale output on every commit, for a whole release. The fix handed off to the
checkout's engine; a fresh-context review proved by running it that any directory with a
`.claude-plugin/plugin.json` naming `pm` and a `scripts/conductor.mjs` then got code execution at
session start. The gate — `PM_ENGINE_DELEGATION=<absolute path>`, matched by realpath — closes it.
The vulnerability was real and the gate is sound. **The feature was kept.** What changed was that
it got labelled a developer necessity and written into CONTRIBUTING.md and the README.

**The tell, and what to do with it.** You are writing documentation that tells someone to export a
variable or edit a dotfile to use a feature the product ships. That is not automatically a smell —
it is a *question*: who is that someone? If the answer is "a user", the design is wrong. If the
answer is "a contributor", the docs are missing. Answer the question before proposing a fix.

**What this is NOT.** Not "security findings are theater." The finding was correct, reproduced
twice, and the gate stayed. Do not let a framing correction read as dismissing the finding —
see [[review-findings-are-not-a-mandate]]: a finding is an input to a decision, and the decision
still has to be made on its own terms.
