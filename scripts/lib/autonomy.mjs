// scripts/lib/autonomy.mjs
// Per-epic autonomy read (getAutonomy) and the set-autonomy CLI verb. Circular with
// lib/render.mjs (setAutonomy calls render(); render() calls getAutonomy()) and needs
// lib/add-epic.mjs's parseFlags() -- see the design doc.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { KNOWN_AUTONOMY_LEVELS, KNOWN_PREAUTHORIZE_CATEGORIES } from "./constants.mjs";

// `autonomy` is optional per epic — absent means "off", today's behavior, unchanged.
// getAutonomy() is the ONLY place that should read epic.autonomy directly; everywhere
// else (render, brief, set-autonomy) calls this so a missing field never needs a
// migration to backfill — it defaults cleanly at read-time.
const DEFAULT_AUTONOMY = Object.freeze({ level: "off", preAuthorized: [], context: [], notifications: [] });
export function getAutonomy(epic) {
  const a = epic.autonomy;
  if (!a) return DEFAULT_AUTONOMY;
  return {
    level: a.level || "off",
    preAuthorized: Array.isArray(a.preAuthorized) ? a.preAuthorized : [],
    context: Array.isArray(a.context) ? a.context : [],
    notifications: Array.isArray(a.notifications) ? a.notifications : [],
  };
}

/** `set-autonomy <id> [--level off|autonomous] [--preauthorize "<action>:<reason>"]
 *  [--preauthorize "category:<name>:<reason>"] [--context "<note>"] [--notify "<what>"]` —
 *  writes/merges an epic's `autonomy` block. Every flag is additive (repeated calls APPEND
 *  to preAuthorized/context/notifications, never clobber) except --level, which replaces.
 *  A `--preauthorize` value starting with "category:" is stored as a category-based grant
 *  (`{ category, reason, grantedAt }`, no `action` field) distinct from an exact-action grant
 *  (`{ action, reason, grantedAt }`, no `category` field) — see KNOWN_PREAUTHORIZE_CATEGORIES
 *  and the `conductor` skill's "Epic-level autonomy" section for the matching heuristic each
 *  category expands to at decision-rule time. Pure local state write — no external calls,
 *  consistent with the engine's instruction-layer law. */
export function setAutonomy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    process.stderr.write(
      "usage: conductor.mjs set-autonomy <id> [--level off|autonomous] " +
      "[--preauthorize \"<action>:<reason>\"] [--preauthorize \"category:<filesystem|network|schema|external-api>:<reason>\"] " +
      "[--context \"<note>\"] [--notify \"<what>\"]\n");
    process.exit(1);
  }
  const f = parseFlags(argv.slice(1));
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  const level = typeof f.level === "string" ? f.level : undefined;
  if (level !== undefined && !KNOWN_AUTONOMY_LEVELS.includes(level)) {
    process.stderr.write(`conductor: --level must be one of ${KNOWN_AUTONOMY_LEVELS.join("|")}\n`);
    process.exit(1);
  }

  const a = { ...getAutonomy(epic) };
  if (level !== undefined) a.level = level;

  for (const s of (f.preauthorize || [])) {
    if (typeof s !== "string") continue;
    if (s.startsWith("category:")) {
      // "category:<name>:<reason>" — shorthand covering any action the decision rule matches
      // to that category, instead of enumerating each specific action string. See the
      // `conductor` skill's "Epic-level autonomy" section for the matching heuristic.
      const rest = s.slice("category:".length);
      const i = rest.indexOf(":");
      const category = (i === -1 ? rest : rest.slice(0, i)).trim();
      const reason = i === -1 ? undefined : rest.slice(i + 1).trim();
      if (!KNOWN_PREAUTHORIZE_CATEGORIES.includes(category)) {
        process.stderr.write(
          `conductor: --preauthorize category must be one of ${KNOWN_PREAUTHORIZE_CATEGORIES.join("|")}\n`);
        process.exit(1);
      }
      const entry = { category, grantedAt: new Date().toISOString() };
      if (reason) entry.reason = reason;
      a.preAuthorized = [...a.preAuthorized, entry];
      continue;
    }
    const i = s.indexOf(":");
    const action = i === -1 ? s.trim() : s.slice(0, i).trim();
    const reason = i === -1 ? undefined : s.slice(i + 1).trim();
    const entry = { action, grantedAt: new Date().toISOString() };
    if (reason) entry.reason = reason;
    a.preAuthorized = [...a.preAuthorized, entry];
  }
  for (const c of (f.context || [])) {
    if (typeof c === "string") a.context = [...a.context, c];
  }
  for (const n of (f.notify || [])) {
    if (typeof n === "string") a.notifications = [...a.notifications, { what: n, when: new Date().toISOString() }];
  }

  epic.autonomy = a;
  saveState(state);
  render();
  process.stderr.write(`conductor: autonomy for '${id}' is now level=${a.level}\n`);
}
