// emitted-commands-run-as-written — every engine invocation pm EMITS or SHIPS is one the installed
// engine accepts (Layer A), every remedy it prints clears what printed it (Layer B), and every
// tracker recipe executes for every role and system (Layer C). design.md Decision 1.
//
// The 0.44.0 sweep that preceded this file was a one-off in a closed change: it ran 487 emitted
// lines through checkCommandLine() once, reported zero defects, and four refused remedies shipped
// anyway. A permanent test re-runs against every future edit of a remedy or a doc.
//
// POPULATIONS ARE DERIVED, NEVER TYPED: the verbs come from conductor.mjs's dispatch table, the
// documents from fs.readdirSync over the shipped directories, the platforms from KNOWN_PLATFORMS.
// A deliberate refused example is marked BESIDE the example in its own source, never listed here.
import "./hermetic-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, observationRepo, tmpRepo } from "./helpers.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lib = (name) => new URL(`../lib/${name}`, import.meta.url).href;

// ═══════════════════════════════ sources ═══════════════════════════════

/** The dispatch table's verbs, read out of conductor.mjs exactly as verb-surface.test.mjs reads it. */
export function dispatchedVerbs() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const start = src.indexOf("// ---------- dispatch ----------");
  assert.notEqual(start, -1, "conductor.mjs must still carry its dispatch marker comment");
  const body = src.slice(src.indexOf("({", src.indexOf("try {", start)));
  const end = body.indexOf("}[cmd]");
  assert.notEqual(end, -1, "the dispatch object must still be indexed as `}[cmd]`");
  const table = body.slice(0, end);
  const verbs = new Set();
  for (const m of table.matchAll(/^ {2}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

/** Every shipped document an agent reads, by class: commands/*.md, skills/**\/SKILL.md, agents/*.md
 *  and README.md. Enumerated from the directories at test time. */
export function shippedDocs(root = REPO) {
  const out = [];
  const mdIn = (dir, cls) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const f of fs.readdirSync(abs).sort()) if (f.endsWith(".md")) out.push({ cls, rel: `${dir}/${f}` });
  };
  mdIn("commands", "commands");
  mdIn("agents", "agents");
  const walkSkills = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const d of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.isDirectory()) walkSkills(`${dir}/${d.name}`);
      else if (d.name === "SKILL.md") out.push({ cls: "skills", rel: `${dir}/${d.name}` });
    }
  };
  walkSkills("skills");
  if (fs.existsSync(path.join(root, "README.md"))) out.push({ cls: "readme", rel: "README.md" });
  return out.map(d => ({ ...d, text: fs.readFileSync(path.join(root, d.rel), "utf8") }));
}

// ═══════════════════════════════ extraction ═══════════════════════════════

/** The markers a shipped document may place IMMEDIATELY after the closing backtick of one inline
 *  code span. Other `pm:` comments (`pm:lifecycle`, `pm:explains-hand-edit`) are not ours. */
const MARKER = /<!-- pm:(refused(?: ([a-z-]+))?|engine-message|checkout-path) -->/g;

/** The inline code spans of one paragraph (CommonMark: a run of N backticks opens, the next run of
 *  exactly N closes), each with its offset range in the paragraph text. */
function codeSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") { i++; continue; }
    let n = 0;
    while (text[i + n] === "`") n++;
    const open = i;
    let j = i + n;
    let close = -1;
    while (j < text.length) {
      if (text[j] !== "`") { j++; continue; }
      let m = 0;
      while (text[j + m] === "`") m++;
      if (m === n) { close = j; break; }
      j += m;
    }
    if (close === -1) { i = open + n; continue; }
    let content = text.slice(open + n, close);
    if (n > 1 && content.startsWith(" ") && content.endsWith(" ") && content.trim()) content = content.slice(1, -1);
    spans.push({ start: open, end: close + n, content });
    i = close + n;
  }
  return spans;
}

/** Shell-ish tokenizer: single and double quotes group, a backslash outside single quotes escapes
 *  the next character. Each token records whether any part of it was quoted, so a quoted `…` is a
 *  value and a bare `…` is an elision. */
export function tokenize(s) {
  const out = [];
  let cur = "", quoted = false, started = false, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; quoted = true; started = true; continue; }
    if (c === "\\" && i + 1 < s.length) { cur += s[++i]; started = true; continue; }
    if (/\s/.test(c)) {
      if (started) out.push({ text: cur, quoted });
      cur = ""; quoted = false; started = false;
      continue;
    }
    cur += c; started = true;
  }
  if (started) out.push({ text: cur, quoted });
  return out;
}

/** Split `s` on a separator that sits outside quotes, parentheses and square brackets. */
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0, q = null, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && s.startsWith(sep, i)) { parts.push(s.slice(last, i)); last = i + sep.length; i += sep.length - 1; }
  }
  parts.push(s.slice(last));
  return parts;
}

/** Drop an unquoted shell comment: a `#` at the start of a word, outside quotes, and the rest. */
function dropShellComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}

/** Find the invocation inside one candidate text: the verb is its first token, or the first token
 *  after `conductor.mjs"` / `$ENGINE"`. Returns the text starting at the verb, or null. */
function locateInvocation(candidate, verbs) {
  const s = candidate.trim();
  const first = s.split(/\s+/)[0];
  if (verbs.has(first)) return s;
  const m = /(?:conductor\.mjs"|\$ENGINE")\s+(\S[\s\S]*)$/.exec(s);
  if (m && verbs.has(m[1].split(/\s+/)[0])) return m[1];
  return null;
}

/** Expand one located invocation into the concrete forms to check (Decision 1's rules):
 *  placeholders become sentinels BEFORE tokenizing (so a spaced placeholder is one), `[…]` optional
 *  segments and a trailing `...` are dropped, a placeholder whose content is flag alternatives
 *  (`<--no-deferrals | --deferral "…">`) and a parenthesised group `(--a | --b)` each expand to one
 *  form per alternative, and whole forms separated by a top-level ` | ` split, each prefixed with the
 *  verb. A shell pipe (` | ` followed by something that is not a flag) ends the invocation. */
export function expandForms(invocation) {
  const placeholders = [];
  let s = invocation.replace(/\\\|/g, "|");
  // Innermost placeholders first, repeatedly, so `<--a | --b "<epicId>">` nests correctly.
  const PH = (n) => `@@PH${n}@@`;
  for (let guard = 0; guard < 20; guard++) {
    const next = s.replace(/<([^<>]*)>/g, (_, name) => { placeholders.push(name); return PH(placeholders.length - 1); });
    if (next === s) break;
    s = next;
  }
  // Optional segments, innermost first.
  for (let guard = 0; guard < 20; guard++) {
    const next = s.replace(/\[[^[\]]*\]/g, "");
    if (next === s) break;
    s = next;
  }
  // Shell sequencing ends the invocation; ` | ` is decided below.
  s = splitTopLevel(s, " && ")[0];
  s = splitTopLevel(s, " ; ")[0];
  s = s.replace(/\s+[12]?>\s*\S+.*$/, "");
  const verb = s.trim().split(/\s+/)[0];
  const forms = splitTopLevel(s, " | ");
  let bodies = [forms[0]];
  if (forms.length > 1) {
    if (forms.slice(1).every(f => f.trim().startsWith("-"))) bodies = [forms[0], ...forms.slice(1).map(f => `${verb} ${f.trim()}`)];
  }
  // Parenthesised alternative groups — one form per alternative, cartesian over groups.
  const expandParens = (body) => {
    const m = /\(([^()]*\|[^()]*)\)/.exec(body);
    if (!m) return [body];
    return m[1].split("|").flatMap(alt => expandParens(body.slice(0, m.index) + alt.trim() + body.slice(m.index + m[0].length)));
  };
  const out = [];
  for (const body of bodies.flatMap(expandParens)) {
    // A placeholder holding flag alternatives expands like a group.
    const expandFlagPlaceholders = (b) => {
      const m = /@@PH(\d+)@@/g;
      let hit;
      while ((hit = m.exec(b))) {
        const name = placeholders[Number(hit[1])];
        if (/^\s*-/.test(name) && name.includes("|")) {
          return name.split("|").flatMap(alt =>
            expandFlagPlaceholders(b.slice(0, hit.index) + alt.trim() + b.slice(hit.index + hit[0].length)));
        }
      }
      return [b];
    };
    for (const form of expandFlagPlaceholders(body)) {
      const tokens = tokenize(form).filter(t => t.quoted || (t.text !== "…" && t.text !== "..." && !/^\.\.\.$/.test(t.text)));
      out.push({ tokens: tokens.map(t => t.text), placeholders });
    }
  }
  return out;
}

/** Fill every placeholder by NAME — argv shape does not depend on meaning (Layer A). */
export function fillByName(tokens, placeholders, values = {}) {
  const byName = (name) => {
    const n = name.trim();
    if (/^(id|epicId|epic-id|parent|paused-id)$/.test(n)) return values.id || "e1";
    if (/^(sha|a|b)$/.test(n)) return values.sha || "0000000000000000000000000000000000000000";
    if (n === "iso") return values.iso || "2026-01-01T00:00:00Z";
    if (n === "path") return values.path || "README.md";
    return "x";
  };
  return tokens.map(t => t
    .replace(/@@PH(\d+)@@/g, (_, i) => byName(placeholders[Number(i)]))
    .replace(/^([a-z0-9-]+)\|[a-z0-9|-]+$/i, "$1"));
}

/** The invocations in one markdown text. Each: `{line, text, tokens, placeholders, marker}` where
 *  `marker` is `{kind, cls}` for a span carrying one. Also returns `unattached` markers — a marker
 *  that does not directly follow a code span. */
export function extractInvocations(markdown, verbs) {
  const lines = markdown.split("\n");
  const found = [];
  const unattached = [];
  let fence = null;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    let text = "";
    const starts = [];
    for (const { n, line } of para) { starts.push({ at: text.length, n }); text += (text ? " " : "") + line; if (starts.length > 1) starts[starts.length - 1].at += 1; }
    const lineAt = (off) => { let n = para[0].n; for (const s of starts) if (s.at <= off) n = s.n; return n; };
    const spans = codeSpans(text);
    const attached = new Set();
    for (const sp of spans) {
      MARKER.lastIndex = 0;
      const after = text.slice(sp.end);
      const mm = /^<!-- pm:(refused(?: ([a-z-]+))?|engine-message|checkout-path) -->/.exec(after);
      let marker = null;
      if (mm) {
        attached.add(sp.end);
        marker = mm[1].startsWith("refused") ? { kind: "refused", cls: mm[2] || null } : { kind: mm[1] };
      }
      const located = locateInvocation(sp.content, verbs);
      if (located === null) {
        if (marker && marker.kind === "refused") found.push({ line: lineAt(sp.start), text: sp.content, forms: [], marker, notInvocation: true });
        continue;
      }
      found.push({ line: lineAt(sp.start), text: located, forms: expandForms(located), marker, span: sp.content });
    }
    for (const m of text.matchAll(MARKER)) if (!attached.has(m.index)) unattached.push({ line: lineAt(m.index), marker: m[0] });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && !line.trim().slice(fm[1].length).trim()) { fence = null; continue; }
      if (fence.label === "text") continue;
      let joined = line;
      const startLine = i + 1;
      while (/\\\s*$/.test(joined) && i + 1 < lines.length) joined = joined.replace(/\\\s*$/, " ") + lines[++i].trim();
      const code = dropShellComment(joined);
      const located = locateInvocation(code, verbs);
      if (located !== null) found.push({ line: startLine, text: located, forms: expandForms(located), marker: null, fenced: true });
      continue;
    }
    if (fm) { flushPara(); fence = { ch: fm[1][0], len: fm[1].length, label: fm[2] }; continue; }
    if (!line.trim()) { flushPara(); continue; }
    para.push({ n: i + 1, line });
  }
  flushPara();
  return { invocations: found, unattached };
}

/** The refusal class the engine returns for one filled form, or `accepted` / `help`. */
export async function verdictOf(verb, tokens) {
  const { checkCommandLine } = await import(lib("argv-surface.mjs"));
  const r = checkCommandLine(verb, ["node", "conductor.mjs", verb, ...tokens], { initialized: true });
  if (r.kind === "refuse") return { kind: "refuse", cls: r.class || null, message: r.message };
  return { kind: r.kind };
}

/** Run Layer A over one markdown text: every form of every invocation is checked; a marked one must
 *  be refused with its declared class. Returns the problems, each a one-line string. */
export async function layerA(label, markdown, verbs) {
  const problems = [];
  const { invocations, unattached } = extractInvocations(markdown, verbs);
  for (const u of unattached) problems.push(`${label}:${u.line}: marker ${u.marker} is unattached — it must directly follow one code span`);
  for (const inv of invocations) {
    if (inv.marker && inv.marker.kind !== "refused") continue;
    if (inv.notInvocation) {
      problems.push(`${label}:${inv.line}: ${inv.marker.kind} marker on \`${inv.text}\`, which is not an engine invocation`);
      continue;
    }
    for (const form of inv.forms) {
      const verb = form.tokens[0];
      const argv = fillByName(form.tokens.slice(1), form.placeholders);
      const v = await verdictOf(verb, argv);
      if (inv.marker) {
        if (v.kind !== "refuse") problems.push(`${label}:${inv.line}: marked pm:refused ${inv.marker.cls} but the engine accepts \`${inv.text}\``);
        else if (v.cls !== inv.marker.cls) problems.push(`${label}:${inv.line}: marked pm:refused ${inv.marker.cls} but the engine refuses \`${inv.text}\` as ${v.cls}`);
      } else if (v.kind === "refuse") {
        problems.push(`${label}:${inv.line}: refused (${v.cls}) \`${inv.text}\` — ${v.message.split("\n")[0]}`);
      }
    }
  }
  return { problems, count: invocations.length };
}

// ═══════════════════════════════ 1.1 — extractor self-tests ═══════════════════════════════

const VERBS = dispatchedVerbs();
const textsOf = (md) => extractInvocations(md, VERBS).invocations.flatMap(i => i.forms.map(f => fillByName(f.tokens, f.placeholders).join(" ")));

test("1.1 a code span wrapped across a line break is one span", () => {
  const md = "Run `update-epic e1\n--priority P1` now.\n";
  assert.deepEqual(textsOf(md), ["update-epic e1 --priority P1"]);
});

test("1.1 a parenthesised alternative group yields one invocation per alternative", () => {
  const md = "`push-detour <parent> --detour <id> --reason \"<why>\" (--reconcile | --no-reconcile)`\n";
  assert.deepEqual(textsOf(md), [
    "push-detour e1 --detour e1 --reason x --reconcile",
    "push-detour e1 --detour e1 --reason x --no-reconcile",
  ]);
});

test("1.1 a top-level A | B | C form yields three invocations, each prefixed with the verb", () => {
  const md = "`set-lane-routing --add \"<match>:<lane>\" [--add …] | --remove \"<match>\" | --clear`\n";
  assert.deepEqual(textsOf(md), [
    "set-lane-routing --add x:x",
    "set-lane-routing --remove x",
    "set-lane-routing --clear",
  ]);
});

test("1.1 a spaced placeholder is one placeholder", () => {
  const md = "```\nadd-epic --id <new> --link \"relates-to:<existing>:<how they inform each other>\"\n```\n";
  const [inv] = extractInvocations(md, VERBS).invocations;
  assert.ok(inv.forms[0].placeholders.includes("how they inform each other"));
  assert.deepEqual(textsOf(md), ["add-epic --id x --link relates-to:x:x"]);
});

test("1.1 a fenced shell comment and a bare … are dropped; a quoted … is a value", () => {
  const md = "```bash\nset-active <id>     # make <id> the active epic\nset-tracker --role secondary --remove …\nupdate-epic e1 --notes \"…\"\n```\n";
  assert.deepEqual(textsOf(md), ["set-active e1", "set-tracker --role secondary --remove", "update-epic e1 --notes …"]);
});

test("1.1 a text fence and prose beginning with a verb name are not extracted", () => {
  const md = "```text\nsuggest-lane reads ONE text argument — quote it.\n```\n\nsync pulls every change in.\n";
  assert.deepEqual(textsOf(md), []);
});

test("1.1 an invocation after conductor.mjs\" or $ENGINE\" is extracted; a continued fence line is joined", () => {
  const md = "```bash\nnode \"${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs\" record-gate-review <id> \\\n  --gate 2 --verdict pass|fail\n```\n\nThen `node \"$ENGINE\" render`.\n";
  assert.deepEqual(textsOf(md), ["record-gate-review e1 --gate 2 --verdict pass", "render"]);
});

test("1.1 optional segments, trailing repetition and flag-alternative placeholders", () => {
  const md = "`release 0.27.0 --member <epicId> [--member <epicId>]...`\n\n" +
    "`update-epic <id> --status archived --reason \"<why>\" <--no-deferrals | --deferral \"<epicId>:<section>\">`\n";
  assert.deepEqual(textsOf(md), [
    "release 0.27.0 --member e1",
    "update-epic e1 --status archived --reason x --no-deferrals",
    "update-epic e1 --status archived --reason x --deferral e1:x",
  ]);
});

test("1.1 a marker binds to the one span it directly follows; a detached one is unattached", () => {
  const md = "`remove-epic --id e2`<!-- pm:refused id-as-flag --> and `render`.\n\nstray <!-- pm:refused unknown-flag -->\n";
  const { invocations, unattached } = extractInvocations(md, VERBS);
  assert.deepEqual(invocations.map(i => i.marker), [{ kind: "refused", cls: "id-as-flag" }, null]);
  assert.equal(unattached.length, 1);
  assert.equal(unattached[0].line, 3);
});

test("1.1 a double-backtick span holding backticks is one span", () => {
  const md = "the line you meant (``write `remove-epic <id> ...`, i.e. `remove-epic e2` ``).\n";
  assert.deepEqual(textsOf(md), []);
});

test("1.1 every real source class yields at least one invocation", async () => {
  const docs = shippedDocs();
  for (const cls of ["commands", "agents", "skills", "readme"]) {
    const n = docs.filter(d => d.cls === cls).reduce((a, d) => a + extractInvocations(d.text, VERBS).invocations.length, 0);
    assert.ok(n > 0, `shipped ${cls} documents yielded no invocation — the extractor or the enumerator is broken`);
  }
  const { rulesBlock } = await import(lib("rules.mjs"));
  const { KNOWN_PLATFORMS } = await import(lib("constants.mjs"));
  for (const platform of KNOWN_PLATFORMS) {
    const n = extractInvocations(rulesBlock(null, "standard", [], platform), VERBS).invocations.length;
    assert.ok(n > 0, `the ${platform} rules block yielded no invocation`);
  }
});

// ═══════════════════════════════ shipped-document checks ═══════════════════════════════

/** `/pm:<name>` must name a shipped command (`commands/<name>.md`) or skill (`skills/<name>/`). The
 *  name only: `/pm:epic list` passes here and is caught against the rules block instead (3.5). */
export function pmReferenceProblems(label, text, root = REPO) {
  const problems = [];
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\/pm:([a-z][a-z0-9-]*)/g)) {
      const name = m[1];
      if (fs.existsSync(path.join(root, "commands", `${name}.md`)) || fs.existsSync(path.join(root, "skills", name))) continue;
      problems.push(`${label}:${i + 1}: /pm:${name} names no shipped command or skill`);
    }
  });
  return problems;
}

/** A shipped command, agent or skill document invokes the INSTALLED engine: `node
 *  scripts/conductor.mjs` exists only in a checkout of pm, so it is a finding unless the code span
 *  holding it carries `<!-- pm:checkout-path -->` (a pm-developer note). README.md is pm's own
 *  contributor-facing document and is outside this rule. */
export function checkoutPathProblems(doc) {
  if (!["commands", "agents", "skills"].includes(doc.cls)) return [];
  const problems = [];
  doc.text.split("\n").forEach((l, i) => {
    if (!l.includes("node scripts/conductor.mjs")) return;
    const exempt = /`[^`]*node scripts\/conductor\.mjs[^`]*`<!-- pm:checkout-path -->/.test(l);
    if (!exempt) problems.push(`${doc.rel}:${i + 1}: \`node scripts/conductor.mjs\` runs only in a pm checkout — invoke the installed engine`);
  });
  return problems;
}

/** Every Layer A problem across the shipped documents under `root`, plus the refusal list. */
export async function shippedDocProblems(root = REPO) {
  const verbs = dispatchedVerbs();
  const problems = [];
  let count = 0;
  for (const doc of shippedDocs(root)) {
    const a = await layerA(doc.rel, doc.text, verbs);
    count += a.count;
    problems.push(...a.problems, ...pmReferenceProblems(doc.rel, doc.text, root), ...checkoutPathProblems(doc));
  }
  return { problems, count };
}

// ═══════════════════════════════ 1.3 — Layer A over shipped docs ═══════════════════════════════

test("1.3 Layer A: every engine invocation in shipped docs passes the pre-dispatch check, and every marker holds", async () => {
  const { problems, count } = await shippedDocProblems();
  assert.ok(count > 500, `only ${count} invocations extracted from shipped docs — the extractor regressed`);
  assert.deepEqual(problems, [], `shipped documents:\n${problems.join("\n")}`);
});

// ═══════════════════════════════ 1.4 — marker rules on constructed docs ═══════════════════════════════

/** A constructed pm-shaped document tree in a temp dir: `commands/probe.md` holding `body`. */
function constructedRoot(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-emitted-docs-"));
  fs.mkdirSync(path.join(root, "commands"), { recursive: true });
  fs.writeFileSync(path.join(root, "commands", "probe.md"), body);
  return root;
}

test("1.4 a correctly marked refused example passes", async () => {
  const { problems } = await shippedDocProblems(constructedRoot("Refused: `activity --bogus`<!-- pm:refused unknown-flag -->.\n"));
  assert.deepEqual(problems, []);
});

test("1.4 a pm:refused marker on an accepted invocation fails", async () => {
  const { problems } = await shippedDocProblems(constructedRoot("`activity --json`<!-- pm:refused unknown-flag -->\n"));
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /commands\/probe\.md:1: marked pm:refused unknown-flag but the engine accepts/);
});

test("1.4 a marker whose class differs from the engine's refusal fails", async () => {
  const { problems } = await shippedDocProblems(constructedRoot("`set-activity-log on extra`<!-- pm:refused unknown-flag -->\n"));
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /marked pm:refused unknown-flag but the engine refuses .* as extra-positional/);
});

test("1.4 a marker not directly after a code span fails as unattached", async () => {
  const { problems } = await shippedDocProblems(constructedRoot("`activity --bogus` <!-- pm:refused unknown-flag -->\n"));
  assert.ok(problems.some(p => /probe\.md:1: marker .* is unattached/.test(p)), problems.join("\n"));
  assert.ok(problems.some(p => /probe\.md:1: refused \(unknown-flag\) `activity --bogus`/.test(p)),
    `the example the detached marker failed to reach is itself reported:\n${problems.join("\n")}`);
});

test("1.4 a marked span followed on the same line by an unmarked refused span fails on the second", async () => {
  const { problems } = await shippedDocProblems(constructedRoot(
    "`activity --bogus`<!-- pm:refused unknown-flag --> and `integrity --force` too.\n"));
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /refused \(unknown-flag\) `integrity --force`/);
});

// ═══════════════════════════════ 1.5 — Layer A over engine output ═══════════════════════════════

/** The tracker matrix design Decision 1 names: no primary; github-issues and jira primaries in every
 *  direction, scoped and scope-less; crossed with no secondary, a github-issues secondary and a jira
 *  secondary. */
export function trackerMatrix() {
  const primaries = [null];
  for (const system of ["github-issues", "jira"]) {
    for (const direction of ["inward", "outward", "both"]) {
      primaries.push({ system, direction, ...(system === "jira" ? { projectKey: "ABC" } : { repo: "o/n" }) });
      primaries.push({ system, direction });
    }
  }
  const secondarySets = [[], [{ system: "github-issues", repo: "o/s", role: "secondary" }],
    [{ system: "jira", projectKey: "SEC", role: "secondary" }]];
  const out = [];
  for (const tracker of primaries) for (const secondaries of secondarySets) out.push({ tracker, secondaries });
  return out;
}

export async function renderedRulesBlocks() {
  const { rulesBlock } = await import(lib("rules.mjs"));
  const { KNOWN_PLATFORMS } = await import(lib("constants.mjs"));
  const out = [];
  for (const platform of KNOWN_PLATFORMS) {
    for (const { tracker, secondaries } of trackerMatrix()) {
      const label = `rules[${platform} · ${tracker ? `${tracker.system}/${tracker.direction}/${tracker.repo || tracker.projectKey || "scope-less"}` : "none"} · ${secondaries.map(s => s.system).join("+") || "no secondary"}]`;
      out.push({ label, text: rulesBlock(tracker, "standard", secondaries, platform) });
    }
  }
  return out;
}

function engineRun(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, PM_QUIET_ENGINE_BANNER: "1" },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Every commit-nudge message variant change 1 prints, each from its own fixture built anchor →
 *  commit → observe, with a sanity assertion that the fixture produced the variant it names. */
export function commitNudgeVariants() {
  const variants = [];
  const ok = (repo, args) => { const r = engineRun(repo.cwd, args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); };
  {
    const repo = observationRepo();
    repo.observe();
    repo.commit({ "src/auto.txt": "1" }, "chore: tidy an unrelated file");
    const o = repo.observe("PostToolUse", "git commit");
    assert.match(o.context, /AUTO-DETOUR/, `fixture: auto-logged. ${o.stdout}`);
    assert.match(o.context, /retract-detour /, "fixture: the retract pointer is printed");
    variants.push({ label: "nudge[auto-logged]", text: o.context, repo });
  }
  {
    const repo = observationRepo();
    repo.observe();
    repo.commit({ "openspec/changes/epic-a/tasks.md": "- [x] 1.1\n" }, "feat(a): the active epic's own work");
    const o = repo.observe("PostToolUse", "git commit");
    assert.match(o.context, /If this was a MINIMAL detour/, `fixture: plain. ${o.stdout}`);
    variants.push({ label: "nudge[plain]", text: o.context, repo });
  }
  {
    const repo = observationRepo();
    ok(repo, ["add-epic", "--id", "detour-d", "--lane", "claude-code"]);
    ok(repo, ["push-detour", "epic-a", "--detour", "detour-d", "--reason", "blocked", "--reconcile"]);
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: record the detour");
    repo.observe();
    repo.commit({ "src/detour.txt": "1" }, "fix: the detour's work");
    const o = repo.observe("PostToolUse", "git commit");
    assert.match(o.context, /during DETOUR `detour-d` \(logged to detours\.log\)/, `fixture: detour commit. ${o.stdout}`);
    assert.ok((o.context.match(/^- `update-epic /gm) || []).length >= 2, `fixture: several candidate epics. ${o.context}`);
    variants.push({ label: "nudge[detour commit · several candidates]", text: o.context, repo });
  }
  {
    const repo = observationRepo();
    repo.observe();
    const c1 = repo.commit({ "src/amend.txt": "1" }, "feat: attributed then amended");
    repo.observe("PostToolUse", "git commit");
    ok(repo, ["update-epic", "epic-a", "--attribute-commit", c1]);
    const attributed = JSON.parse(fs.readFileSync(path.join(repo.cwd, ".conductor", "state.json"), "utf8"))
      .epics.find(e => e.id === "epic-a").attributedCommits;
    assert.ok(attributed.includes(c1), "fixture: C1 is attributed before the amend is observed");
    repo.git("commit", "-q", "--amend", "-m", "feat: amended");
    const o = repo.observe("PostToolUse", "git commit --amend");
    assert.match(o.context, /--withdraw-commit /, `fixture: amend prints the withdrawal. ${o.stdout}`);
    variants.push({ label: "nudge[amend]", text: o.context, repo });
  }
  return variants;
}

/** `init`'s stderr in a fresh repository. */
export function initOutput() {
  const cwd = tmpRepo();
  const r = engineRun(cwd, ["init"]);
  assert.equal(r.status, 0, r.stderr);
  return { label: "init stderr", text: r.stderr, cwd };
}

test("1.5 Layer A: every rules block (platform × tracker matrix), init's output and every commit-nudge variant", async () => {
  const verbs = dispatchedVerbs();
  const sources = [...await renderedRulesBlocks(), initOutput(), ...commitNudgeVariants()];
  const problems = [];
  let count = 0;
  for (const s of sources) {
    const a = await layerA(s.label, s.text, verbs);
    count += a.count;
    problems.push(...a.problems, ...pmReferenceProblems(s.label, s.text));
  }
  assert.ok(count > 1000, `only ${count} invocations extracted from engine output — the extractor or a source regressed`);
  assert.deepEqual(problems, [], problems.join("\n"));
});
