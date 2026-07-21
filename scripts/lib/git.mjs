// scripts/lib/git.mjs
// git plumbing (current SHA) and the append-only detour log. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import { execSync } from "node:child_process";
import { ROOT, CONDUCTOR_DIR, DETOURS_LOG } from "./constants.mjs";

export function gitShortSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "-"; }
}

export function appendDetourLog(kind, epic, note) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const line = [new Date().toISOString(), gitShortSha(), kind, epic || "-", (note || "").replace(/\s+/g, " ").trim()].join("\t");
  fs.appendFileSync(DETOURS_LOG, line + "\n");
}
