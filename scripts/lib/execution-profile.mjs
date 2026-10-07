// scripts/lib/execution-profile.mjs
// The execution profile (execution-profile-layered-settings): the shared pair parser and validators
// (task 1.2) and, below them, the resolver (D2). PURE: nothing here loads state or writes anything.
// Every accepted value is read from the one declaration in constants.mjs.

import {
  KNOWN_EFFORTS, KNOWN_JOB_ROLES, KNOWN_LANES, KNOWN_MODELS, KNOWN_REVIEW_MODES, KNOWN_VERBOSITY_LEVELS,
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

// ─────────────── set-profile: parsing and the pure write (D4) ───────────────

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Turn `set-profile`'s parsed flags into `{ ok: true, ops }`, or `{ ok: false, message }` naming the
 *  first refusal. PURE: it decides whether the call is well-formed and writes nothing.
 *  Refuses: no operation named; an unknown lane; any value outside its closed list (the message
 *  names the accepted values); the same field both set and unset in one call. */
export function parseSetProfile(f) {
  const models = asArray(f.model);
  const unsets = asArray(f.unset);
  const hasReview = f.review !== undefined;
  const hasVerbosity = f.verbosity !== undefined;
  if (!hasReview && !hasVerbosity && models.length === 0 && unsets.length === 0) {
    return {
      ok: false,
      message: "set-profile needs an operation — --review <m>, --model <role>=<model>[:<effort>], " +
        "--verbosity <level> or --unset <field>. Nothing was written.",
    };
  }
  const lane = f.lane;
  if (lane !== undefined && !KNOWN_LANES.includes(lane)) {
    return { ok: false, message: `--lane '${escapeControls(String(lane))}' is not one of ${KNOWN_LANES.join("|")}` };
  }
  const ops = { lane, models: {}, unsets: [] };
  if (hasReview) {
    const r = checkReview(f.review);
    if (!r.ok) return r;
    ops.review = r.value;
  }
  if (hasVerbosity) {
    const v = checkVerbosity(f.verbosity);
    if (!v.ok) return v;
    ops.verbosity = v.value;
  }
  for (const m of models) {
    const p = parseModelPair(m);
    if (!p.ok) return p;
    ops.models[p.role] = p.value;
  }
  for (const u of unsets) {
    const p = parseUnsetField(u);
    if (!p.ok) return p;
    ops.unsets.push({ field: p.field, role: p.role });
  }
  // The same field set and unset in one call is a question, not a default.
  const setFields = new Set();
  if (ops.review !== undefined) setFields.add("review");
  if (ops.verbosity !== undefined) setFields.add("verbosity");
  for (const role of Object.keys(ops.models)) setFields.add(`model:${role}`);
  for (const u of ops.unsets) {
    const names = u.field === "model" && !u.role ? KNOWN_JOB_ROLES.map((r) => `model:${r}`) : [u.field === "model" ? `model:${u.role}` : u.field];
    const clash = names.find((n) => setFields.has(n));
    if (clash) {
      return { ok: false, message: `${clash.replace(":", " ")} is both set and unset in one call — say one or the other` };
    }
  }
  return { ok: true, ops };
}

const snapshot = (state) => JSON.stringify([state.reviewMode, state.executionProfile, state.laneProfiles]);

/** Apply `ops` (from parseSetProfile) to `state` in place, at the project layer or the `ops.lane`
 *  layer. Returns `{ changed, already, described }`: whether anything moved, the unset fields that
 *  were already unset, and one phrase per operation. Setting one model role leaves the others; an
 *  emptied lane layer (or project `executionProfile`) is REMOVED, so it is indistinguishable from one
 *  never configured. The project `review` is `state.reviewMode` (D1: the existing key is reused). */
export function applyProfileOps(state, ops) {
  const before = snapshot(state);
  const already = [];
  const described = [];
  const lane = ops.lane;
  const container = lane
    ? (isObj(state.laneProfiles) ? state.laneProfiles[lane] : undefined)
    : state.executionProfile;
  const layer = isObj(container) ? { ...container } : {};
  if (isObj(layer.model)) layer.model = { ...layer.model };

  const getReview = () => (lane ? layer.review : state.reviewMode);
  const putReview = (v) => {
    if (lane) { if (v === undefined) delete layer.review; else layer.review = v; }
    else if (v === undefined) delete state.reviewMode;
    else state.reviewMode = v;
  };
  if (ops.review !== undefined) { putReview(ops.review); described.push(`review=${ops.review}`); }
  if (ops.verbosity !== undefined) { layer.verbosity = ops.verbosity; described.push(`verbosity=${ops.verbosity}`); }
  for (const role of KNOWN_JOB_ROLES) {
    const pair = ops.models[role];
    if (!pair) continue;
    layer.model = { ...(isObj(layer.model) ? layer.model : {}), [role]: pair };
    described.push(`model.${role}=${pair.model}${pair.effort ? `:${pair.effort}` : ""}`);
  }
  for (const u of ops.unsets) {
    if (u.field === "review") {
      if (getReview() === undefined) already.push("review"); else { putReview(undefined); described.push("unset review"); }
    } else if (u.field === "verbosity") {
      if (layer.verbosity === undefined) already.push("verbosity"); else { delete layer.verbosity; described.push("unset verbosity"); }
    } else if (u.role) {
      if (!isObj(layer.model) || layer.model[u.role] === undefined) already.push(`model:${u.role}`);
      else { delete layer.model[u.role]; described.push(`unset model:${u.role}`); }
    } else if (!isObj(layer.model) || Object.keys(layer.model).length === 0) {
      already.push("model");
    } else { delete layer.model; described.push("unset model"); }
  }
  if (isObj(layer.model) && Object.keys(layer.model).length === 0) delete layer.model;

  if (lane) {
    const rest = { ...layer };
    delete rest.review;
    const empty = layer.review === undefined && Object.keys(rest).length === 0;
    const lanes = isObj(state.laneProfiles) ? { ...state.laneProfiles } : {};
    if (empty) delete lanes[lane]; else lanes[lane] = layer;
    if (Object.keys(lanes).length === 0) delete state.laneProfiles; else state.laneProfiles = lanes;
  } else if (Object.keys(layer).length === 0) {
    delete state.executionProfile;
  } else {
    state.executionProfile = layer;
  }
  return { changed: snapshot(state) !== before, already, described };
}

// ─────────────── profile: the read verb's text (D5) ───────────────

/** `12 (medium)` style text for one resolved model pair, or `no directive`. */
export function modelText(pair) {
  if (!pair) return "no directive";
  return pair.effort ? `${pair.model} (${pair.effort})` : pair.model;
}

/** The lines of a resolved profile, one per field and per model role, each with the layer it came
 *  from; an epic or lane that LOWERED (or otherwise changed) a value names the value it overrides,
 *  and a stored value that was ignored is named. Shared by `profile`, `rules --epic` and the brief,
 *  so the three cannot word the same fact differently. Returns raw lines: the printer escapes them. */
export function profileLines(profile) {
  const lines = [];
  const overrides = (r, render) => (r.overrides ? ` — overrides ${r.overrides.source} ${render(r.overrides.value)}` : "");
  const plain = (v) => String(v);
  lines.push(`review: ${profile.review.value} (${profile.review.source})${overrides(profile.review, plain)}`);
  lines.push(`verbosity: ${profile.verbosity.value} (${profile.verbosity.source})${overrides(profile.verbosity, plain)}`);
  for (const role of KNOWN_JOB_ROLES) {
    const r = profile.model[role];
    lines.push(`model ${role}: ${modelText(r.value)} (${r.source})${overrides(r, modelText)}`);
  }
  const named = [["review", profile.review], ["verbosity", profile.verbosity],
    ...KNOWN_JOB_ROLES.map((role) => [`model ${role}`, profile.model[role]])];
  for (const [name, r] of named) {
    for (const ig of r.ignored || []) {
      lines.push(`ignored: ${ig.source} ${name} ${typeof ig.value === "string" ? `'${ig.value}'` : JSON.stringify(ig.value)} is not a valid value`);
    }
  }
  return lines;
}

// ─────────────── the epic layer: flags and batch keys (D4) ───────────────

/** The epic-layer values named by `add-epic` / `update-epic` flags: `--review-mode`, `--verbosity` and
 *  the repeatable `--model <role>=<model>[:<effort>]`. Returns `{ ok: true, review?, verbosity?, model? }`
 *  (`model` a `{role: pair}` map) or `{ ok: false, message }` for the first refusal, naming the accepted
 *  list. PURE. `--review-mode` is also refused when valueless by requireFlagValues() upstream. */
export function parseEpicProfileFlags(f) {
  const out = { ok: true };
  if (typeof f["review-mode"] === "string") {
    const r = checkReview(f["review-mode"]);
    if (!r.ok) return { ok: false, message: `--review-mode: ${r.message}` };
    out.review = r.value;
  }
  if (typeof f.verbosity === "string") {
    const v = checkVerbosity(f.verbosity);
    if (!v.ok) return { ok: false, message: `--verbosity: ${v.message}` };
    out.verbosity = v.value;
  }
  const models = asArray(f.model).filter((m) => typeof m === "string");
  if (models.length) {
    out.model = {};
    for (const m of models) {
      const p = parseModelPair(m);
      if (!p.ok) return { ok: false, message: `--model: ${p.message}` };
      out.model[p.role] = p.value;
    }
  }
  return out;
}

/** An `add-many` batch entry's `model`, in any of three shapes, normalised to the stored `{role: pair}`:
 *  an array of `"<role>=<model>[:<effort>]"` strings (the flag's own spelling), or an object mapping a
 *  role to `"<model>[:<effort>]"` or to `{model, effort?}`. */
export function normalizeBatchModel(value) {
  const out = {};
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: false, message: "model must not be empty" };
    for (const m of value) {
      if (typeof m !== "string") return { ok: false, message: "each model entry must be a \"<role>=<model>[:<effort>]\" string" };
      const p = parseModelPair(m);
      if (!p.ok) return p;
      out[p.role] = p.value;
    }
    return { ok: true, model: out };
  }
  if (!isObj(value) || Object.keys(value).length === 0) {
    return { ok: false, message: "model must be an array of \"<role>=<model>[:<effort>]\" strings or a {role: pair} object" };
  }
  for (const [role, raw] of Object.entries(value)) {
    const r = checkRole(role);
    if (!r.ok) return r;
    let pair;
    if (typeof raw === "string") {
      const colon = raw.indexOf(":");
      pair = colon === -1 ? checkPair(raw) : checkPair(raw.slice(0, colon), raw.slice(colon + 1));
    } else if (isObj(raw)) {
      pair = checkPair(raw.model, raw.effort);
    } else {
      return { ok: false, message: "each model role must map to \"<model>[:<effort>]\" or {model, effort}" };
    }
    if (!pair.ok) return pair;
    out[role] = pair.value;
  }
  return { ok: true, model: out };
}

/** Apply epic-layer model edits to `epic` in place: set the given roles (whole pairs), remove
 *  `clearRoles`, and drop an emptied `model` map. Roles not named are untouched. */
export function applyEpicModel(epic, setPairs, clearRoles = []) {
  const next = { ...(isObj(epic.model) ? epic.model : {}) };
  for (const role of clearRoles) delete next[role];
  Object.assign(next, setPairs || {});
  if (Object.keys(next).length === 0) delete epic.model; else epic.model = next;
}

// ─────────────── the activity log's view of a profile change (3.4) ───────────────

const pairText = (v) => (isObj(v) ? modelText(v) : null);

/** The profile fields whose value differs between two state records, at every layer:
 *  `[{ epic, layer, field, from, to }]`. `layer` is `epic`, `lane:<lane>` or `project`; `field` is
 *  `review`, `verbosity` or `model.<role>`; `from`/`to` are text (`null` = unset). The project and epic
 *  `review` are EXCLUDED because the log already carries them as `review-mode` events with their
 *  historical shape; every other field at every layer, including a lane's `review`, appears here. */
export function profileDeltas(before, after) {
  const out = [];
  const b = before || {};
  const a = after || {};
  const push = (epic, layer, field, from, to) => {
    if ((from ?? null) !== (to ?? null)) out.push({ epic, layer, field, from: from ?? null, to: to ?? null });
  };
  const layerFields = (l) => ({
    review: l && typeof l.review === "string" ? l.review : null,
    verbosity: l && typeof l.verbosity === "string" ? l.verbosity : null,
    model: l && isObj(l.model) ? l.model : {},
  });
  const compare = (epic, layer, x, y, withReview) => {
    if (withReview) push(epic, layer, "review", x.review, y.review);
    push(epic, layer, "verbosity", x.verbosity, y.verbosity);
    for (const role of KNOWN_JOB_ROLES) push(epic, layer, `model.${role}`, pairText(x.model[role]), pairText(y.model[role]));
  };
  // project
  compare(null, "project",
    layerFields({ verbosity: (b.executionProfile || {}).verbosity, model: (b.executionProfile || {}).model }),
    layerFields({ verbosity: (a.executionProfile || {}).verbosity, model: (a.executionProfile || {}).model }), false);
  // lanes
  const lanes = new Set([...Object.keys(isObj(b.laneProfiles) ? b.laneProfiles : {}), ...Object.keys(isObj(a.laneProfiles) ? a.laneProfiles : {})]);
  for (const lane of [...lanes].sort()) {
    compare(null, `lane:${escapeControls(String(lane))}`, layerFields((b.laneProfiles || {})[lane]), layerFields((a.laneProfiles || {})[lane]), true);
  }
  // epics
  const prev = new Map((Array.isArray(b.epics) ? b.epics : []).map((e) => [e.id, e]));
  for (const e of Array.isArray(a.epics) ? a.epics : []) {
    const p = prev.get(e.id);
    if (!p) continue;
    compare(e.id, "epic", layerFields({ verbosity: p.verbosity, model: p.model }), layerFields({ verbosity: e.verbosity, model: e.model }), false);
  }
  return out;
}

// ─────────────── emission: what the rules block and the brief say (D5) ───────────────

/** One phrase per set field of ONE lane layer, valid values only (a stored invalid value is not
 *  emitted): `review off, model test haiku`. */
function laneLayerPhrase(layer) {
  const parts = [];
  if (checkReview(layer.review).ok) parts.push(`review ${layer.review}`);
  if (checkVerbosity(layer.verbosity).ok) parts.push(`verbosity ${layer.verbosity}`);
  if (isObj(layer.model)) {
    for (const role of KNOWN_JOB_ROLES) {
      if (checkModelEntry(layer.model[role]).ok) parts.push(`model ${role} ${modelText(layer.model[role])}`);
    }
  }
  return parts.join(", ");
}

/** The lane overrides a rules block lists, one line each (`claude-code: review off, model test haiku`),
 *  in lane order. Lanes that hold nothing valid are omitted. */
export function laneOverrideLines(state) {
  const lp = state && isObj(state.laneProfiles) ? state.laneProfiles : {};
  const lines = [];
  for (const lane of KNOWN_LANES) {
    if (!isObj(lp[lane])) continue;
    const phrase = laneLayerPhrase(lp[lane]);
    if (phrase) lines.push(`${lane}: ${phrase}`);
  }
  return lines;
}

/** What `rulesBlock` needs about the profile: the resolved view for the project (or for one epic),
 *  the lane override lines, and the scope's name. PURE. */
export function profileContext(state, epicId) {
  const known = epicId && Array.isArray(state.epics) && state.epics.some((e) => e && e.id === epicId);
  return {
    scope: known ? "epic" : "project",
    epicId: known ? epicId : undefined,
    view: resolveProfile(state, known ? { epicId } : {}),
    lanes: laneOverrideLines(state),
  };
}

/** The lines of a resolved profile for the rules block: like profileLines() but WITHOUT the
 *  `ignored:` notes, which belong to the read verb. */
export function profileBlockLines(view) {
  return profileLines(view).filter((l) => !l.startsWith("ignored:"));
}

/** The brief's lines for the active epic: `review: thorough (epic)` and `verbosity: …`, plus a
 *  `model <role>:` line only for a role that resolves to something other than the default. */
export function briefProfileLines(view) {
  const lines = [];
  const src = (r) => `(${r.source})`;
  lines.push(`review: ${view.review.value} ${src(view.review)}`);
  lines.push(`verbosity: ${view.verbosity.value} ${src(view.verbosity)}`);
  for (const role of KNOWN_JOB_ROLES) {
    const r = view.model[role];
    if (r.source !== "default") lines.push(`model: ${role} ${modelText(r.value)} ${src(r)}`);
  }
  return lines;
}
