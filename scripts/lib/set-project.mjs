// scripts/lib/set-project.mjs
// `set-project --name <text> --key <KEY>` -- the project's name and its two- or three-letter key (change project-boards, spec
// project-identity).
//
// THE ENGINE NEVER INVENTS EITHER. It records what it is given and derives nothing, so a repo that has not been asked stays unset
// and the boards show their guided empty state. Each field has its inverse: `--unset name`, `--unset key`.
//
// The displayed epic key is `projectKey + "-" + number` and is computed on read (epic-number.mjs), so changing the key renames every
// epic at once and rewrites none. `set-project` therefore writes `state.json` and nothing else: it does not touch the managed
// rules block (neither value is in it) and it needs no render (PROJECT.md carries neither).
//
// TWO HALVES, as mission.mjs has: applyProject(state, f) is PURE over a record and returns a refusal or the change, and
// setProject() is the verb. A refusal writes nothing.

import { escapeControls } from "./constants.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { projectKeyError, projectNameError } from "./project-identity.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv } from "./invocation.mjs";

/** The fields `--unset` accepts, and the record key each one removes. */
const FIELDS = { name: "projectName", key: "projectKey" };

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

/** Apply one `set-project` invocation's flags to `state`. Pure: no disk, no output. Returns `{ok: false, message}` and leaves
 *  `state` untouched, or `{ok: true, changed, notes}`. `f` is parseFlags()'s result. */
export function applyProject(state, f) {
  const refuse = (message) => ({ ok: false, message: `${message} Nothing was written.` });
  const has = (k) => f[k] !== undefined;
  const unset = (Array.isArray(f.unset) ? f.unset : has("unset") ? [f.unset] : []);
  if (!has("name") && !has("key") && !unset.length) {
    return refuse("set-project needs an operation: --name \"<text>\", --key <KEY> (two or three uppercase letters), or --unset <name|key>.");
  }
  for (const u of unset) {
    if (!Object.hasOwn(FIELDS, u)) {
      return refuse(`--unset names ${escapeControls(JSON.stringify(u))}, which is not a project field: the fields are name and key.`);
    }
  }
  for (const field of Object.keys(FIELDS)) {
    if (has(field) && unset.includes(field)) {
      return refuse(`--${field} and --unset ${field} contradict each other: set the ${field} or remove it, not both.`);
    }
  }
  if (has("name")) {
    const err = projectNameError(last(f.name));
    if (err) return refuse(`${err}.`);
  }
  if (has("key")) {
    const err = projectKeyError(last(f.key));
    if (err) return refuse(`${err}.`);
  }
  const notes = [];
  let changed = false;
  const write = (field, value) => {
    const prop = FIELDS[field];
    if (state[prop] === value) { notes.push(`the project ${field} already reads exactly that`); return; }
    state[prop] = value; changed = true;
  };
  if (has("name")) write("name", last(f.name));
  if (has("key")) write("key", last(f.key));
  for (const u of [...new Set(unset)]) {
    const prop = FIELDS[u];
    if (Object.hasOwn(state, prop)) { delete state[prop]; changed = true; }
    else notes.push(`the project ${u} was not set`);
  }
  return { ok: true, changed, notes };
}

/** `set-project`. */
export function setProject() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  checkedPositionals("set-project");
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("set-project", f);
  const state = loadState();
  const r = applyProject(state, f);
  if (!r.ok) die(`conductor: ${r.message}\n`);
  const saved = saveState(state);
  const now = [state.projectName ? `name ${escapeControls(JSON.stringify(state.projectName))}` : "name unset",
    state.projectKey ? `key ${state.projectKey}` : "key unset"].join(", ");
  reportSave(saved, {
    changed: `conductor: project ${now}${r.notes.length ? ` (${r.notes.map(escapeControls).join("; ")})` : ""}`,
    unchanged: `conductor: project ${now} — ${r.notes.length ? r.notes.map(escapeControls).join("; ") + " — " : ""}${STATE_UNCHANGED}`,
  });
}
