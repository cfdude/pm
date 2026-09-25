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
import vm from "node:vm";
import { isInitialized, readStdin } from "./state.mjs";
import { requirePlatformFlag } from "./add-epic.mjs";
import { escapeControls, jsonText } from "./constants.mjs";
import { currentCwd, currentEnv, outStream } from "./invocation.mjs";

/** The lessons corpus lives at `docs/lessons/` under the project root. Resolved at CALL time,
 *  not at module load, so a test (and a hook fired in a different project) sees its own root. */
export function lessonsDir(root = currentEnv().CLAUDE_PROJECT_DIR || currentCwd()) {
  return path.join(root, "docs", "lessons");
}

/** The frontmatter block of a lesson file, or null when it has none.
 *
 *  LINE ENDINGS ARE NORMALISED FIRST. The contract is `---\n…\n---`, and a lesson saved by a
 *  Windows editor or checked out under `core.autocrlf` is `---\r\n…`: before this, such a lesson
 *  never matched the block pattern and was silently retrieval-only — and every field read from it
 *  would have carried a trailing `\r` into the advice (code review 0.43.0, C1). */
function frontmatterBlock(txt) {
  const m = txt.replace(/\r\n?/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

/** Read one scalar field out of a lesson's YAML frontmatter block. Deliberately NOT a YAML
 *  parser: the frontmatter contract is flat `key: value` lines, and pm ships no dependencies. */
function frontmatterField(block, key) {
  const m = block.match(new RegExp(`^${key}: (.+)$`, "m"));
  return m ? m[1].trim() : "";
}

/** The keys a `detect:` object may hold. Anything else is REFUSED, never ignored: an unknown key
 *  applies no predicate, so a typo (`commandMatch`) turned a lesson into one that matched EVERY
 *  tool call — `{"tool":"Bash","commandMatch":"gh pr merge"}` fired on `ls` (C2). */
export const DETECT_KEYS = ["tool", "pathEndsWith", "commandMatches", "commandLacks"];

/** The tools the `lesson-advice` hook is subscribed to — the matcher of its entry in
 *  `hooks/hooks.json`, held equal to it by `lessons-index.test.mjs`. A `tool` outside this set is
 *  never sent to the hook, so a lesson naming one could never fire. */
export const ADVISED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"];

const REGEX_KEYS = ["commandMatches", "commandLacks"];

/** Where an UNBOUNDED quantifier (`*`, `+`, `{n,}`) starts at `src[i]`, its length; else 0. */
function unboundedAt(src, i) {
  if (src[i] === "*" || src[i] === "+") return 1;
  const m = src[i] === "{" ? /^\{\d+,\}/.exec(src.slice(i)) : null;
  return m ? m[0].length : 0;
}

/** The first group that holds an unbounded quantifier AND is itself unboundedly quantified —
 *  `(a+)+`, `(?:\s+x)*`, `((a)*b){2,}` — or "" when there is none.
 *
 *  This is the textbook catastrophic-backtracking shape and the one a repository author writes by
 *  accident: `^(a+)+$` against a 31-character command burned 60.4 s of CPU in the hook, on every
 *  Bash/Edit/Write call (C1). It is a HEURISTIC and says so: overlapping alternation under one
 *  quantifier (`(a|a)*`) is just as catastrophic and is not statically decidable here, which is
 *  why the regex phase ALSO runs under a time budget. The check exists to NAME the common case at
 *  classification time, where a reason can be reported; the budget exists so the uncommon case
 *  still cannot stall a tool call.
 *
 *  A scanner, not a parser: escapes and character classes are skipped as literals, a group's `(?`
 *  prefix is not a quantifier, and a bounded `{n,m}` or `?` never counts. */
export function nestedUnboundedQuantifier(src) {
  const stack = [];          // open groups: { start, inner } — inner: holds an unbounded quantifier
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "[") {
      i++;
      if (src[i] === "^") i++;
      if (src[i] === "]") i++;                         // a leading `]` is a literal
      while (i < src.length && src[i] !== "]") i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "(") {
      stack.push({ start: i, inner: false });
      i++;
      if (src[i] === "?") {                            // (?: (?= (?! (?<= (?<! (?<name>
        i++;
        if (src[i] === "<" && src[i + 1] !== "=" && src[i + 1] !== "!") {
          while (i < src.length && src[i] !== ">") i++;
        }
        i++;
      }
      continue;
    }
    if (c === ")") {
      const g = stack.pop();
      i++;
      const q = unboundedAt(src, i);
      if (g && g.inner && q) return src.slice(g.start, i + q);
      if (stack.length && g && (g.inner || q)) stack[stack.length - 1].inner = true;
      continue;
    }
    const q = unboundedAt(src, i);
    if (q) { if (stack.length) stack[stack.length - 1].inner = true; i += q; continue; }
    i++;
  }
  return "";
}

/** The code point of the first C0 control character in `s` (or DEL), or -1. */
function firstControl(s) {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) return cp;
  }
  return -1;
}

const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** The verdict on one `detect:` value, exactly as it appears after `detect:` in the frontmatter.
 *
 *  PURE — no filesystem, no clock — so every rule is a value the unit rung can assert. Returns
 *  `{ ok: true, detect, regex }` with each regex compiled ONCE, or `{ ok: false, reason }` naming
 *  the first rule it breaks. The order is the order an author would fix them in: parse, shape,
 *  keys, values, tool, predicates, then each regex.
 *
 *  #194: before this, every rejection below was a silent `continue` — six of pm's own twelve
 *  matchers were bare regexes that never fired, and nothing anywhere said so. REFUSING here is
 *  what makes a report possible; `classifyLessons()` is where the reason is kept. */
export function checkDetect(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "detect: is empty" };
  let d;
  try { d = JSON.parse(text); } catch (e) {
    return { ok: false, reason: `detect: is not JSON (${e.message}) — write an object like {"tool":"Bash","commandMatches":"…"}, not a bare regex` };
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    return { ok: false, reason: `detect: must be a JSON object, got ${typeName(d)}` };
  }
  const unknown = Object.keys(d).filter(k => !DETECT_KEYS.includes(k));
  if (unknown.length) {
    return { ok: false, reason: `unknown key ${unknown.map(k => JSON.stringify(k)).join(", ")} — allowed: ${DETECT_KEYS.join(", ")}` };
  }
  for (const k of Object.keys(d)) {
    if (typeof d[k] !== "string" || !d[k]) {
      return { ok: false, reason: `"${k}" must be a non-empty string, got ${d[k] === "" ? "an empty string" : typeName(d[k])}` };
    }
  }
  if (d.tool && !ADVISED_TOOLS.includes(d.tool)) {
    return { ok: false, reason: `tool ${JSON.stringify(d.tool)} is never sent to the hook — it advises on ${ADVISED_TOOLS.join(", ")}` };
  }
  if (!d.pathEndsWith && !d.commandMatches) {
    return { ok: false, reason: "no pathEndsWith or commandMatches — it would fire on every call" + (d.tool ? ` to ${d.tool}` : "") };
  }
  const hasCommand = !!(d.commandMatches || d.commandLacks);
  if (hasCommand && d.tool && d.tool !== "Bash") {
    return { ok: false, reason: `a command predicate can never fire for tool ${d.tool} — only Bash carries a command` };
  }
  if (d.pathEndsWith && d.tool === "Bash") {
    return { ok: false, reason: "pathEndsWith can never fire — a Bash call carries no path" };
  }
  if (d.pathEndsWith && d.commandMatches) {
    return { ok: false, reason: "pathEndsWith with commandMatches can never fire — no tool call carries both a path and a command" };
  }
  const regex = {};
  for (const k of REGEX_KEYS) {
    if (!d[k]) continue;
    const cp = firstControl(d[k]);
    if (cp >= 0) {
      const code = "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
      return { ok: false, reason: `"${k}" contains control character ${code} — in JSON a regex backslash is written twice (\\\\b, \\\\s)` };
    }
    try { regex[k] = new RegExp(d[k]); } catch (e) {
      return { ok: false, reason: `"${k}" is not a valid regex: ${e.message}` };
    }
    const nested = nestedUnboundedQuantifier(d[k]);
    if (nested) {
      return { ok: false, reason: `"${k}" nests an unbounded quantifier — ${JSON.stringify(nested)} backtracks catastrophically` };
    }
  }
  return { ok: true, detect: d, regex };
}

/** Every lesson in `dir`, sorted into what the hook can use and what it cannot:
 *
 *    matchable      [{ file, rule, detect, regex }]  — a `detect:` that passed `checkDetect`
 *    rejected       [{ file, reason }]               — a `detect:` WRITTEN DOWN that cannot work
 *    retrievalOnly  [file]                           — no `detect:` at all
 *
 *  ABSENT AND MALFORMED ARE DIFFERENT, and collapsing them was #194. A lesson without `detect:`
 *  is a design choice — its trigger cannot be recognised mechanically — and is not a defect. A
 *  lesson WITH one that cannot work is a typo, and its author was never told.
 *
 *  THE HOOK NEVER REPORTS A REJECT: an advisor that printed on a malformed corpus would print on
 *  every tool call. Rejects are reported OUTSIDE the hook path, where being loud is free — this
 *  repository's per-commit `lessons-index` test fails naming each one — and any other surface
 *  reads this same function, so it can never disagree with what the hook actually fires on.
 *  One malformed lesson still never takes the rest of the corpus down with it. */
export function classifyLessons(dir = lessonsDir()) {
  const out = { matchable: [], rejected: [], retrievalOnly: [] };
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const f of names.sort()) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    let txt;
    try { txt = fs.readFileSync(path.join(dir, f), "utf8"); } catch (e) {
      out.rejected.push({ file: f, reason: `unreadable (${e.code || e.message})` });
      continue;
    }
    const block = frontmatterBlock(txt);
    const line = block === null ? null : block.match(/^detect:(.*)$/m);
    if (!line) { out.retrievalOnly.push(f); continue; }
    const v = checkDetect(line[1]);
    if (!v.ok) { out.rejected.push({ file: f, reason: v.reason }); continue; }
    out.matchable.push({ file: f, rule: frontmatterField(block, "rule"), detect: v.detect, regex: v.regex });
  }
  return out;
}

/** Every lesson in `dir` whose `detect:` the hook can use — the hook's projection of
 *  `classifyLessons()`, so the two can never disagree. */
export function matchableLessons(dir = lessonsDir()) {
  return classifyLessons(dir).matchable;
}

/** The lessons whose matcher matches this pending tool call. `lessons` are `classifyLessons()`
 *  entries — each regex already compiled and checked.
 *
 *  ONLY THE COMMAND'S FIRST LINE IS MATCHED, and that is not an optimisation. Observed live in
 *  this repository: writing a lesson whose own body named a git command fired that lesson's own
 *  matcher, twice. A heredoc body, an `echo`, or a file being written can contain any phrase;
 *  the command being RUN is on line one and everything after it is data. Losing recall on
 *  chained commands is the deliberate trade — see the precision note at the top of this file.
 *
 *  THE PATH is `file_path`, or `notebook_path` for NotebookEdit — the field that tool actually
 *  sends; reading only `file_path` left every NotebookEdit path matcher inert. */
export function matchLessons(event, lessons, { budgetMs = REGEX_BUDGET_MS } = {}) {
  const tool = event.tool_name || "";
  const ti = event.tool_input || {};
  const cmdLine = String(ti.command || "").split("\n")[0].slice(0, MATCH_TEXT_CAP);
  const filePath = String(ti.file_path || ti.notebook_path || "");
  const test = boundedTester(budgetMs);
  return lessons.filter(l => {
    const d = l.detect;
    if (d.tool && d.tool !== tool) return false;
    if (d.pathEndsWith && !filePath.endsWith(d.pathEndsWith)) return false;
    const re = l.regex || {};
    // A regex that ran out of budget (null) is NOT a match, whichever predicate it serves: a
    // lesson whose suppression half could not finish must not fire as though it had.
    if (re.commandMatches && test(re.commandMatches, cmdLine) !== true) return false;
    if (re.commandLacks && test(re.commandLacks, cmdLine) !== false) return false;
    return true;
  });
}

/** The TOTAL time every regex of one hook invocation may take, in milliseconds. The hook runs
 *  before every Bash/Edit/Write/NotebookEdit call and `hooks/hooks.json` gives it no timeout of
 *  its own, so without this a catastrophic regex held each tool call until Claude Code's 60 s hook
 *  timeout killed it (C1). An exhausted budget costs ADVICE, never time. */
export const REGEX_BUDGET_MS = 100;

/** The most of the command's first line any regex sees. Bounds the polynomial blow-up of an
 *  ordinary `.*.*` on a pasted 100 kB one-liner; the catastrophic cases are the budget's job. */
export const MATCH_TEXT_CAP = 4096;

/** `(re, text) => true | false | null` — `re.test(text)` run inside a `node:vm` context whose
 *  timeout interrupts even a backtracking regex (the only built-in way to stop one), sharing ONE
 *  deadline across every call. `null` means the budget ran out before an answer. The context is
 *  created lazily, so a tool call no regex lesson reaches pays nothing for it. */
function boundedTester(budgetMs) {
  const deadline = performance.now() + budgetMs;
  let ctx = null;
  return (re, text) => {
    const left = Math.floor(deadline - performance.now());
    if (left < 1) return null;
    ctx ??= vm.createContext({});
    ctx.re = re;
    ctx.s = text;
    try { return vm.runInContext("re.test(s)", ctx, { timeout: left }) === true; } catch { return null; }
  };
}

/** The `additionalContext` string for a set of hits. */
export function adviceText(hits) {
  // `rule` is a workspace lesson's frontmatter and `file` a workspace filename — governed values
  // (user-text-never-forges-output D0), escaped so neither can begin a line of the advice.
  const body = hits.map(h => `• ${escapeControls(h.rule)}\n  (docs/lessons/${escapeControls(h.file)})`).join("\n");
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
  const payload = readStdin();
  requirePlatformFlag("lesson-advice");      // after the drain, so a refusal leaves no writer holding a pipe
  let event;
  try { event = JSON.parse(payload); } catch { return; }
  if (!event || typeof event !== "object") return;
  const lessons = matchableLessons();
  if (!lessons.length) return;               // no corpus, or none of it matchable
  const hits = matchLessons(event, lessons);
  if (!hits.length) return;
  outStream().write(jsonText({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: adviceText(hits),
    },
  }));
}
