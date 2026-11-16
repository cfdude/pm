// scripts/lib/openspec-addenda.mjs
// Where pm's OWN clause for an OpenSpec workflow lives, and the read-only check that it lives there (gh#262).
//
// THE FAILURE THIS ENDS. pm once hand-edited a line into OpenSpec's generated archive skill and command
// (`.claude/skills/openspec-archive-change/SKILL.md`, `.claude/commands/opsx/archive.md`). Those files are
// rewritten by `openspec update`, so a clause kept only there has no durable home. pm now carries its clause in
// the managed rules block (an "OpenSpec addenda" section, emitted only when `openspec/` exists), which
// `openspec update` never touches, and the engine writes to NO OpenSpec-generated file.
//
// ARCHITECTURAL LAW, restated: pm is an INSTRUCTION layer. Nothing here spawns a process, runs `openspec`, or
// writes a file. The check only READS, and its last line tells the AGENT to run `openspec update --dry-run`
// itself. A source scan in scripts/test/assert/tool-currency.test.mjs fails the suite if a lib file passes
// the `openspec` binary an argv beyond the read-only pair it pins.
//
// TWO FINDINGS, and which side each reports against (the plan's open question 1):
//   RESIDUAL — a registry needle sits INSIDE a generated file: pm text lives where an update erases it.
//   MISSING  — the repo uses OpenSpec but the managed block lacks the addenda section: the clause has no
//              surviving home. A generated file WITHOUT the clause is the desired state and stays silent.
//
// REGISTRY RETIREMENT: remove an entry once the fleet shows zero residual findings for two releases. Until
// then it must stay, because any repo may still carry the legacy hand edit.

import fs from "node:fs";
import path from "node:path";
import { engineRoot, escapeControls } from "./constants.mjs";
import { rulesTarget } from "./platform.mjs";

/** The pm-authored clauses once hand-edited into generated files. `needle` is the exact text the edit added. */
export const PM_OPENSPEC_ADDENDA = [
  { id: "archive-sync-kept-allowance", needle: "a spec the sync deliberately kept and reported is also a match" },
];

/** The managed-block heading; the MISSING check and the section text agree on it by construction. */
export const OPENSPEC_ADDENDA_HEADING = "## OpenSpec addenda";

/** Byte cap for the clause + practice sentence (about 100 tokens at bytes/4; the owner's figure is about 80). */
export const OPENSPEC_ADDENDA_MAX_BYTES = 400;
/** Byte cap for the section with every guardrail bullet present. */
export const OPENSPEC_ADDENDA_MAX_BYTES_FULL = 1200;
/** Byte cap for each guardrail bullet. */
export const OPENSPEC_ADDENDA_BULLET_MAX_BYTES = 260;

const GUARDRAILS = [
  { flag: "onboard", text: "- Never run `/opsx:onboard`: it archives with no gate or disposition." },
  { flag: "verify", text: "- `/opsx:verify` flags `<!-- pm:lifecycle -->` tasks as CRITICAL: a false positive (#261). Never tick or unmark one." },
  { flag: "bulkArchive", text: "- `/opsx:bulk-archive` records no dispositions: afterwards record each member's disposition with update-epic, one call per member." },
];

/** The section for the managed block, or "" when the repo does not use OpenSpec. PURE: `present` says which generated
 *  skills exist, and each guardrail bullet appears iff its flag is true. */
export function openspecAddendaSectionText({ hasOpenspec, present = {} } = {}) {
  if (!hasOpenspec) return "";
  const lines = [
    OPENSPEC_ADDENDA_HEADING,
    "",
    "`openspec update` rewrites `.claude/skills/openspec-*` and `.claude/commands/opsx/*`; keep any pm clause here, never there.",
    "- Archive: in the generated archive skill's step 6, a spec the sync deliberately kept and reported is also a match.",
  ];
  for (const g of GUARDRAILS) if (present[g.flag]) lines.push(g.text);
  return lines.join("\n");
}

/** PURE findings over what was read. Sorted by path so two runs agree. */
export function openspecAddendaFindings({ hasOpenspec, generatedFiles = [], blockText = null } = {}) {
  const out = { residual: [], missing: [] };
  if (!hasOpenspec) return out;
  const files = [...generatedFiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of files) {
    for (const a of PM_OPENSPEC_ADDENDA) {
      if (String(f.text).includes(a.needle)) out.residual.push({ id: a.id, path: f.path });
    }
  }
  // `null` means no rules target exists yet: nothing to compare against, so say nothing.
  if (blockText !== null && !blockText.includes(OPENSPEC_ADDENDA_HEADING)) {
    for (const a of PM_OPENSPEC_ADDENDA) out.missing.push({ id: a.id });
  }
  return out;
}

/** The brief / upgrade lines for `findings`. Only a registry id and a repo-relative path are ever interpolated: file
 *  CONTENT never reaches a line. Empty findings render nothing. */
export function openspecAddendaFindingLines(findings) {
  const { residual, missing } = findings;
  if (!residual.length && !missing.length) return [];
  const L = [];
  for (const r of residual) {
    L.push(`⚠ OpenSpec addenda RESIDUAL — pm text \`${r.id}\` sits inside \`${r.path}\`, a file \`openspec update\` rewrites. ` +
      "Delete it there; the clause belongs in the managed block's OpenSpec addenda section.");
  }
  for (const m of missing) {
    L.push(`⚠ OpenSpec addenda MISSING — this repo uses OpenSpec but the managed block has no OpenSpec addenda section, ` +
      `so \`${m.id}\` has no surviving home. Run \`write-rules\` (or the upgrade) to refresh the block.`);
  }
  L.push("   Run `openspec update --dry-run` to see what else the update would rewrite (pm's engine never runs it).");
  return L.map(escapeControls);
}

function listFiles(dir, accept) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => accept(d)).map((d) => d.name).sort(); } catch { return []; }
}

const hasOpenspecDir = (root) => { try { return fs.statSync(path.join(root, "openspec")).isDirectory(); } catch { return false; } };

/** Read the generated files this repo carries, as `{path, text}` with repo-relative POSIX paths. */
function readGeneratedFiles(root) {
  const out = [];
  const skills = path.join(root, ".claude", "skills");
  for (const name of listFiles(skills, (d) => d.isDirectory() && d.name.startsWith("openspec-"))) {
    const rel = ".claude/skills/" + name + "/SKILL.md";
    try { out.push({ path: rel, text: fs.readFileSync(path.join(root, rel), "utf8") }); } catch { /* absent */ }
  }
  const cmds = path.join(root, ".claude", "commands", "opsx");
  for (const name of listFiles(cmds, (d) => d.isFile() && d.name.endsWith(".md"))) {
    const rel = ".claude/commands/opsx/" + name;
    try { out.push({ path: rel, text: fs.readFileSync(path.join(root, rel), "utf8") }); } catch { /* absent */ }
  }
  return out;
}

/** The lines `openspecAddendaFindingLines` renders for this repo, read from disk. READ ONLY. */
export function openspecAddendaLines(platform = "claude-code") {
  const root = engineRoot();
  if (!hasOpenspecDir(root)) return [];
  let blockText = null;
  try { blockText = fs.readFileSync(rulesTarget(platform, root), "utf8"); } catch { blockText = null; }
  return openspecAddendaFindingLines(openspecAddendaFindings({ hasOpenspec: true, generatedFiles: readGeneratedFiles(root), blockText }));
}

/** The section text for this repo, as `rulesBlock`'s input: "" when `openspec/` is absent. The guardrail flags come
 *  from which generated skill directories exist. */
export function currentOpenspecAddendaSection() {
  const root = engineRoot();
  const hasOpenspec = hasOpenspecDir(root);
  if (!hasOpenspec) return "";
  const has = (name) => fs.existsSync(path.join(root, ".claude", "skills", name));
  return openspecAddendaSectionText({
    hasOpenspec,
    present: { onboard: has("openspec-onboard"), verify: has("openspec-verify-change"), bulkArchive: has("openspec-bulk-archive-change") },
  });
}
