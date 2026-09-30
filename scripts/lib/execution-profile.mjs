// scripts/lib/execution-profile.mjs
// The execution profile (execution-profile-layered-settings): the shared pair parser and validators
// (task 1.2) and, below them, the resolver (D2). PURE: nothing here loads state or writes anything.
// Every accepted value is read from the one declaration in constants.mjs.

import {
  KNOWN_EFFORTS, KNOWN_JOB_ROLES, KNOWN_MODELS, KNOWN_REVIEW_MODES, KNOWN_VERBOSITY_LEVELS,
  MODELS_WITHOUT_EFFORT, escapeControls,
} from "./constants.mjs";

/** Each validator returns `{ ok: true, value }` or `{ ok: false, message }`. The message names the
 *  offending value and the accepted list, and carries no `conductor:` prefix — the verb adds it. */
export function checkReview(text) {
  return KNOWN_REVIEW_MODES.includes(text)
    ? { ok: true, value: text }
    : { ok: false, message: `review '${escapeControls(String(text))}' is not one of ${KNOWN_REVIEW_MODES.join("|")}` };
}

export function checkVerbosity(text) {
  return KNOWN_VERBOSITY_LEVELS.includes(text)
    ? { ok: true, value: text }
    : { ok: false, message: `verbosity '${escapeControls(String(text))}' is not one of ${KNOWN_VERBOSITY_LEVELS.join("|")}` };
}

export function checkRole(text) {
  return KNOWN_JOB_ROLES.includes(text)
    ? { ok: true, value: text }
    : { ok: false, message: `job role '${escapeControls(String(text))}' is not one of ${KNOWN_JOB_ROLES.join("|")}` };
}

/** A `{model, effort?}` pair, already split. `haiku` takes no effort; every other model requires one,
 *  because a model with no effort leaves the job's cost undecided. */
export function checkPair(model, effort) {
  if (!KNOWN_MODELS.includes(model)) {
    return { ok: false, message: `model '${escapeControls(String(model))}' is not one of ${KNOWN_MODELS.join("|")}` };
  }
  if (MODELS_WITHOUT_EFFORT.includes(model)) {
    return effort === undefined
      ? { ok: true, value: { model } }
      : { ok: false, message: `${MODELS_WITHOUT_EFFORT.join("|")} is a model that takes no effort, so ':${escapeControls(String(effort))}' is refused` };
  }
  if (effort === undefined) {
    return { ok: false, message: `model '${escapeControls(String(model))}' needs an effort, one of ${KNOWN_EFFORTS.join("|")} (write ${escapeControls(String(model))}:<effort>)` };
  }
  if (!KNOWN_EFFORTS.includes(effort)) {
    return { ok: false, message: `effort '${escapeControls(String(effort))}' is not one of ${KNOWN_EFFORTS.join("|")}` };
  }
  return { ok: true, value: { model, effort } };
}

/** `<role>=<model>[:<effort>]` — the value of every `--model` flag, and the shape of an `add-many`
 *  batch entry's model string. Returns `{ ok: true, role, value }`. */
export function parseModelPair(text) {
  const s = String(text);
  const eq = s.indexOf("=");
  if (eq === -1) {
    return { ok: false, message: `model '${escapeControls(String(s))}' must be <role>=<model>[:<effort>], role one of ${KNOWN_JOB_ROLES.join("|")}` };
  }
  const role = checkRole(s.slice(0, eq));
  if (!role.ok) return role;
  const rest = s.slice(eq + 1);
  const colon = rest.indexOf(":");
  const pair = colon === -1 ? checkPair(rest) : checkPair(rest.slice(0, colon), rest.slice(colon + 1));
  return pair.ok ? { ok: true, role: role.value, value: pair.value } : pair;
}

/** `<field>` of `--unset`: `review | verbosity | model | model:<role>`. Returns
 *  `{ ok: true, field, role? }`; `model` alone means every role. */
export function parseUnsetField(text) {
  const s = String(text);
  if (s === "review" || s === "verbosity" || s === "model") return { ok: true, field: s };
  if (s.startsWith("model:")) {
    const role = checkRole(s.slice(6));
    return role.ok ? { ok: true, field: "model", role: role.value } : role;
  }
  return { ok: false, message: `unset field '${escapeControls(String(s))}' is not one of review|verbosity|model|model:<role> (role one of ${KNOWN_JOB_ROLES.join("|")})` };
}

// ─────────────── the resolver (D2) ───────────────

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const DEFAULT_REVIEW = "standard";
const DEFAULT_VERBOSITY = "quiet";

/** The layers of one field, most specific first. A layer is `{ source, review, verbosity, model }`
 *  holding the RAW stored values (a hand-edited one may be invalid; resolution checks them). D1's
 *  storage asymmetry lives here and nowhere else: the project's review is `state.reviewMode`, the
 *  lane's is `laneProfiles[<lane>].review`, the epic's is `epic.reviewMode`. */
function layersFor(state, epic, lane) {
  const layers = [];
  if (epic) layers.push({ source: "epic", review: epic.reviewMode, verbosity: epic.verbosity, model: epic.model });
  const lp = lane && isObj(state.laneProfiles) ? state.laneProfiles[lane] : undefined;
  if (isObj(lp)) layers.push({ source: `lane:${escapeControls(String(lane))}`, review: lp.review, verbosity: lp.verbosity, model: lp.model });
  const ep = isObj(state.executionProfile) ? state.executionProfile : {};
  layers.push({ source: "project", review: state.reviewMode, verbosity: ep.verbosity, model: ep.model });
  return layers;
}

/** Resolve one field across the layers. `read(layer)` returns `undefined` when the layer holds nothing,
 *  else the raw stored value; `check(raw)` returns `{ok, value}`. A stored value that fails its check
 *  is treated as unset at that layer, resolution falls through, and it is reported in `ignored`. When
 *  the winning layer is not the bottom one, `overrides` names the value it lowered or raised. */
function resolveField(layers, read, check, dflt) {
  const ignored = [];
  const valid = [];
  for (const layer of layers) {
    const raw = read(layer);
    if (raw === undefined || raw === null) continue;
    const c = check(raw);
    if (c.ok) valid.push({ source: layer.source, value: c.value });
    else ignored.push({ source: layer.source, value: raw });
  }
  const win = valid[0] || { value: dflt, source: "default" };
  const out = { value: win.value, source: win.source };
  const below = valid[1];
  if (below && JSON.stringify(below.value) !== JSON.stringify(win.value)) {
    out.overrides = { value: below.value, source: below.source };
  }
  if (ignored.length) out.ignored = ignored;
  return out;
}

const checkModelEntry = (raw) => (isObj(raw) ? checkPair(raw.model, raw.effort) : { ok: false });

/** The effective profile of an epic, a lane, or (with neither) the project — every field with the
 *  layer it came from. PURE: `state` in, a plain object out. `model` resolves PER ROLE and takes the
 *  `{model, effort}` pair whole from the first layer that sets that role. A detour epic has no layer
 *  of its own beyond the epic layer: nothing here follows a `detourStack` frame, so it never inherits
 *  from the epic it paused. `lane` defaults to the epic's own lane. */
export function resolveProfile(state, { epicId, lane } = {}) {
  const s = state || {};
  const epic = epicId ? (Array.isArray(s.epics) ? s.epics.find((e) => e && e.id === epicId) : undefined) : undefined;
  const useLane = lane || (epic && epic.lane) || undefined;
  const layers = layersFor(s, epic, useLane);
  const model = {};
  for (const role of KNOWN_JOB_ROLES) {
    model[role] = resolveField(layers, (l) => (isObj(l.model) ? l.model[role] : undefined), checkModelEntry, null);
  }
  return {
    review: resolveField(layers, (l) => l.review, checkReview, DEFAULT_REVIEW),
    verbosity: resolveField(layers, (l) => l.verbosity, checkVerbosity, DEFAULT_VERBOSITY),
    model,
  };
}
