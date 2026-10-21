// scripts/test/fixtures/shipped-docs.mjs
// The population of SHIPPED DOCUMENTS an agent or user reads, DERIVED by walking the shipped roots at
// test time and never typed as a list: a file added under `skills/<name>/SKILL.md` is in it the moment
// it exists. Shared by emitted-invocations' assertion twin and by the change-root sweep, so the two
// cannot disagree about what "shipped" means.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every shipped markdown file, as a path relative to `root`: the markdown under the shipped roots plus
 *  the README. Sorted. */
export function shippedDocs(root = REPO) {
  const roots = ["commands", "agents", "skills", "hooks", ".claude-plugin"];
  const out = [];
  const walk = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(path.relative(root, p));
    }
  };
  for (const r of roots) {
    const abs = path.join(root, r);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const f of ["README.md"]) if (fs.existsSync(path.join(root, f))) out.push(f);
  return out.sort();
}
