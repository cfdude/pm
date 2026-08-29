// scripts/lib/verify-specs.mjs
// gh-93 — SPEC COVERAGE: for every design document under a root, how many epics were drawn
// from it. READ-ONLY, and an INVENTORY rather than an audit.
//
// WHY NOT A CHECK IN integrity.mjs. That file's own header states its unit: "shapes that cannot
// be true". A design document with no epic is a shape that CAN be true, and usually is — a note,
// a reference, an abandoned sketch, a design whose work is registered under an id nobody thought
// to associate. Filing every one of them as a finding is how a report earns the reflex that
// skips it, which is exactly what #138 removed from the plan-freshness warning (7 of 8 dangling
// `planPath`s were archived-and-moved, so the warning was wrong 7 times out of 8). So this is
// its own verb in the `verify-*` family beside `verify-state` and `verify-worktrees`: it prints
// an inventory, it uses none of `integrity`'s finding vocabulary, and it always exits 0.
//
// WHAT COUNTS AS A DESIGN DOCUMENT. Every `.md` file under the root, recursively, minus a
// directory's own index files. Named exclusion rather than a content test, for planFiles()'
// stated reason: deciding by reading inside the file would make the answer depend on heading
// conventions, and #93's own evidence is that heading conventions vary too much to rely on
// ("Follow-ups this design creates", "Implementation sequencing", "Next steps", and 23 of 125
// items under no heading at all). The engine reads no document's CONTENT here — enumeration of
// the work a design implies stays with the agent, which is reading the design anyway; the
// engine computes only the set difference, exactly as the issue asks.
//
// WHAT COUNTS AS COVERAGE. Any epic source-artifact claim on that path, read from
// EPIC_SOURCE_ARTIFACTS via artifactClaimants(). Family-driven rather than `specPath`-only, so
// pointing `--root` at a plans directory answers the same question about plans, and so a field
// added to the family is counted here without a second edit. Status-blind: an archived epic for
// chunk 1 IS coverage of chunk 1.

import fs from "node:fs";
import path from "node:path";
import { ROOT, SPECS_DIR } from "./constants.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { artifactClaimants, normalizeArtifactPath } from "./source-artifacts.mjs";
import { parseFlags } from "./add-epic.mjs";

/** The flags `verify-specs` accepts. A LOCAL list and deliberately not an EPIC_FLAGS entry, for
 *  triage.mjs' stated reason: that registry is the shared surface of the epic-WRITING commands,
 *  and this verb writes no epic. "Not in the registry" is not "needs no allowlist" — parseFlags
 *  reads whatever it is handed, so an unregistered flag would parse, be ignored, and exit 0
 *  having quietly checked the default root instead of the one the caller named. */
export const VERIFY_SPECS_FLAGS = ["root"];

/** A directory's own index file is not a design document — verbatim the rule planFiles() applies
 *  in the plans directory, so the two roots cannot disagree about what a document is. */
export const SPEC_INDEX_FILES = new Set(["readme.md", "index.md", "contributing.md"]);

/** Repo-relative, forward-slashed, in the SAME normal form artifact paths are compared in.
 *  A document enumerated one way and claimed the other would read as uncovered-and-dangling —
 *  one document reported twice, as both halves of the difference it is on neither side of. */
const relToRoot = (abs) => normalizeArtifactPath(path.relative(ROOT, abs).split(path.sep).join("/"));

/** Every design document under `absRoot`, recursively, as repo-relative normalized paths. */
export function specDocuments(absRoot) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".md") && !SPEC_INDEX_FILES.has(e.name.toLowerCase())) {
        const rel = relToRoot(abs);
        if (rel) out.push(rel);
      }
    }
  };
  walk(absRoot);
  return out.sort();
}

/** The coverage report as data. Pure over (state, root) apart from the two disk reads it names.
 *
 *  `dangling` is scoped to `specPath` ALONE, and that is a decision rather than an oversight. A
 *  dangling `planPath` is already reported — by epicProgress(), with a deliberate exemption for
 *  the archived-and-moved case that made up 7 of this repository's 8 instances (#138). Repeating
 *  it from a second surface would reinstate that warning with its exemption stripped off, which
 *  is the same noise wearing a different verb's name. `specPath` has no other surface at all, so
 *  a design document that was renamed or moved is otherwise silent.
 *
 *  `syncIgnore` is NOT read. A tombstone says "sync must not register this path"; it does not say
 *  "this document deliberately has no epic", and treating it as if it did would be actively
 *  wrong under the many-to-one shape #92 adds: removing ONE of six epics drawn from a design
 *  tombstones the whole document, and the five survivors' coverage would vanish from the report.
 */
export function specCoverage(state, absRoot) {
  const rootExists = fs.existsSync(absRoot) && fs.statSync(absRoot).isDirectory();
  const claims = artifactClaimants(state);
  const documents = specDocuments(absRoot).map(p => ({
    path: p,
    epics: (claims.get(p) || []).map(c => c.epic),
  }));

  const dangling = [];
  for (const e of (state && state.epics) || []) {
    if (!e || typeof e !== "object") continue;
    const p = normalizeArtifactPath(e.specPath);
    if (!p) continue;
    if (!fs.existsSync(path.join(ROOT, p))) dangling.push({ epic: e.id, path: p });
  }

  return { root: relToRoot(absRoot) || absRoot, rootExists, documents, dangling };
}

/** The report, as text. */
export function formatSpecCoverage(report) {
  const L = [
    "SPEC COVERAGE — which design documents have epics drawn from them.",
    "An uncovered document is inventory, not a defect: a note, a reference or a deliberate",
    "sketch is a legitimate reason to have no epic. Reported, never repaired — nothing here",
    "writes state.",
    "",
  ];

  if (!report.rootExists) {
    // Distinct from "checked it and everything is covered", on purpose. A repository that keeps
    // its designs somewhere else would otherwise read a confidently empty report as a clean one.
    L.push(`no spec root at \`${report.root}\` — nothing was checked.`);
    L.push("This repository keeps its design documents elsewhere, or has none. Point the check");
    L.push("at them with `verify-specs --root <path>`.");
    L.push("");
    if (report.dangling.length) L.push(...danglingBlock(report.dangling));
    return L.join("\n");
  }

  L.push(`root: \`${report.root}\` — ${report.documents.length} document(s)`);
  L.push("");
  for (const d of report.documents) {
    L.push(`  ${String(d.epics.length).padStart(3)}  ${d.path}` +
      (d.epics.length ? `  — ${d.epics.map(i => `\`${i}\``).join(", ")}` : ""));
  }
  const uncovered = report.documents.filter(d => !d.epics.length).length;
  L.push("");
  L.push(`${report.documents.length - uncovered} of ${report.documents.length} document(s) ` +
    `carry at least one epic; ${uncovered} document(s) with no epic.`);
  if (uncovered) {
    L.push("A document with no epic is worth ONE look, not a fix: read it, and where it implies");
    L.push("work nobody registered, author an `add-many` batch whose entries each carry its");
    L.push("`specPath`. Where it implies none, it has already told you what it is.");
  }
  L.push("");
  if (report.dangling.length) L.push(...danglingBlock(report.dangling));
  return L.join("\n");
}

/** The other half of the set difference: an epic naming a document that is not there.
 *  Root-independent by construction — an epic may legitimately name a design outside the root,
 *  and a missing file is a missing file wherever it was supposed to be. */
function danglingBlock(dangling) {
  return [
    `${dangling.length} epic(s) name a design document that is not on disk ` +
    "(renamed, moved, or never written):",
    ...dangling.map(d => `  • \`${d.epic}\` → ${d.path}`),
    "Repoint it with `update-epic <id> --spec <path>`.",
    "",
  ];
}

/** `verify-specs [--root <path>]` — print the coverage inventory. Always exits 0.
 *
 *  Deliberately does NOT call render(), for integrity()'s reason: render runs the archive-drift
 *  heal and SAVES, so a read-only report that rendered would write state on the way to saying it
 *  writes none. Read-only here means state.json is byte-identical afterwards. */
export function verifySpecs() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const unknown = Object.keys(f).filter(k => !VERIFY_SPECS_FLAGS.includes(k));
  if (unknown.length) {
    process.stderr.write(
      `conductor: verify-specs: unknown flag(s) ${unknown.map(k => `--${k}`).join(", ")} ` +
      `(known: ${VERIFY_SPECS_FLAGS.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  if (f.root !== undefined && typeof f.root !== "string") {
    // A valueless `--root` parses as boolean true. Falling back to the default would check a
    // root the caller did not ask about and report on it as though they had.
    process.stderr.write("conductor: --root requires a value\n"); process.exit(1);
  }
  const absRoot = f.root ? path.resolve(ROOT, f.root) : SPECS_DIR;
  process.stdout.write(formatSpecCoverage(specCoverage(loadState(), absRoot)) + "\n");
}
