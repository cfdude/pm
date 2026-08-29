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
// THE ONE PLACE A DOCUMENT'S CONTENT IS READ, and only when `--headers` asks for it (#148).
// The bare report above reads no document's body, by the rule stated two paragraphs up, and that
// stays true. `--headers` is its own arm because it answers a different question — not "is this
// document covered" but "which epics does this document SAY it is about" — and because reading
// content unconditionally would make every future noise complaint about the inventory a
// complaint about a parse nobody asked for. It PROPOSES and never associates: the engine must
// not decide a document and an epic belong together, a header is prose an author can typo, and
// the split is exactly `triage`'s — mechanical candidate set, agent's verdict.
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
export const VERIFY_SPECS_FLAGS = ["root", "headers"];

/** How far into a document the leading metadata block may start. Generous — a title, a blank
 *  line and a couple of badges — and bounded so a document with no header never has its BODY
 *  scanned for backticked code spans. */
export const HEADER_SCAN_LINES = 15;

/** The epic-id format `add-epic` enforces. Quoted here rather than imported for the reason
 *  EPIC_SOURCE_ARTIFACTS quotes its keys: this module must not grow a dependency edge for one
 *  regex. A candidate that could not be a legal epic id is not a candidate — it is how
 *  `docs/x/y-design.md` and `foo()` are excluded without a vocabulary of things to ignore. */
const EPIC_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** Every backtick-quoted epic id the document's LEADING METADATA BLOCK names, with the label it
 *  appeared under. In document order, duplicates kept out.
 *
 *  THE RULE, and why it is this one. #148 reports two header shapes that already differ
 *  (`**Epic:**` on one line, `**Epics:**` wrapped across two), which argues against parsing a
 *  fixed format. Two candidate rules were run against this repository's ten real design
 *  documents before choosing:
 *
 *   • Backticked ids anywhere in the first N lines — recovered all 26 ids with no false ones,
 *     but only because these ten documents happen to open with a header. It would read
 *     `state.json` and `tasks.md` out of any document whose opening paragraph quotes a filename,
 *     and those would land in the "names no epic" bucket, which is the half that must stay a
 *     genuine finding.
 *   • Backticked ids on lines under a label from an ALLOWLIST (`Epic`, `Epics`, `Relates`) —
 *     dropped three genuine ids in `2026-07-25-codex-platform-support-design.md`, which files
 *     them under `**Depends on (all three must land first):**`. An allowlist of labels is a
 *     vocabulary that goes stale the first time an author invents a heading, which is precisely
 *     the failure mode the issue warns about.
 *
 *  So: label-AGNOSTIC (any `**Anything:**` opens the block) but region-BOUNDED (the block is the
 *  run of non-blank lines it starts, and the first blank line ends the scan). That recovered
 *  26/26 with 0 false candidates on the real corpus, including the two many-to-one cases no
 *  filename normalisation reaches — three epics from `tracker-direction-and-freshness-design.md`
 *  and `gh-82` plus two `Relates` ids from `cross-repo-orchestration-design.md`.
 *
 *  The label is CARRIED, never interpreted. "This document is about it" and "it is related" are
 *  different claims and the agent confirming the association needs to see which one it is — but
 *  deciding which labels mean which is the allowlist this rule exists to avoid, so the author's
 *  own word is reported verbatim. */
export function headerEpicIds(text) {
  const out = [];
  const seen = new Set();
  let label = null, opened = false;
  for (const line of String(text || "").split("\n").slice(0, HEADER_SCAN_LINES)) {
    // A blank line ENDS the block, and ends the scan: everything after it is body. Before the
    // block opens, a blank line is just the gap under the title.
    if (!line.trim()) { if (opened) break; else continue; }
    const m = line.match(/^\s*\*\*([^*]+?):\*\*/);
    if (m) { label = m[1].trim(); opened = true; }
    else if (!opened) continue; // the title, or prose standing where a header would be
    for (const t of line.matchAll(/`([^`]+)`/g)) {
      if (!EPIC_ID.test(t[1]) || seen.has(t[1])) continue;
      seen.add(t[1]);
      out.push({ id: t[1], label });
    }
  }
  return out;
}

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
    // The pointer is what makes the arm reachable. An arm nobody is told about is an arm
    // nobody runs, and this report is the one place a reader is already asking the question
    // it answers.
    L.push("Many documents already name their own epics in a header: `verify-specs --headers`");
    L.push("reads them and proposes the association for you to confirm.");
  }
  L.push("");
  if (report.dangling.length) L.push(...danglingBlock(report.dangling));
  return L.join("\n");
}

/** #148's candidate set, as data. For every document under the root, the epic ids its own header
 *  names, split by whether that id EXISTS in the record.
 *
 *  Two different things, deliberately not merged:
 *   • `proposals` — an UNCOVERED document whose header names ids that exist. This is the offer:
 *     run the association if you agree with it. Only uncovered documents produce one; a covered
 *     document needs no proposal.
 *   • `unknown` — a header id that resolves to NO epic, from ANY document, covered or not. That
 *     is a finding rather than inventory (the issue's own word): a stale header, an epic that
 *     was removed, or a typo. Coverage does not excuse it — a document whose first named epic
 *     shipped can still name a second that never existed, and scoping this half to uncovered
 *     documents would hide exactly those.
 */
export function headerCandidates(state, absRoot) {
  const rootExists = fs.existsSync(absRoot) && fs.statSync(absRoot).isDirectory();
  const known = new Set(((state && state.epics) || []).map(e => e && e.id).filter(Boolean));
  const claims = artifactClaimants(state);
  const proposals = [], unknown = [];
  for (const rel of specDocuments(absRoot)) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
    const found = headerEpicIds(text);
    if (!found.length) continue;
    const covered = (claims.get(rel) || []).length > 0;
    const live = found.filter(c => known.has(c.id));
    for (const c of found) if (!known.has(c.id)) unknown.push({ path: rel, ...c });
    if (!covered && live.length) proposals.push({ path: rel, candidates: live });
  }
  return { root: relToRoot(absRoot) || absRoot, rootExists, proposals, unknown };
}

/** The `--headers` report, as text. Every line is an OFFER — nothing here writes state, and the
 *  commands it prints are for the agent to run after reading the document, not before. */
export function formatHeaderCandidates(report) {
  const L = [
    "HEADER CANDIDATES — the epic ids each design document's own header names.",
    "PROPOSED, never applied: the engine does not decide that a document and an epic belong",
    "together, and a header is prose an author can typo. Read the document, then run the",
    "association you agree with.",
    "",
  ];
  // Distinct from "read them all and found nothing", for the reason the bare report separates the
  // two: a repository that keeps its designs elsewhere must not read a confidently empty report
  // as a clean one. Silence and clean must never look the same.
  if (!report.rootExists) {
    L.push(`no spec root at \`${report.root}\` — no document was read.`);
    L.push("Point the check at your design documents with `verify-specs --headers --root <path>`.");
    L.push("");
    return L.join("\n");
  }
  if (!report.proposals.length) {
    L.push("No uncovered document names an epic that exists — nothing to propose.");
  } else {
    L.push(`${report.proposals.length} uncovered document(s) name an epic in the record:`);
    L.push("");
    for (const p of report.proposals) {
      L.push(`  ${p.path}`);
      for (const c of p.candidates) {
        L.push(`    • \`${c.id}\`${c.label ? `  (under **${c.label}:**)` : ""}`);
        L.push(`        update-epic ${c.id} --spec ${p.path}`);
      }
    }
  }
  L.push("");
  if (report.unknown.length) {
    L.push(`${report.unknown.length} header id(s) name no epic in the record — a stale header, a`);
    L.push("removed epic, or a typo. This half is a finding, not inventory:");
    for (const u of report.unknown) {
      L.push(`  • \`${u.id}\`${u.label ? ` (under **${u.label}:**)` : ""} — ${u.path}`);
    }
    L.push("");
  }
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
  // `--headers` is a BOOLEAN arm: it carries no value, and a stray argument after it must not be
  // read as one. parseFlags would consume the next non-flag token, so `--headers docs/x` would
  // silently look like `headers: "docs/x"` and check the default root while looking answered.
  if (f.headers !== undefined && f.headers !== true) {
    process.stderr.write("conductor: --headers takes no value (did you mean --root?)\n"); process.exit(1);
  }
  const absRoot = f.root ? path.resolve(ROOT, f.root) : SPECS_DIR;
  const state = loadState();
  if (f.headers) {
    process.stdout.write(formatHeaderCandidates(headerCandidates(state, absRoot)) + "\n");
    return;
  }
  process.stdout.write(formatSpecCoverage(specCoverage(state, absRoot)) + "\n");
}
