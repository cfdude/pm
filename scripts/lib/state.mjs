// scripts/lib/state.mjs
// state.json load/save — the conductor's single source of record. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import { STATE_PATH, CONDUCTOR_DIR } from "./constants.mjs";

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

export function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

export function isInitialized() {
  return fs.existsSync(STATE_PATH);
}

export function defaultState() {
  return { version: 1, active: null, epics: [], detourStack: [] };
}

export function loadState() {
  const s = readJSON(STATE_PATH, null);
  return s && typeof s === "object" ? { ...defaultState(), ...s } : defaultState();
}

/** Atomic write: write to a tmp file in the same directory, then rename(2) over the
 *  real path. rename is atomic on the same filesystem — a crash mid-write leaves a
 *  truncated .tmp-* file, never a truncated state.json. */
export function saveState(state) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const data = JSON.stringify(state, null, 2) + "\n";
  const tmpPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, STATE_PATH);
}
