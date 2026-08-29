// scripts/lib/lessons.mjs
// The PreToolUse LESSON ADVISOR — surface a lesson at the moment it applies, rather than when
// somebody remembers to look for one.
//
// gh-132. A project accumulates hard-won process knowledge and then does not consult it,
// because consulting it requires already suspecting there is something to know. Three modes:
//
//   Read    before a risky operation   the agent, proactively   depends on remembering to look
//   Write   after a mistake bites      the agent, reactively    depends on noticing it was one
//   Advise  before the error           A HOOK                   depends on nothing
//
// Read and Write are worth having and are not enough — both need recall, and recall is what
// this repository measured as roughly 20% effective (a rule carried by a required task reached
// 14/14 adoption; the same rule as a prose bullet reached 3/15). Advise is the only mode that
// fires on the SITUATION.
//
// ARCHITECTURAL POSITION. pm is an instruction layer, never an integration layer. This is a
// LOCAL, MECHANICAL PreToolUse check — no network, no external system — which is the same
// deliberate, documented exception the gate guard occupies. The difference from the gate guard
// is the whole point: that one BLOCKS (exit 2); this one only ADVISES, and always exits 0.
//
// PRECISION IS THE CONSTRAINT, NOT COVERAGE. #91 and #104 are live proof in this repository
// that a hook firing on false positives gets ignored, and epic-progress.mjs already carries the
// note that a warning wrong 7 times in 8 trains people to ignore the one time it is right. So a
// lesson that cannot be matched with near-certainty carries NO `detect:` and stays
// retrieval-only. That is the honest outcome, not a gap to close by loosening a regex.
//
// pm OWNS THE MECHANISM, NEVER THE CORPUS. The directory shape, the frontmatter contract and
// this matcher ship; which lessons a repository holds, and what counts as one, is the repo's
// and the agent's judgment. The engine records, renders and fires; it never decides.
//
// Zero dependency. Node built-ins only, same constraint as the rest of the engine.

import fs from "node:fs";
import path from "node:path";
import { isInitialized, readStdin } from "./state.mjs";

/** The lessons corpus lives at `docs/lessons/` under the project root. Resolved at CALL time,
 *  not at module load, so a test (and a hook fired in a different project) sees its own root. */
export function lessonsDir(root = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  return path.join(root, "docs", "lessons");
}

/** Read one scalar field out of a lesson's YAML frontmatter block. Deliberately NOT a YAML
 *  parser: the frontmatter contract is flat `key: value` lines, and pm ships no dependencies. */
function frontmatterField(block, key) {
  const m = block.match(new RegExp(`^${key}: (.+)$`, "m"));
  return m ? m[1].trim() : "";
}

/** Every lesson in `dir` that declares a parseable `detect:` matcher.
 *
 *  A lesson WITHOUT `detect:` is not an error and not a defect — it is a lesson whose trigger
 *  cannot be recognised mechanically, and it stays retrieval-only by design. An unparseable
 *  `detect:` is skipped for itself alone: one malformed frontmatter block must not take the
 *  rest of the corpus down with it, because the failure would be silent in exactly the
 *  situation the advisor exists to speak up in. */
export function matchableLessons(dir = lessonsDir()) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of names.sort()) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    let txt;
    try { txt = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    // ONE guard covers both skips, deliberately. An ABSENT `detect:` yields "", which is not
    // parseable JSON, so it takes the same path as a malformed one. A separate `if (!raw)`
    // early-out was written first, then deleted: neutering it changed no behaviour any test
    // could see, and this repository does not keep a guard that cannot fail its own mutation.
    let detect;
    try { detect = JSON.parse(frontmatterField(m[1], "detect")); } catch { continue; }
    // `detect: null` and `detect: 7` both parse. Without this the matcher dereferences a
    // non-object and the hook CRASHES — the one outcome an advisory hook must never produce,
    // because a crashing PreToolUse hook is a broken tool call, not a missed suggestion.
    if (!detect || typeof detect !== "object") continue;
    out.push({ file: f, rule: frontmatterField(m[1], "rule"), detect });
  }
  return out;
}

/** The lessons whose matcher matches this pending tool call.
 *
 *  ONLY THE COMMAND'S FIRST LINE IS MATCHED, and that is not an optimisation. Observed live in
 *  this repository: writing a lesson whose own body named a git command fired that lesson's own
 *  matcher, twice. A heredoc body, an `echo`, or a file being written can contain any phrase;
 *  the command being RUN is on line one and everything after it is data. Losing recall on
 *  chained commands is the deliberate trade — see the precision note at the top of this file. */
export function matchLessons(event, lessons) {
  const tool = event.tool_name || "";
  const ti = event.tool_input || {};
  const cmdLine = String(ti.command || "").split("\n")[0];
  const filePath = String(ti.file_path || "");
  return lessons.filter(l => {
    const d = l.detect;
    if (d.tool && d.tool !== tool) return false;
    if (d.pathEndsWith && !filePath.endsWith(d.pathEndsWith)) return false;
    try {
      if (d.commandMatches && !new RegExp(d.commandMatches).test(cmdLine)) return false;
      if (d.commandLacks && new RegExp(d.commandLacks).test(cmdLine)) return false;
    } catch { return false; }   // a bad regex in a repo's frontmatter is that lesson's problem
    return true;
  });
}

/** The `additionalContext` string for a set of hits. */
export function adviceText(hits) {
  const body = hits.map(h => `• ${h.rule}\n  (docs/lessons/${h.file})`).join("\n");
  return `📓 Lesson from this repo's own history — this cost time before:\n${body}\n` +
    "Proceed if it does not apply; the hook only advises.";
}

/** PreToolUse hook body. Silent — exit 0, no output — in every case except an actual match:
 *  a project that has never run /pm:init (the plugin's hooks run in EVERY project at user
 *  scope), a project with no `docs/lessons/`, a payload that will not parse, a corpus whose
 *  lessons are all retrieval-only, and a call nothing matches.
 *
 *  NEVER exits non-zero. The gate guard exits 2 to BLOCK; this one advises, and an advisor that
 *  can block is a gate nobody agreed to. */
export function lessonAdvice() {
  if (!isInitialized()) return;              // DORMANT until /pm:init
  // Drained BEFORE anything else on this path, exactly as the gate guard does it — the payload
  // is on stdin and a hook that returns without reading it leaves the writer holding a pipe.
  let event;
  try { event = JSON.parse(readStdin()); } catch { return; }
  if (!event || typeof event !== "object") return;
  const lessons = matchableLessons();
  if (!lessons.length) return;               // no corpus, or none of it matchable
  const hits = matchLessons(event, lessons);
  if (!hits.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: adviceText(hits),
    },
  }));
}
