#!/usr/bin/env node
/**
 * PreToolUse advisor — surface a lesson at the moment it applies, not when someone remembers.
 *
 * The problem this solves: a skill fires on INVOCATION, a lesson file fires on someone deciding to
 * read it. Both need the agent to already suspect there is something to know. This repo measured
 * what that is worth: a rule carried by a required task reached 14/14 adoption, the same rule as
 * prose reached 3/15. A hook is the only thing that fires on the SITUATION.
 *
 * PRECISION IS THE WHOLE CONSTRAINT. This repo has two open issues (#91, #104) about hooks that fire
 * on false positives, and its own code carries the note that a warning wrong 7 times in 8 trains
 * people to ignore the one time it is right. So: few patterns, each near-certain, ADVISORY ONLY —
 * this never blocks a tool call. A lesson that cannot be matched precisely stays retrieval-only,
 * which is the honest outcome, not a gap.
 *
 * Data-driven: each lesson may declare `detect:` in its frontmatter — a JSON matcher this reads.
 * Adding a pattern is a frontmatter edit, not a code change.
 *
 * Zero dependency. Node built-ins only, same constraint as the engine.
 */
import fs from "node:fs";
import path from "node:path";

const LESSONS = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), "docs", "lessons");

let input = "";
process.stdin.on("data", d => (input += d));
process.stdin.on("end", () => {
  let ev;
  try { ev = JSON.parse(input); } catch { process.exit(0); }
  const tool = ev.tool_name || "";
  const ti = ev.tool_input || {};

  let lessons = [];
  try {
    lessons = fs.readdirSync(LESSONS)
      .filter(f => f.endsWith(".md") && f !== "README.md")
      .map(f => {
        const txt = fs.readFileSync(path.join(LESSONS, f), "utf8");
        const m = txt.match(/^---\n([\s\S]*?)\n---/);
        if (!m) return null;
        const g = k => (m[1].match(new RegExp(`^${k}: (.+)$`, "m")) || [, ""])[1].trim();
        const det = g("detect");
        if (!det) return null;
        try { return { file: f, rule: g("rule"), detect: JSON.parse(det) }; } catch { return null; }
      })
      .filter(Boolean);
  } catch { process.exit(0); }

  // Match only the command's FIRST LINE. A heredoc body, an echo, or a file being written can
  // contain any phrase — observed live: writing a lesson whose text mentions a git command fired
  // that lesson's own matcher, twice. The command being RUN is on line one; everything after is
  // data. Precision is the constraint here (see #91/#104), so recall on chained commands is the
  // deliberate trade.
  const cmdLine = String(ti.command || "").split("\n")[0];

  const hits = [];
  for (const l of lessons) {
    const d = l.detect;
    if (d.tool && d.tool !== tool) continue;
    if (d.pathEndsWith && !String(ti.file_path || "").endsWith(d.pathEndsWith)) continue;
    if (d.commandMatches && !new RegExp(d.commandMatches).test(cmdLine)) continue;
    if (d.commandLacks && new RegExp(d.commandLacks).test(cmdLine)) continue;
    hits.push(l);
  }
  if (!hits.length) process.exit(0);

  const body = hits.map(h => `• ${h.rule}\n  (docs/lessons/${h.file})`).join("\n");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `📓 Lesson from this repo's own history — this cost time before:\n${body}\n` +
        `Proceed if it does not apply; the hook only advises.`,
    },
  }));
});
