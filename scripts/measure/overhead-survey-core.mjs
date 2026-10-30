// scripts/measure/overhead-survey-core.mjs
// pm-overhead-calibration-and-feature-switches B1 -- the CORE of the transcript survey. DEV TOOLING,
// not the engine: it lives outside scripts/lib/, spends no model tokens, and adds nothing to what a
// user installs. Pure: it takes strings and rows and returns values; the module that opens files is
// overhead-survey.mjs.
//
// WHAT IT KEEPS, per session: the token COUNTS of the first assistant message, its model id, and ONE
// boolean (was pm's SessionStart brief hook present before that message). Nothing else about a
// message is read into a result: the hook's command string is tested in memory and dropped, and no
// `content` / `stdout` field of any entry is ever looked at.
//
// IT CONSUMES `parseEntry` / `foldRows` from scripts/lib/spend-reader.mjs and never re-implements the
// fold. A later change to either changes this survey's numbers: re-read this file when you touch them.
//
// HOW pm's BRIEF REACHES A TRANSCRIPT. As an `attachment` entry, `attachment.type == "hook_success"`,
// `hookName` `SessionStart:<source>`, whose `attachment.command` is pm's `... conductor.mjs" brief ...`.
// pm's SessionStart matcher is `startup|resume|compact` (hooks/hooks.json), NOT `clear`, so a `clear`
// session in a pm repo has no brief by design. Validated 2026-10-29 over this repo's 99 transcripts:
// every `startup` session from `cli` / `sdk-cli` showed the hook, every `clear` session did not, and
// all 86 `sdk-py` sessions have no SessionStart attachment at all.

import { foldRows, parseEntry, sourceInfo } from "../lib/spend-reader.mjs";

/** The command string pm's SessionStart hook runs (hooks/hooks.json), matched against the attachment's
 *  COMMAND field only. */
export const BRIEF_HOOK = /scripts\/conductor\.mjs"? brief\b/;

export const START_VALUES = Object.freeze(["startup", "resume", "clear", "compact", "other", "none"]);
export const ENTRYPOINT_VALUES = Object.freeze(["cli", "sdk-cli", "sdk-py", "other"]);

/** Every key the serialised aggregate may hold. A key added to `aggregate()` without being added here
 *  fails the unit test, in a diff a reviewer reads. The reason keys under `excluded.byReason` are data
 *  drawn from a closed set and are compared separately. */
export const AGGREGATE_KEYS = Object.freeze([
  "schema", "method", "population", "headline", "headlineSessions", "groups", "briefPresent", "model", "n",
  "input", "cacheCreation", "cacheRead", "total", "inputPlusCacheCreation", "median", "p10", "p90", "min", "max",
  "withinProject", "overall", "byModel", "pairs", "projects", "pairsWithAtLeast5PerSide",
  "medianDeltaTotal", "medianDeltaInputPlusCacheCreation", "excluded", "byReason", "sessionsRead", "projectsRead",
]);

const SAFE_MODEL = /^[A-Za-z0-9._:[\]-]{1,80}$/;
const safeModel = (m) => (typeof m === "string" && SAFE_MODEL.test(m) ? m : "other");

// ───────────────────────────── the first message of one session ─────────────────────────────

const startOf = (hookName) => {
  const s = String(hookName).slice("SessionStart:".length);
  return START_VALUES.includes(s) && s !== "none" && s !== "other" ? s : "other";
};
const entrypointOf = (e) => (ENTRYPOINT_VALUES.includes(e) && e !== "other" ? e : "other");

/** An incremental scanner over one transcript's lines. `push(line)` returns true once the first main-chain
 *  assistant message is FOLDED (a different assistant message id, or any `user` entry, ends it), after
 *  which the caller can close the file: nothing later is needed and later bytes are never parsed.
 *  `pushOversize()` records a line too long to hold; an oversize line before the end voids the session,
 *  because the first message might have been that line. */
export function createScanner() {
  let entrypoint = null;
  let start = "none";
  let brief = false;
  let rows = [];
  let firstId = null;
  let oversize = false;
  let done = false;
  const SOURCE = sourceInfo("p/s.jsonl");
  return {
    pushOversize() { if (!done) oversize = true; },
    push(text) {
      if (done) return true;
      let obj;
      try { obj = JSON.parse(text); } catch { return false; }
      if (!obj || typeof obj !== "object") return false;
      if (entrypoint === null && typeof obj.entrypoint === "string") entrypoint = obj.entrypoint;
      if (obj.type === "attachment") {
        const a = obj.attachment;
        if (firstId === null && a && a.type === "hook_success" && typeof a.hookName === "string" && a.hookName.startsWith("SessionStart:")) {
          if (start === "none") start = startOf(a.hookName);
          if (a.exitCode === 0 && typeof a.command === "string" && BRIEF_HOOK.test(a.command)) brief = true;
        }
        return false;
      }
      if (obj.type === "user") { if (firstId !== null) done = true; return done; }
      if (obj.type !== "assistant") return false;
      const parsed = parseEntry(text, SOURCE);
      if (!parsed.row || parsed.row.actor !== "orchestrator") return false;
      if (firstId === null) firstId = parsed.row.messageId;
      if (parsed.row.messageId !== firstId) { done = true; return true; }
      rows.push(parsed.row);
      return false;
    },
    result() {
      if (oversize) return { skip: "oversize-line" };
      if (firstId === null) return { skip: "no-assistant-message" };
      const r = foldRows(rows)[0];
      return {
        model: r.model, input: r.input, cacheCreation: r.cacheCreation, cacheRead: r.cacheRead, output: r.output,
        briefPresent: brief, start, entrypoint: entrypointOf(entrypoint),
      };
    },
  };
}

/** The first assistant message of a session, from its lines: `{model, input, cacheCreation, cacheRead,
 *  output, briefPresent, start, entrypoint}` or `{skip: <closed reason>}`. */
export function firstMessage(lines) {
  const s = createScanner();
  for (const l of lines) if (s.push(l)) break;
  return s.result();
}

// ───────────────────────────── which projects are read at all ─────────────────────────────

const EMPLOYER_REPOS = Object.freeze(["claude-chatbot", "mortgage-closer", "bitbucket-mcp", "zendesk-mcp"]);

/** Why an encoded project directory is never read, or null. A transcript directory has no git remote to
 *  test, so this is by NAME: any `highway` (case-insensitive: the `highway-` prefix, a `Documents-Highway`
 *  path and an `~/Highway` tree all contain it) and the four employer-hosted repos. Rob's rule can only be
 *  widened here, never narrowed. */
export function exclusionReason(encodedDir) {
  const d = String(encodedDir);
  if (/highway/i.test(d)) return "highway";
  for (const r of EMPLOYER_REPOS) if (new RegExp(`(^|-)${r}(-|$)`, "i").test(d)) return "employer-repo";
  return null;
}
export const projectClass = (encodedDir) => (exclusionReason(encodedDir) ? "excluded" : "included");

// ───────────────────────────── the aggregate ─────────────────────────────

const sortNum = (xs) => [...xs].sort((a, b) => a - b);
const median = (sorted) => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};
/** Nearest-rank percentile on a sorted list. */
const pct = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
const stats = (xs) => {
  const s = sortNum(xs);
  return { median: median(s), p10: pct(s, 0.1), p90: pct(s, 0.9), min: s[0], max: s[s.length - 1] };
};
const totalOf = (r) => r.input + r.cacheCreation + r.cacheRead;
const ipcc = (r) => r.input + r.cacheCreation;

const isHeadline = (r) => r.start === "startup" && (r.entrypoint === "cli" || r.entrypoint === "sdk-cli");

/** Why a non-headline row is outside the headline population, as a closed reason. */
const notHeadlineReason = (r) => {
  if (r.entrypoint !== "cli" && r.entrypoint !== "sdk-cli") return `entrypoint-${r.entrypoint}`;
  return `start-${r.start}`;
};

/** Per-session rows -> the committed aggregate. HEADLINE population only (`startup`, `cli` / `sdk-cli`,
 *  an included project) is summarised, per `briefPresent x model`; every other class is COUNTED by reason.
 *  No project name and no session id leaves this function: projects are used as grouping keys and
 *  dropped. `extra.skipped` is `{reason: count}` for sessions the walk could not fold;
 *  `extra.excludedProjects` is `{reason: count}` of SESSIONS FILES NOT READ because of their project. */
export function aggregate(rows, extra = {}) {
  const head = rows.filter(isHeadline);
  const byReason = {};
  const bump = (k, by = 1) => { if (by > 0) byReason[k] = (byReason[k] || 0) + by; };
  for (const r of rows) if (!isHeadline(r)) bump(notHeadlineReason(r));
  for (const [k, v] of Object.entries(extra.excludedProjects || {})) bump(`project-${k}`, v);
  for (const [k, v] of Object.entries(extra.skipped || {})) bump(k, v);

  const groupsMap = new Map();
  for (const r of head) {
    const key = `${r.briefPresent ? 1 : 0}\u0000${safeModel(r.model)}`;
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(r);
  }
  const groups = [...groupsMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, rs]) => ({
      briefPresent: key.startsWith("1"),
      model: key.slice(2),
      n: rs.length,
      input: stats(rs.map((r) => r.input)),
      cacheCreation: stats(rs.map((r) => r.cacheCreation)),
      cacheRead: stats(rs.map((r) => r.cacheRead)),
      total: stats(rs.map(totalOf)),
      inputPlusCacheCreation: stats(rs.map(ipcc)),
    }));

  // WITHIN-PROJECT: per (project, model) holding both sides, on-minus-off of the two medians.
  const cells = new Map();
  for (const r of head) {
    const k = `${r.project}\u0000${safeModel(r.model)}`;
    if (!cells.has(k)) cells.set(k, { project: r.project, model: safeModel(r.model), on: [], off: [] });
    cells.get(k)[r.briefPresent ? "on" : "off"].push(r);
  }
  const pairs = [...cells.values()].filter((c) => c.on.length && c.off.length).map((c) => ({
    project: c.project, model: c.model,
    total: median(sortNum(c.on.map(totalOf))) - median(sortNum(c.off.map(totalOf))),
    ipcc: median(sortNum(c.on.map(ipcc))) - median(sortNum(c.off.map(ipcc))),
    enough: c.on.length >= 5 && c.off.length >= 5,
  }));
  const summarise = (ps) => ({
    pairs: ps.length,
    projects: new Set(ps.map((p) => p.project)).size,
    pairsWithAtLeast5PerSide: ps.filter((p) => p.enough).length,
    medianDeltaTotal: ps.length ? median(sortNum(ps.map((p) => p.total))) : null,
    medianDeltaInputPlusCacheCreation: ps.length ? median(sortNum(ps.map((p) => p.ipcc))) : null,
  });
  const models = [...new Set(pairs.map((p) => p.model))].sort();

  return {
    schema: 1,
    method: "first main-chain assistant message of each session; headline = SessionStart source startup, entrypoint cli or sdk-cli, project not excluded; total = input + cacheCreation + cacheRead; percentiles are nearest-rank",
    population: { headline: "startup sessions from cli and sdk-cli", headlineSessions: head.length, sessionsRead: rows.length },
    groups,
    withinProject: { overall: summarise(pairs), byModel: models.map((m) => ({ model: m, ...summarise(pairs.filter((p) => p.model === m)) })) },
    excluded: { byReason },
  };
}
