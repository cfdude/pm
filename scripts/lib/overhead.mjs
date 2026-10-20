// scripts/lib/overhead.mjs
// `overhead [--json] [--all-features]` -- what pm itself injects into a session, SURFACE by surface and
// FEATURE by feature, every figure labelled with its method (pm-overhead-baseline).
//
// WHY. Rob, 2026-10-13: before any feature gets an off switch, pm needs a baseline of its own per-session
// token overhead with every feature on -- including the overhead of spend tracking itself. The managed rules
// block is re-read on every message (cache-read is 96.2% of attributed tokens), so a static byte count is the
// number that multiplies.
//
// WHAT IT IS NOT. An exact token count (the engine has no tokenizer and opens no network connection: the figure
// is bytes/4, labelled an estimate wherever it prints) and a claim about downstream efficiency (this verb
// measures what is injected, never what it saves). It reads no transcript and no spend ledger, writes nothing.
//
// ENUMERATED, NEVER TYPED (design D1): the rules sections come from rulesBlock()'s own `## ` split, the brief
// from the brief builder, the hook rows from hooks/hooks.json, the listings from the plugin's own files. A new
// section or hook shows up with no edit here -- and the map below FAILS a test until it is assigned a feature.
//
// ONE FEATURE PER SURFACE (design D2). `SURFACE_FEATURES` is keyed by surface id; `feature-switches-audit`
// and `developer-session-log` read it.

import fs from "node:fs";
import path from "node:path";
import { rulesBlock } from "./rules.mjs";
import { profileContext } from "./execution-profile.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { guardConfigured } from "./spend-guard.mjs";
import { OPT_INS } from "./opt-ins.mjs";
import { BRIEF_BYTE_CAP, byteSize, estimateTokens, fitBrief, rulesBlockSections } from "./session-cost.mjs";
import { buildBriefParts } from "./briefing.mjs";
import { adviceText, matchableLessons } from "./lessons.mjs";
import { reconcileBlockMessage } from "./gate-guard.mjs";
import { pluginRoot } from "./plugin-meta.mjs";
import { jsonText, escapeControls } from "./constants.mjs";
import { currentArgv, outStream } from "./invocation.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { die } from "./command-exit.mjs";

export const METHOD = "bytes/4";
export const CORE = "core";
export const LISTINGS = "listings";
/** The per-dispatch marker an agent writes first in a sub-agent prompt while spend tracking is on. */
export const SPEND_MARKER_LINE = "pm-spend: epic=<id> role=<role> phase=<phase> [round=<n>]\n";
export const DOWNSTREAM_LINE =
  "downstream efficiency: not measured by this verb -- see `spend-analysis` for measured spend; no saving is claimed here.";

/** Surface id -> feature id, for every surface whose id is fixed. `rules:*` ids are `rules:` + the heading
 *  slug; a section absent here and not matched by SURFACE_FEATURE_PATTERNS is a defect a test names. */
export const SURFACE_FEATURES = {
  "rules:pm-conductor": CORE,
  "rules:getting-help-with-pm": CORE,
  "rules:the-gate-procedure": CORE,
  "rules:intake": CORE,
  "rules:reporting": CORE,
  "rules:epic-level-autonomy": CORE,
  // Emitted whatever the profile holds; only reviewMode changes a VALUE inside it (design D2a).
  "rules:execution-profile": CORE,
  "rules:spend-tracking": "spendTracking",
  "rules:spend-guard": "spendGuard",
  "rules:release-candidate": CORE,
  "rules:feedback": CORE,
  "rules:re-read-the-source-before-an-epic-becomes-the-work": CORE,
  "rules:sync-after-completing-tracker-linked-work": "tracker",
  brief: CORE,
  snapshot: CORE,
  "hook:gate-guard": CORE,
  "hook:commit-nudge": CORE,
  "hook:lesson-advice": CORE,
  "spend-marker": "spendTracking",
};
/** The tracker sections carry the repo or project in their heading, so their ids are not fixed. */
export const SURFACE_FEATURE_PATTERNS = [
  { pattern: /^rules:[a-z]+(-[a-z]+)*-(issue|tracker)-sync(-\d+)?$/, feature: "tracker" },
];
/** Feature ids a surface may carry: core, listings, or an OPT_INS id. */
export const featureIds = () => [CORE, LISTINGS, ...OPT_INS.map(o => o.id)];

/** The ONE feature of a surface, or null when the map does not assign it. */
export function featureOf(id) {
  if (Object.hasOwn(SURFACE_FEATURES, id)) return SURFACE_FEATURES[id];
  if (id.startsWith("listing:")) return LISTINGS;
  const hit = SURFACE_FEATURE_PATTERNS.filter(p => p.pattern.test(id));
  return hit.length === 1 ? hit[0].feature : null;
}

/** A section heading's stable id part: the text before the first ` -- ` or ` (`, slugged. The repo or project a
 *  tracker heading carries is dropped, so the id does not move when the tracker does. */
export const slug = (s) => String(s).split(/\s+[\u2014\u2013]\s+|\s+\(/)[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const surface = (id, bytes, extra = {}) => ({
  id, feature: featureOf(id), bytes, estimatedTokens: bytes === null ? null : estimateTokens(bytes), method: METHOD,
  conditional: false, ...extra,
});

/** The named hypothetical of `--all-features` (design D4): every opt-in on, each at a documented
 *  representative value; an opt-in the real state already holds keeps its real value. */
export const HYPOTHETICAL = Object.freeze({
  name: "all-features",
  description: "every opt-in on: a github-issues tracker, reviewMode thorough, one lane-routing override, " +
    "the activity log, spend tracking on, a project spend-guard of 2 failed rounds",
});
/** A deep copy of `state` with every opt-in on. Pure, in memory: the argument is never touched. */
export function hypotheticalState(state) {
  const s = structuredClone(state || {});
  if (!(s.tracker && s.tracker.system)) s.tracker = { system: "github-issues", repo: "example/repo" };
  if (typeof s.reviewMode !== "string" || s.reviewMode === "") s.reviewMode = "thorough";
  if (!((s.laneRouting || {}).overrides || []).length) s.laneRouting = { overrides: [{ match: "migration", lane: "openspec" }] };
  s.activityLog = { ...(s.activityLog || {}), enabled: true };
  s.spendTracking = { ...(s.spendTracking || {}), enabled: true };
  if (!guardConfigured(s)) s.spendGuard = { ...(s.spendGuard || {}), maxFailedRounds: 2 };
  return s;
}

/** `description:` of a markdown file's frontmatter (plain, quoted, or a `>` / `|` block), or "". */
export function frontmatterDescription(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return "";
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex(l => /^description:/.test(l));
  if (i < 0) return "";
  const first = lines[i].replace(/^description:\s*/, "");
  if (/^[>|][+-]?$/.test(first)) {
    const body = [];
    for (const l of lines.slice(i + 1)) { if (/^\s+\S/.test(l) || l === "") body.push(l.trim()); else break; }
    return body.join(" ").trim();
  }
  return first.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

/** The shipped command, skill and agent listings as `[{file, name, description}]`: the host lists these
 *  whatever is switched on. Reads the plugin's own files (the FILE rung); `root` is injectable. */
export function readListings(root = pluginRoot()) {
  const out = [];
  const add = (rel, name) => {
    let text = "";
    try { text = fs.readFileSync(path.join(root, rel), "utf8"); } catch { return; }
    out.push({ file: rel, name, description: frontmatterDescription(text) });
  };
  const ls = (d) => { try { return fs.readdirSync(path.join(root, d)).sort(); } catch { return []; } };
  for (const f of ls("commands").filter(f => f.endsWith(".md"))) add(`commands/${f}`, f.replace(/\.md$/, ""));
  for (const d of ls("skills")) add(`skills/${d}/SKILL.md`, d);
  for (const f of ls("agents").filter(f => f.endsWith(".md"))) add(`agents/${f}`, f.replace(/\.md$/, ""));
  return out;
}

/** The hook verbs hooks/hooks.json invokes, in file order, deduplicated. Reads the plugin's own file. */
export function hookVerbs(root = pluginRoot()) {
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8")); } catch { return []; }
  const verbs = [];
  for (const entries of Object.values(doc.hooks || {})) {
    for (const entry of entries) for (const h of entry.hooks || []) {
      const m = /conductor\.mjs"?\s+([a-z-]+)/.exec(h.command || "");
      if (m && !verbs.includes(m[1])) verbs.push(m[1]);
    }
  }
  return verbs;
}

/** The managed rules block for `state`, built from the record alone (no reads). */
export function rulesBlockFor(state, platform = "claude-code") {
  const s = state || {};
  const tracker = s.tracker && s.tracker.system ? s.tracker : null;
  const mode = typeof s.reviewMode === "string" && s.reviewMode ? s.reviewMode : "standard";
  const secondary = Array.isArray(s.secondaryTrackers) ? s.secondaryTrackers : [];
  return rulesBlock(tracker, mode, secondary, platform, profileContext(s, undefined), spendEnabled(s), guardConfigured(s));
}

/** Every surface for `state`. PURE over its inputs: `listings`, `hooks` and `lessons` are handed in. */
export function collectSurfaces(state, { platform = "claude-code", listings = [], hooks = [], lessons = [] } = {}) {
  const out = [];
  const seen = new Map();
  for (const sec of rulesBlockSections(rulesBlockFor(state, platform))) {
    const base = `rules:${slug(sec.heading)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    // Several secondary trackers share a heading stem: the second and later get `-2`, `-3`.
    out.push(surface(n === 1 ? base : `${base}-${n}`, sec.bytes, { title: sec.heading }));
  }
  // The brief: capped, consume false and no spec-sync (a git read), exactly as `upgrade` measures it.
  const { plain, parts } = buildBriefParts(state, { consume: false, specSync: false });
  out.push(surface("brief", fitBrief(parts, { plain, cap: BRIEF_BYTE_CAP }).bytes));
  // The snapshot is WRITTEN to .conductor/brief.txt on PreCompact and read by nothing: it is not injected.
  out.push(surface("snapshot", byteSize(plain + "\n"), {
    conditional: true, note: "written to .conductor/brief.txt on PreCompact; not injected into the context",
  }));
  if (hooks.includes("gate-guard")) {
    out.push(surface("hook:gate-guard", byteSize(reconcileBlockMessage({ id: "<epic-id>" }, null)), {
      conditional: true, note: "fires only while the active epic owes a reconcile",
    }));
  }
  if (hooks.includes("commit-nudge")) {
    out.push(surface("hook:commit-nudge", null, {
      conditional: true, measured: false,
      note: "fires after a commit lands; its text depends on the commits observed, so no static size is reported",
    }));
  }
  if (hooks.includes("lesson-advice")) {
    const worst = lessons.reduce((a, l) => (!a || String(l.rule).length > String(a.rule).length ? l : a), null);
    out.push(surface("hook:lesson-advice", worst ? byteSize(adviceText([worst])) : 0, {
      conditional: true,
      note: worst ? "fires only on a command a lesson's detect: matcher matches; sized for the longest single lesson"
        : "fires only on a matching command; this repository has no matchable lesson",
    }));
  }
  for (const l of listings) {
    out.push(surface(`listing:${l.file}`, byteSize(`${l.name}: ${l.description}\n`), { title: l.name }));
  }
  // Spend tracking's per-dispatch cost: instructed (and so paid) only while tracking is on.
  out.push(surface("spend-marker", spendEnabled(state) ? byteSize(SPEND_MARKER_LINE) : 0, {
    perDispatch: true, note: "one marker line per sub-agent dispatch, while tracking is on",
  }));
  return out;
}

/** The report: surfaces, features, the unconditional session total. PURE. */
export function buildReport(state, inputs = {}) {
  const surfaces = collectSurfaces(state, inputs);
  const on = (id) => id === CORE || id === LISTINGS || OPT_INS.some(o => o.id === id && o.isSet(state || {}));
  const features = {};
  for (const id of featureIds()) features[id] = { on: on(id), bytes: 0, estimatedTokens: 0, surfaces: [] };
  for (const s of surfaces) {
    const f = features[s.feature];
    if (!f) continue;
    f.surfaces.push(s.id);
    if (s.perDispatch) { f.perDispatchBytes = (f.perDispatchBytes || 0) + (s.bytes || 0); continue; }
    if (!s.conditional) f.bytes += s.bytes || 0;
  }
  for (const f of Object.values(features)) {
    f.estimatedTokens = estimateTokens(f.bytes);
    if (f.perDispatchBytes !== undefined) f.perDispatchEstimatedTokens = estimateTokens(f.perDispatchBytes);
  }
  const unconditional = surfaces.filter(s => !s.conditional && !s.perDispatch).reduce((a, s) => a + s.bytes, 0);
  return {
    method: METHOD, hypothetical: null, surfaces, features,
    total: {
      bytes: unconditional, estimatedTokens: estimateTokens(unconditional), method: METHOD,
      note: "counts unconditional surfaces only; conditional hooks, the snapshot and per-dispatch costs are excluded",
    },
    downstream: DOWNSTREAM_LINE,
  };
}

/** `--all-features`: the same report over the hypothetical, plus each feature's delta against the real state. */
export function buildHypotheticalReport(state, inputs = {}) {
  const real = buildReport(state, inputs);
  const hyp = buildReport(hypotheticalState(state), inputs);
  hyp.hypothetical = { ...HYPOTHETICAL };
  for (const [id, f] of Object.entries(hyp.features)) {
    const r = real.features[id];
    f.on = true;
    f.realOn = r.on;
    f.wouldAddBytes = f.bytes - r.bytes;
    f.wouldAddEstimatedTokens = estimateTokens(Math.max(0, f.wouldAddBytes));
  }
  hyp.realTotal = real.total;
  return hyp;
}

const tok = (bytes) => bytes === null ? "size not measurable" : `~${estimateTokens(bytes)} tokens (bytes/4, estimate)`;

/** The text report. Listings are summarised (one line); `--json` carries every one. */
export function overheadText(r) {
  const L = [];
  L.push(r.hypothetical
    ? `pm overhead -- HYPOTHETICAL "${r.hypothetical.name}": ${r.hypothetical.description}. Nothing was written.`
    : "pm overhead -- this repository, as configured");
  L.push("");
  L.push("by feature (unconditional bytes injected into a session):");
  for (const [id, f] of Object.entries(r.features)) {
    let line = `  ${id.padEnd(14)} ${f.on ? "on " : "off"}  ${String(f.bytes).padStart(7)} bytes  ${tok(f.bytes)}`;
    if (f.perDispatchBytes !== undefined) line += `  + ${f.perDispatchBytes} bytes per dispatch (${tok(f.perDispatchBytes)})`;
    if (f.wouldAddBytes !== undefined && !f.realOn) line += `  [would add ${f.wouldAddBytes} bytes, ${tok(f.wouldAddBytes)}]`;
    L.push(line);
  }
  L.push("");
  L.push("surfaces:");
  const listed = r.surfaces.filter(s => s.id.startsWith("listing:"));
  for (const s of r.surfaces.filter(s => !s.id.startsWith("listing:"))) {
    const tag = s.conditional ? " [conditional]" : s.perDispatch ? " [per dispatch]" : "";
    L.push(`  ${s.id}  (${s.feature})  ${s.bytes === null ? "-" : s.bytes + " bytes"}  ${tok(s.bytes)}${tag}${s.note ? ` -- ${s.note}` : ""}`);
  }
  if (listed.length) {
    const b = listed.reduce((a, s) => a + s.bytes, 0);
    L.push(`  listing:* x${listed.length}  (listings)  ${b} bytes  ${tok(b)} -- command, skill and agent descriptions; \`--json\` lists each`);
  }
  L.push("");
  L.push(`session total: ${r.total.bytes} bytes, ${tok(r.total.bytes)} -- ${r.total.note}`);
  L.push(r.downstream);
  return L.map(escapeControls).join("\n") + "\n";
}

/** READ-ONLY. Opens no spend, ledger, transcript or network path. */
export function overhead() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("overhead", f);
  const state = loadState();
  let lessons = [];
  try { lessons = matchableLessons().map(l => ({ rule: l.rule, file: l.file })); } catch { /* no corpus is no lesson */ }
  const inputs = { listings: readListings(), hooks: hookVerbs(), lessons };
  const report = f["all-features"] === true ? buildHypotheticalReport(state, inputs) : buildReport(state, inputs);
  if (f.json === true) { outStream().write(jsonText(report, null, 2) + "\n"); return; }
  outStream().write(overheadText(report));
}
