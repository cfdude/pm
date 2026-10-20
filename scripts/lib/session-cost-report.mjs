// scripts/lib/session-cost-report.mjs
// rules-block-session-cost — the impure half of session-cost.mjs: build what a session actually
// receives, and read the rules file it actually reads. Everything computed lives in session-cost.mjs.

import fs from "node:fs";
import path from "node:path";
import { buildBriefParts } from "./briefing.mjs";
import { classifyLessons } from "./lessons.mjs";
import { engineRoot } from "./constants.mjs";
import { runtimeVersion } from "./invocation.mjs";
import { rulesTarget } from "./platform.mjs";
import { supportFloorLine } from "./runtime-support.mjs";
import { BRIEF_BYTE_CAP, fitBrief, measureRulesBlock, onDiskRulesBlock, sessionCostLines } from "./session-cost.mjs";

/** The additionalContext a SessionStart hook sends, CAPPED. The one place it is assembled: `brief` sends
 *  it and `upgrade` / `render` measure it, so the number they print is the number a session pays.
 *  Returns fitBrief()'s result. `consume` and `specSync` are buildBriefParts()'s, passed straight through. */
export function sessionStartContext(state, { consume = false, specSync = true } = {}) {
  // gh-228: the rejected lesson matchers ride only on the SessionStart context (this function), never in
  // buildBrief() itself. A corpus that cannot be read is no reject to report, and never breaks the brief.
  let lessonRejects = null;
  try { lessonRejects = classifyLessons().rejected; } catch { /* the briefing outranks the lint */ }
  const { plain, parts } = buildBriefParts(state, { consume, specSync, lessonRejects });
  // 0.49.0 (runtime-support) — ONE line, and only here: below the support floor, prepended at the top
  // for the reason briefing.mjs gives its currency lines. NOT in buildBrief(), which PROJECT.md (a
  // tracked file) and the PreCompact snapshot also embed — one machine's Node must never land in
  // either. The version is the invocation's, never `process.version` read here.
  const floorLine = supportFloorLine(runtimeVersion());
  return fitBrief(parts, { plain, cap: BRIEF_BYTE_CAP, prefix: floorLine || "" });
}

/** The managed block's measurement as it sits in the platform's rules file, or null (no file, no block,
 *  ambiguous markers). The file's own name rides along because it is not always CLAUDE.md. */
export function measureOnDiskBlock(platform) {
  const target = rulesTarget(platform, engineRoot());
  let text = "";
  try { text = fs.readFileSync(target, "utf8"); } catch { /* no rules file yet */ }
  const block = onDiskRulesBlock(text);
  return { file: path.basename(target), measured: block === null ? null : measureRulesBlock(block) };
}

/** The two report lines for `upgrade` and `render`, measured now. READ-ONLY: `consume` stays false, so
 *  measuring never retires a contention warning a real SessionStart is owed. */
export function sessionCostReport(state, platform) {
  const { file, measured } = measureOnDiskBlock(platform);
  const brief = sessionStartContext(state, { consume: false });
  return sessionCostLines({ file, block: measured, brief, cap: BRIEF_BYTE_CAP });
}
