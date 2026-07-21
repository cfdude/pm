// scripts/lib/plugin-meta.mjs
// The running plugin's own version/changelog, and comparing it against what's
// installed. Depends on lib/state.mjs (readJSON).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON } from "./state.mjs";

/** The running plugin's root dir. Env-first so tests can point at a fixture.
 *  NOTE: this file lives at scripts/lib/plugin-meta.mjs, one directory deeper than the
 *  original scripts/conductor.mjs — hence ".." TWICE (lib/ -> scripts/ -> plugin root),
 *  not once. */
export function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT
    ? process.env.CLAUDE_PLUGIN_ROOT
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The running plugin's release. Env-first so tests can point at a fixture plugin.json. */
export function pluginVersion() {
  const pj = readJSON(path.join(pluginRoot(), ".claude-plugin", "plugin.json"), null);
  return pj && pj.version ? String(pj.version) : null;
}

/** Parse the plugin's own CHANGELOG.md into [{version, body}] sections (file order,
 *  newest-first). Returns null if no CHANGELOG ships with this version. Zero-dep:
 *  sections are delimited by `## [x.y.z]` headers. */
export function changelogSections() {
  let txt;
  try { txt = fs.readFileSync(path.join(pluginRoot(), "CHANGELOG.md"), "utf8"); }
  catch { return null; }
  const sections = [];
  let cur = null;
  for (const line of txt.split("\n")) {
    const m = line.match(/^##\s+\[(\d+\.\d+\.\d+)\]/);
    if (m) { cur = { version: m[1], lines: [line] }; sections.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return sections.map(s => ({
    version: s.version,
    body: s.lines.join("\n").replace(/\n*-{3,}\s*$/, "").trimEnd(),
  }));
}

/** CHANGELOG sections with version in (fromVer, toVer]. `fromVer`/`toVer` may be null
 *  (open bound). Returns null only when no CHANGELOG exists. */
export function changelogBetween(fromVer, toVer) {
  const secs = changelogSections();
  if (secs === null) return null;
  return secs.filter(s =>
    (fromVer == null || cmpVer(s.version, fromVer) > 0) &&
    (toVer == null || cmpVer(s.version, toVer) <= 0));
}

/** Top "Added" bullet headlines (first line of each bullet only, no continuation lines)
 *  across CHANGELOG sections with version in (fromVer, toVer], newest-first, capped at
 *  `limit`. Returns [] if no CHANGELOG ships or no Added bullets fall in range — never
 *  null, so callers can splice it in unconditionally. */
export function changelogAddedHeadlines(fromVer, toVer, limit = 3) {
  const secs = changelogBetween(fromVer, toVer);
  if (!secs) return [];
  const out = [];
  for (const s of secs) {
    if (out.length >= limit) break;
    let inAdded = false;
    for (const line of s.body.split("\n")) {
      if (/^###\s+Added\b/.test(line)) { inAdded = true; continue; }
      if (/^###\s+/.test(line)) { inAdded = false; continue; }
      if (inAdded && /^-\s+/.test(line)) {
        out.push(line.replace(/^-\s+/, "").trim());
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

/** Highest pm version present in the plugin cache, or null if it can't be determined.
 *  Cache root is env-overridable for testability. Per-entry resilient: one bad
 *  plugin.json doesn't collapse the scan. */
export function newestInstalledVersion() {
  const cacheRoot = process.env.PM_CACHE_ROOT || path.join(os.homedir(), ".claude", "plugins", "cache");
  let best = null;
  try {
    for (const mp of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!mp.isDirectory()) continue;
      const pmDir = path.join(cacheRoot, mp.name, "pm");
      let versions;
      try { versions = fs.readdirSync(pmDir, { withFileTypes: true }); } catch { continue; }
      for (const v of versions) {
        if (!v.isDirectory()) continue;
        const pj = readJSON(path.join(pmDir, v.name, ".claude-plugin", "plugin.json"), null);
        const ver = pj && pj.version ? String(pj.version) : null;
        if (ver && (best === null || cmpVer(ver, best) > 0)) best = ver;
      }
    }
  } catch { /* cache root absent/unreadable → null */ }
  return best;
}

/** Numeric semver compare: <0 if a<b, 0 if equal, >0 if a>b. */
export function cmpVer(a, b) {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function stampVersion(state) {
  const v = pluginVersion();
  if (v) state.pmVersion = v;
}
