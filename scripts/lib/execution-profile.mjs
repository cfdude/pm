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
