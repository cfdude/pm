// scripts/lib/project-identity.mjs
// The project's name and key, and the one place their rules live (change project-boards, spec project-identity).
//
// `set-project` writes them, `board --json` reads them, and BOTH ask these functions, so the verb and the export cannot disagree
// about what a valid name or key is. Pure: no disk, no git, no output.

import { CONTROL_CHARACTER } from "./constants.mjs";

/** The project key: two or three uppercase ASCII letters. */
export const PROJECT_KEY_FORMAT = /^[A-Z]{2,3}$/;
/** The project name: at most this many characters. */
export const PROJECT_NAME_MAX = 60;

/** Why `name` is not a valid project name, or null when it is. */
export function projectNameError(name) {
  if (typeof name !== "string" || name.trim() === "") return "--name requires a non-empty project name";
  if (CONTROL_CHARACTER.test(name)) return "--name must not contain a control character or a newline";
  if (name.includes("<")) return "--name must not contain `<` (the boards draw it into a page)";
  if ([...name].length > PROJECT_NAME_MAX) return `--name must be at most ${PROJECT_NAME_MAX} characters (got ${[...name].length})`;
  return null;
}

/** Why `key` is not a valid project key, or null when it is. */
export function projectKeyError(key) {
  if (typeof key !== "string" || !PROJECT_KEY_FORMAT.test(key)) return "--key must be two or three uppercase letters (A-Z), such as PM";
  return null;
}

/** The name as stored, or null when absent or invalid. */
export const projectNameOf = (state) => {
  const n = state && state.projectName;
  return projectNameError(n) === null ? n : null;
};
/** The key as stored, or null when absent or invalid. */
export const projectKeyOf = (state) => {
  const k = state && state.projectKey;
  return projectKeyError(k) === null ? k : null;
};
