// scripts/lib/tool-currency.mjs
// "Is the tool current, and is THIS PROJECT current with it?" — for the CLIs `pm` sits above
// that do NOT update themselves. Depends on lib/constants.mjs, lib/plugin-meta.mjs (cmpVer) and
// lib/epic-progress.mjs (activeChangeIds); nothing calls back into this file.
//
// WHY THIS EXISTS (gh#128). `pm` and `superpowers` are PLUGINS: they auto-update, and pm already
// nudges when a repo's stamped `pmVersion` lags the installed plugin. `openspec` is a CLI the
// user upgrades by hand, and `openspec update` — which regenerates the per-project instruction
// files, slash commands and skills the whole OpenSpec lane runs on — is a SEPARATE, manual,
// per-project step. So a machine can carry OpenSpec 1.10.0 while a project still runs 1.6.0's
// generated artifacts, indefinitely, with nothing anywhere saying so. Measured in pm's own
// repository: four minor versions stale, while actively running an OpenSpec change, with two
// upstream slash commands (`/opsx:sync`, `/opsx:update`) that this project's agents could not
// know existed.
//
// ARCHITECTURAL LAW, restated because this is the one file in the engine that could break it:
// `pm` is an INSTRUCTION layer, never an INTEGRATION layer. Reading a local version is a READ —
// the same class as git.mjs's `merge-base`, which contacts nothing. Running `openspec update`
// is a MUTATION, and the engine must never perform it: it emits the instruction and the user
// runs the terminal command, exactly as with `openspec init`. The ONLY argv this file ever
// passes to the `openspec` binary is `--version`, and a source scan in
// scripts/test/tool-currency.test.mjs fails the suite if any lib file ever passes another.
//
// THE GENERAL FORM. Every CLI in the stack has this failure mode; OpenSpec is simply the one
// pm's own workflow depends on most. The module is deliberately named for the QUESTION rather
// than for OpenSpec, and the shape a second CLI would reuse is: (1) an env-overridable reader
// for the installed version, (2) a reader for the version that generated THIS project's
// artifacts, (3) a `null`-means-cannot-tell comparison, (4) one shared line emitter that every
// surface calls so two surfaces can never disagree. It is NOT generalized into a registry
// today, because there is exactly one caller and a registry with one entry is a guess about the
// second.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./constants.mjs";
import { cmpVer } from "./plugin-meta.mjs";
import { activeChangeIds } from "./epic-progress.mjs";

const SEMVER = /(\d+\.\d+\.\d+)/;
const OPENSPEC_DIR = path.join(ROOT, "openspec");
const SKILLS_DIR = path.join(ROOT, ".claude", "skills");

/** The paths `openspec update` regenerates for the `claude` host tool, repo-relative and in the
 *  form the user is told to look at. Named once so the nudge text and the tracked-ness probe
 *  cannot drift apart. */
export const OPENSPEC_GENERATED_PATHS = [".claude/skills/openspec-*", ".claude/commands/opsx/"];

/** The OpenSpec CLI version installed on this machine — or `null`, meaning CANNOT TELL.
 *
 *  `null` is a THIRD answer and not a disguised "current", exactly as git.mjs's `isAncestor`
 *  returns `null` rather than `false`: no CLI on PATH, a binary that fails, or output carrying
 *  no version. Every caller treats it as "this check does not apply", because a nudge derived
 *  from a comparison that never happened would be asserting drift it did not measure.
 *
 *  `PM_OPENSPEC_VERSION` is the test seam, env-first in the same shape `PM_CACHE_ROOT` is for
 *  `newestInstalledVersion()`. Set-but-empty deliberately forces the cannot-tell branch, so a
 *  suite can pin that branch on a machine that DOES have the CLI installed.
 *
 *  execFileSync with an argv array, never a shell string, and never any argv but `--version` —
 *  see this file's header. The timeout matters: this runs on the SessionStart hook, and a child
 *  that hangs there hangs every session start. */
export function installedOpenspecVersion() {
  const override = process.env.PM_OPENSPEC_VERSION;
  if (override !== undefined) {
    const m = String(override).match(SEMVER);
    return m ? m[1] : null;
  }
  try {
    const out = execFileSync("openspec", ["--version"], {
      cwd: ROOT, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    });
    const m = String(out).match(SEMVER);
    return m ? m[1] : null;
  } catch { return null; }
}

/** The `generatedBy` stamp in a generated file's YAML frontmatter, or null.
 *
 *  Confirmed against real artifacts rather than guessed at: `openspec update` records the
 *  generating version as `generatedBy: "1.10.0"` inside the `metadata:` block of the frontmatter
 *  of each `SKILL.md` under a `.claude/skills/openspec-…` directory. It is NOT in
 *  `openspec/config.yaml` (which
 *  carries only `schema:` and optional project context) and NOT in `.claude/commands/opsx/*.md`.
 *
 *  Scoped to the frontmatter block on purpose — matching the whole file would let prose in a
 *  skill body about this very mechanism report itself as a version stamp. */
function generatedByOf(file) {
  let txt;
  try { txt = fs.readFileSync(file, "utf8"); } catch { return null; }
  if (!txt.startsWith("---")) return null;
  const end = txt.indexOf("\n---", 3);
  if (end < 0) return null;
  const m = txt.slice(0, end).match(/^\s*generatedBy:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m);
  return m ? m[1] : null;
}

/** The OpenSpec version that generated THIS project's artifacts — or `null`, cannot tell.
 *
 *  THE OLDEST STAMP GOVERNS when the generated files disagree. A partial update (interrupted,
 *  or a file restored from an older commit) leaves a mix, and the agent reads all of them: the
 *  oldest artifact is what actually constrains its behavior, so reporting the newest would
 *  understate the drift and could report "current" while the agent is following 1.6.0 text.
 *
 *  `null` where no stamp is discoverable: artifacts generated for a host tool other than
 *  `claude` land elsewhere and are not read here, and artifacts predating the stamp carry none.
 *  Both are cannot-tell, never stale — which is what makes this safe by construction on a repo
 *  this reader does not understand. */
export function projectOpenspecVersion() {
  let dirs;
  try { dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch { return null; }
  let oldest = null;
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith("openspec-")) continue;
    const v = generatedByOf(path.join(SKILLS_DIR, d.name, "SKILL.md"));
    if (v && (oldest === null || cmpVer(v, oldest) < 0)) oldest = v;
  }
  return oldest;
}

/** Are the generated artifacts git-TRACKED here?  true | false | null (cannot tell).
 *
 *  This decides whether "review the diff" is real advice or vacuous. `openspec update` rewrites
 *  those files IN PLACE — 12 of them in the repo that raised gh#128 — so where they are tracked,
 *  `git diff` afterwards is exactly the review the user needs. Where they are NOT tracked (or
 *  are git-ignored), `git diff` shows NOTHING, and any local edit to `.claude/skills/openspec-*`
 *  is destroyed with no trace. Telling that user to "review the diff" would be advice that
 *  cannot be followed, so the nudge tells them to copy the files aside first instead.
 *
 *  `null` is treated as the untracked case by the emitter, deliberately: not being able to
 *  confirm a diff will exist is not grounds to promise one.
 *
 *  THE PATHSPEC AND THE OUTPUT ARE BOTH cwd-RELATIVE, AND THAT IS THE POINT. `git ls-files`
 *  walks UP to find a repository, so a pm-managed project nested inside a larger repo queries
 *  the enclosing repo's index. Measured, not assumed: with a cwd-relative pathspec the match is
 *  confined to files under ROOT and the printed paths are relative to ROOT, so an enclosing
 *  repo's own `.claude/skills/openspec-…` can never be mistaken for this project's. Do NOT
 *  "harden" this with `--full-name` or by resolving against `rev-parse --show-toplevel`: that
 *  breaks both nested cases at once — reporting a nested-but-tracked project as untracked, and,
 *  worse, an ignored project as tracked, which promises a diff the run will not produce.
 *  scripts/test/tool-currency.test.mjs pins both directions.
 *
 *  Local git plumbing only — `ls-files` reads the index and contacts nothing. */
export function generatedArtifactsTracked() {
  try {
    const out = execFileSync("git", ["ls-files", "--", ".claude/skills", ".claude/commands/opsx"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").some(l => /^\.claude\/(skills\/openspec-|commands\/opsx\/)/.test(l.trim()));
  } catch { return null; }
}

/** The drift finding, or `null` when there is nothing to say.
 *
 *  THE ORDER OF THE GUARDS IS LOAD-BEARING. Every cheap local `fs` read runs BEFORE the spawn,
 *  so a repo with no `openspec/` and no generated stamp — which is most repos, and every
 *  fixture in most of this suite — never pays for a child process on the SessionStart hook.
 *
 *  `project >= installed` is silence, not just equality: a project stamped NEWER than the
 *  reading is a stale reading or a downgraded CLI, and `openspec update` would move the project
 *  BACKWARDS. There is no instruction to give. */
export function openspecCurrency() {
  if (!fs.existsSync(OPENSPEC_DIR)) return null;      // not initialized — a different message
  const project = projectOpenspecVersion();
  if (project === null) return null;                  // cannot tell
  const installed = installedOpenspecVersion();
  if (installed === null) return null;                // cannot tell
  if (cmpVer(project, installed) >= 0) return null;   // current, or ahead
  return { project, installed, changes: activeChangeIds(), tracked: generatedArtifactsTracked() };
}

/** The nudge, as lines — THE single emitter every surface calls.
 *
 *  Shared rather than written twice, for the reason `gateSummary` is shared: two surfaces that
 *  compose the same finding independently eventually disagree about it, and a finding that
 *  reads one way in the brief and another at `/pm:upgrade` is worse than no finding.
 *
 *  DECISION — DO NOT SUPPRESS MID-CHANGE, DOWNGRADE. `openspec update` rewrites the instruction
 *  files an in-flight change is being authored against, so telling the user to run it now is
 *  wrong. Full suppression is ALSO wrong, and wrong in the direction that costs everything:
 *  the repository that raised this issue nearly always has a change open, so a nudge suppressed
 *  by an active change is a nudge that never fires — which is precisely how four minor versions
 *  of drift accumulated unseen. So the drift is always reported; only the imperative changes,
 *  becoming "hold until `<change>` is archived". */
export function openspecCurrencyLines() {
  const c = openspecCurrency();
  if (!c) return [];
  const L = [];
  L.push(`⚠ OpenSpec drift — this project's generated instruction files are ${c.project}, ` +
    `the installed CLI is ${c.installed}. Run \`openspec update\` in a terminal; pm never runs it for you.`);
  L.push(`   It rewrites ${OPENSPEC_GENERATED_PATHS.join(" and ")} in place, and local edits there ` +
    "are overwritten silently — never accept it blind.");
  if (c.tracked === true) {
    L.push("   Those files are git-tracked here, so `git diff` after the run IS the review — read it before committing.");
  } else if (c.tracked === false) {
    L.push("   Those files are NOT git-tracked here, so the run leaves no diff to review — copy them " +
      "aside first, then compare afterwards.");
  } else {
    L.push("   Could not tell whether those files are git-tracked here — copy them aside first, or the " +
      "run may leave nothing to compare against.");
  }
  if (c.changes.length) {
    L.push(`   ⏸ HOLD until ${c.changes.map(id => `\`${id}\``).join(", ")} ` +
      `${c.changes.length === 1 ? "is" : "are"} archived — \`openspec update\` rewrites the very ` +
      "instruction files that change is being authored against.");
  }
  return L;
}
