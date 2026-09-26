// scripts/lib/spec-sync.mjs
// "A delivered epic whose archived spec deltas are absent from the main specs is reported until they
// arrive" (gate-integrity; handoff-demand-blind-spots design D3–D6). Three layers, and only the last
// touches anything outside its arguments:
//
//   1. THE GRAMMAR — parseDelta() and mainRequirementNames(), pure functions of text. They mirror
//      OpenSpec's own reader, `@fission-ai/openspec` 1.13.2 `dist/core/parsers/requirement-blocks.js`
//      (with `code-fence.js` for the fence mask), rule by rule, because a header OpenSpec reads
//      differently from this check is a finding about nothing. The engine RE-IMPLEMENTS it rather than
//      importing OpenSpec: the engine is zero-runtime-dependency. Each rule is pinned by a unit fixture
//      (scripts/test/unit/spec-sync.test.mjs), so drift from a future OpenSpec shows up as a failing
//      arm rather than as a silent disagreement.
//   2. THE COMPARISON — compareSpecSync(), pure: archived changes' delta text and the index's main-spec
//      text in, findings out. Headers only (never bodies, design D4), and a later archived change that
//      touches the same header in the opposite direction discharges the obligation.
//   3. THE SURFACE — specSyncFindings(epics, { readIndex }), which reads the archive from disk and the
//      main specs from git's INDEX through ONE `cat-file --batch` (git.mjs indexFileContents). The
//      reader is a PARAMETER so a test hands it a stub returning a non-empty map; `integrity` and the
//      briefing both call it with the default, so the two surfaces cannot name different sets.
//
// IT IS A STANDING CONDITION, NEVER A REFUSAL (design D3). Nothing on an archive path imports this
// module: pm's own closeout records `delivered` before `openspec archive` moves the change, and a
// refusal here would need the archive commit to exist before the disposition it is gated on.

import fs from "node:fs";
import path from "node:path";
import { archiveDir, isOpenspecLane, shellQuote } from "./constants.mjs";
import { archivedChangeDir, archivedChanges } from "./epic-progress.mjs";
import { outcomeOf } from "./disposition.mjs";
import { indexFileContents } from "./git.mjs";

// ─────────────────────────────── 1. the grammar ───────────────────────────────

/** OpenSpec's header: `###`, optional whitespace, `Requirement:` (case-insensitive), optional
 *  whitespace, the name. So `###Requirement: X` and `### requirement: X` are headers. */
const REQUIREMENT_HEADER = /^###\s*Requirement:\s*(.+)\s*$/i;

/** A closing `#` run is stripped ONLY after a space or tab, so `C#` keeps its `#`; then trimmed.
 *  Names are compared case-sensitively afterwards. (requirement-blocks.js normalizeRequirementName) */
export function normalizeRequirementName(name) {
  return String(name).replace(/[ \t]+#+[ \t]*$/, "").trim();
}

/** U+FEFF, built from its code point rather than spelled in source. */
const BOM = String.fromCharCode(0xfeff);

/** A leading byte-order mark is removed and CRLF / lone CR become LF, before anything else. */
function normalizeLineEndings(content) {
  const text = String(content ?? "");
  return (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n?/g, "\n");
}

/** Lines inside a fenced code block — the fence lines included — are never headers or section
 *  titles. (code-fence.js buildCodeFenceMask: a run of 3+ backticks or tildes opens; the same
 *  character, at least as long, alone on its line, closes.) */
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let active = null;
  for (let i = 0; i < lines.length; i++) {
    if (!active) {
      const open = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
      if (open) { active = { ch: open[1][0], len: open[1].length }; mask[i] = true; }
      continue;
    }
    mask[i] = true;
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]);
    if (close && close[1][0] === active.ch && close[1].length >= active.len) active = null;
  }
  return mask;
}

/** Every `## ` section as a LIST, so a repeated title contributes every copy. */
function topLevelSections(lines, mask) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const m = /^(##)\s+(.+)$/.exec(lines[i]);
    if (m) heads.push({ title: m[2].trim(), index: i });
  }
  return heads.map((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].index : lines.length;
    return { title: h.title, lines: lines.slice(h.index + 1, end), mask: mask.slice(h.index + 1, end), start: h.index + 2 };
  });
}

/** The requirement headers in one section body (ADDED / MODIFIED / REMOVED header form). */
function headerNames(body) {
  const out = [];
  body.lines.forEach((l, i) => {
    if (body.mask[i]) return;
    const m = REQUIREMENT_HEADER.exec(l);
    if (m) out.push(normalizeRequirementName(m[1]));
  });
  return out;
}

/** REMOVED also accepts a header written as a `-`, `*` or `+` bullet with optional backticks. */
function removedNames(body) {
  const out = [];
  body.lines.forEach((l, i) => {
    if (body.mask[i]) return;
    const m = REQUIREMENT_HEADER.exec(l);
    if (m) { out.push(normalizeRequirementName(m[1])); return; }
    const b = /^\s*[-*+]\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(l);
    if (b) out.push(normalizeRequirementName(b[1]));
  });
  return out;
}

/** RENAMED: a `FROM:` line followed by a `TO:` line, each with an optional `-`/`*`/`+` bullet and
 *  optional backticks. Pairs form WITHIN one section body, never across two copies. A `FROM:` displaced
 *  by a second `FROM:`, a `TO:` with no pending `FROM:`, and a `FROM:` still pending at the section's end
 *  are each UNPAIRED — reported, never skipped. */
function renamedPairs(body, unpaired) {
  const pairs = [];
  let pending;
  body.lines.forEach((l, i) => {
    if (body.mask[i]) return;
    const from = /^\s*[-*+]?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(l);
    const to = /^\s*[-*+]?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(l);
    if (from) {
      if (pending) unpaired.push({ side: "FROM", name: pending.name, line: pending.line });
      pending = { name: normalizeRequirementName(from[1]), line: body.start + i };
    } else if (to) {
      const name = normalizeRequirementName(to[1]);
      if (!pending) { unpaired.push({ side: "TO", name, line: body.start + i }); return; }
      pairs.push({ from: pending.name, to: name });
      pending = undefined;
    }
  });
  if (pending) unpaired.push({ side: "FROM", name: pending.name, line: pending.line });
  return pairs;
}

/** Parse one delta spec: `{added, modified, removed, renamed: [{from, to}], unpaired: [{side, name,
 *  line}]}`. Section titles fold case-insensitively after trimming, and every copy of a repeated title
 *  is read; a requirement header outside any delta section is not part of the delta. */
export function parseDelta(text) {
  const lines = normalizeLineEndings(text).split("\n");
  const mask = fenceMask(lines);
  const sections = topLevelSections(lines, mask);
  const bodies = (title) => sections.filter(s => s.title.toLowerCase() === title.toLowerCase());
  const unpaired = [];
  const renamed = bodies("RENAMED Requirements").flatMap(b => renamedPairs(b, unpaired));
  unpaired.sort((a, b) => a.line - b.line);
  return {
    added: bodies("ADDED Requirements").flatMap(headerNames),
    modified: bodies("MODIFIED Requirements").flatMap(headerNames),
    removed: bodies("REMOVED Requirements").flatMap(removedNames),
    renamed, unpaired,
  };
}

/** The MAIN spec's requirement names, read ONLY from its `## Requirements` section (title matched
 *  case-insensitively, the first such section, to the next `## ` line) — the way OpenSpec's
 *  extractRequirementsSection() reads a main spec. A header elsewhere does not count as present. */
export function mainRequirementNames(text) {
  const lines = normalizeLineEndings(text).split("\n");
  const mask = fenceMask(lines);
  const start = lines.findIndex((l, i) => !mask[i] && /^##\s+Requirements\s*$/i.test(l));
  const names = new Set();
  if (start === -1) return names;
  for (let i = start + 1; i < lines.length; i++) {
    if (mask[i]) continue;
    if (/^##\s+/.test(lines[i])) break;
    const m = REQUIREMENT_HEADER.exec(lines[i]);
    if (m) names.add(normalizeRequirementName(m[1]));
  }
  return names;
}

// ─────────────────────────────── 2. the comparison ───────────────────────────────

/** A directory's `YYYY-MM-DD` prefix, or "" when it has none. */
export const archiveDate = (dir) => (/^\d{4}-\d{2}-\d{2}-/.test(dir) ? dir.slice(0, 10) : "");

/** May change `b` discharge an obligation of change `a`? Only when b is LATER — a strictly later date
 *  prefix — or the pair is UNORDERED: equal dates, or either one undated. The archive records no finer
 *  order, and a finding that guessed one would report a correct record (design D4). */
export function mayDischarge(a, b) {
  const da = archiveDate(a), db = archiveDate(b);
  if (!da || !db || da === db) return true;
  return db > da;
}

/** What one parsed delta requires of the main spec: names that must be PRESENT (ADDED, MODIFIED,
 *  RENAMED `TO`) and names that must be ABSENT (REMOVED, RENAMED `FROM`). */
function obligations(delta) {
  return {
    present: [...delta.added, ...delta.modified, ...delta.renamed.map(r => r.to)],
    absent: [...delta.removed, ...delta.renamed.map(r => r.from)],
  };
}

/**
 * THE COMPARISON, pure. `changes` is EVERY archived change directory — a discharging change need not
 * have an epic, or an in-scope one — as `{dir, deltas: {<capability>: <delta text>}}`. `inScope` is the
 * in-scope `{epic, dir}` pairs. `main` is `Map<capability, text|null>` (null = absent from the index,
 * which holds no headers) or `null` overall when git cannot answer — then no presence or absence finding
 * is made for anyone, while an unpaired RENAMED line, which depends on the delta alone, still is.
 *
 * A finding: `{epic, dir, capability, direction: "absent"|"present"|"unpaired", headers}`.
 *
 * DISCHARGE: an obligation of change A on header h of capability c is met by ANY other archived change B
 * whose delta for c touches h in the OPPOSITE direction, where mayDischarge(A, B). A later REMOVED or
 * RENAMED `FROM` discharges an ADDED, MODIFIED or RENAMED `TO`; a later ADDED, MODIFIED or RENAMED `TO`
 * discharges a REMOVED or RENAMED `FROM`. B's epic outcome is NOT read — a declared limit: a later change
 * archived with `--skip-specs`, or killed, still discharges (the false-negative direction).
 */
export function compareSpecSync({ changes, inScope, main }) {
  const parsed = new Map();
  for (const ch of changes || []) {
    const caps = new Map();
    for (const [cap, text] of Object.entries(ch.deltas || {})) caps.set(cap, parseDelta(text));
    parsed.set(ch.dir, caps);
  }
  const findings = [];
  for (const { epic, dir } of inScope || []) {
    const caps = parsed.get(dir);
    if (!caps) continue;
    for (const [cap, delta] of [...caps.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (delta.unpaired.length) {
        findings.push({ epic, dir, capability: cap, direction: "unpaired",
          headers: delta.unpaired.map(u => `${u.side}: ${u.name}`) });
      }
      if (main === null || main === undefined) continue;
      const own = obligations(delta);
      const discharged = (name, wantPresent) => [...parsed.entries()].some(([other, otherCaps]) => {
        if (other === dir || !mayDischarge(dir, other)) return false;
        const d = otherCaps.get(cap);
        if (!d) return false;
        const o = obligations(d);
        return (wantPresent ? o.absent : o.present).includes(name);
      });
      const text = main.get(cap);
      const names = typeof text === "string" ? mainRequirementNames(text) : new Set();
      const absent = [...new Set(own.present)].filter(h => !names.has(h) && !discharged(h, true));
      const present = [...new Set(own.absent)].filter(h => names.has(h) && !discharged(h, false));
      if (absent.length) findings.push({ epic, dir, capability: cap, direction: "absent", headers: absent });
      if (present.length) findings.push({ epic, dir, capability: cap, direction: "present", headers: present });
    }
  }
  return findings;
}

// ─────────────────────────────── 3. the surface ───────────────────────────────

/** Every `specs/<capability>/spec.md` delta in one archived change directory. */
function readDeltas(dir, root) {
  const specs = path.join(root, dir, "specs");
  const out = {};
  let caps = [];
  try { caps = fs.readdirSync(specs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return out; }
  for (const cap of caps.sort()) {
    try { out[cap] = fs.readFileSync(path.join(specs, cap, "spec.md"), "utf8"); } catch { /* no delta file */ }
  }
  return out;
}

/** An epic is IN SCOPE when the one resolver finds its archived change directory (that alone decides
 *  "archived" here, whatever the stored status says, so integrity and the briefing read the same
 *  directory), its lane is openspec (absent read as openspec) and its outcome is `delivered`. */
export function inSpecSyncScope(epic) {
  return !!epic && isOpenspecLane(epic) && outcomeOf(epic) === "delivered" && archivedChangeDir(epic) !== null;
}

/**
 * THE ONE FUNCTION both surfaces read. Reads the archive from disk and the main specs from git's INDEX
 * — one `readIndex` call for every capability an in-scope delta names, and no call at all when no epic
 * is in scope. `readIndex` defaults to git.mjs indexFileContents(); a test hands it a stub.
 */
export function specSyncFindings(epics, { readIndex = indexFileContents } = {}) {
  const inScope = (epics || []).filter(inSpecSyncScope).map(e => ({ epic: e.id, dir: archivedChangeDir(e) }));
  if (!inScope.length) return [];
  const root = archiveDir();
  const scopeDirs = new Set(inScope.map(s => s.dir));
  const changes = archivedChanges(root).map(({ dir }) => ({ dir, deltas: readDeltas(dir, root) }));
  const caps = new Set();
  for (const c of changes) if (scopeDirs.has(c.dir)) for (const cap of Object.keys(c.deltas)) caps.add(cap);
  const capList = [...caps].sort();
  const read = capList.length ? readIndex(capList.map(specPath)) : new Map();
  const main = read === null ? null : new Map(capList.map(cap => [cap, read.get(specPath(cap)) ?? null]));
  return compareSpecSync({ changes, inScope, main });
}

/** A capability's main spec, relative to the conductor root. */
export const specPath = (cap) => `openspec/specs/${cap}/spec.md`;

/** The finding's sentence, with the remedy in the order gate-integrity prints it: (0, for an unpaired
 *  RENAMED only) complete the pair in the archived delta; (1) make the main spec's `## Requirements`
 *  hold what the delta requires; (2) stage it, from the conductor root, which may be a subdirectory of
 *  the repository — hence `git -C <root>`, shell-quoted. Rendered here once for `integrity`; every line
 *  it builds is printed through that report's line sink. */
export function specSyncDetail(f, root) {
  const delta = `openspec/changes/archive/${f.dir}/specs/${f.capability}/spec.md`;
  const names = f.headers.map(h => JSON.stringify(h)).join(", ");
  const stage = `\`git -C ${shellQuote(root)} add openspec/\``;
  if (f.direction === "unpaired") {
    return `delivered, but its archived delta \`${delta}\` holds an unpaired RENAMED line (${names}), so it cannot be ` +
      `checked. Remedy: (0) complete the FROM:/TO: pair in \`${delta}\`; then (1) edit ` +
      `\`${specPath(f.capability)}\` so its \`## Requirements\` section holds what that delta requires; then (2) ${stage}.`;
  }
  const how = f.direction === "absent"
    ? `ABSENT from the index's \`${specPath(f.capability)}\` although the delta requires them present: ${names}`
    : `PRESENT in the index's \`${specPath(f.capability)}\` although the delta requires them absent: ${names}`;
  return `delivered, but archived change \`${f.dir}\`'s \`${f.capability}\` requirements are ${how}. Remedy, in order: ` +
    `(1) edit \`${specPath(f.capability)}\` so its \`## Requirements\` section holds what the archived delta ` +
    `\`${delta}\` requires — copy each header reported absent with its block from that delta, delete each ` +
    `block reported present, rename a RENAMED FROM header to its TO; then (2) ${stage}.`;
}
