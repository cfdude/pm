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

// ═══════════════════════════════ Layer B — every printed remedy clears what printed it ═══════════════════════════════
//
// design.md Decision 1, Layer B. The POPULATION is read from the registries the engine exports —
// `CHECKS` (integrity), `DELIVERED_OBLIGATIONS` (archive-gate) and `BRIEF_REMEDIES` (briefing) —
// plus the non-registry printers (`unconsidered-outcomes`, update-epic's regression refusal, the
// commit nudge). Every registry entry needs a BUILDER here, keyed by its id; one without fails.
//
// THE PROTOCOL, per builder and per alternative, each alternative in its OWN fresh fixture:
//   1. build a hermetic fixture repo that reproduces the condition; run the PRODUCER; assert it
//      reports the condition;
//   2. extract the remedy invocations from that output (the alternative selects which);
//   3. fill every placeholder BY MEANING from the fixture — never by name;
//   4. run them in the order printed; each must exit 0;
//   5. re-run the producer and assert the condition is gone, AND that the epic still exists.
// A builder may declare `prints: "none"` (its output carries no engine invocation) or
// `unconstructable: "<why>"`; the number of the latter is asserted equal to UNCONSTRUCTABLE.

import { fixtureCommits, fixtureGit, writeState } from "./helpers.mjs";
import { agentDisposition, engineStamp } from "../lib/disposition.mjs";

/** How many registry entries may declare `unconstructable`. Raising it is a visible change. */
const UNCONSTRUCTABLE = 0;
const AT = "2026-09-01T00:00:00.000Z";
const REASON = "fixture reason";

/** A hermetic pm fixture: git repo (own identity, no signing), `init`, a baseline commit. */
export function remedyRepo() {
  const cwd = tmpRepo();
  fixtureGit(cwd, "init", "-q", "-b", "main");
  fixtureGit(cwd, "config", "user.email", "test@example.com");
  fixtureGit(cwd, "config", "user.name", "Test");
  fixtureGit(cwd, "config", "commit.gpgsign", "false");
  const r0 = engineRun(cwd, ["init"]);
  assert.equal(r0.status, 0, `init: ${r0.stderr}`);
  fixtureGit(cwd, "add", "-A");
  fixtureGit(cwd, "commit", "-q", "-m", "chore: baseline");
  const repo = {
    cwd,
    run: (args) => engineRun(cwd, args),
    ok(args) { const r = engineRun(cwd, args); assert.equal(r.status, 0, `fixture step failed: ${args.join(" ")}\n${r.stderr}`); return r; },
    /** Linear commits on HEAD (plumbing: nothing in the index or working tree is swept in). */
    commits: (...names) => fixtureCommits(cwd, names),
    /** The amend shape: a new commit with `replaced`'s parent, which HEAD then points at. `replaced`
     *  stays in the object store, reachable from no branch. */
    amend(replaced, name) {
      const sha = execGit(cwd, ["commit-tree", fixtureGit(cwd, "rev-parse", `${replaced}^{tree}`),
        "-p", fixtureGit(cwd, "rev-parse", `${replaced}^`), "-m", name]);
      fixtureGit(cwd, "update-ref", "HEAD", sha);
      return sha;
    },
    parent: (sha) => fixtureGit(cwd, "rev-parse", `${sha}^`),
    state: () => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")),
    epic(id) { return this.state().epics.find(e => e.id === id); },
    write(state) { writeState(cwd, { version: 1, active: null, detourStack: [], epics: [], ...state }); },
    file(rel, content) { const p = path.join(cwd, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return rel; },
  };
  return repo;
}

function execGit(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The findings block `integrity` prints for ONE check id: its heading line through its bullets. */
export function integrityBlock(repo, id) {
  const r = repo.run(["integrity"]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split("\n");
  const start = lines.findIndex(l => l.startsWith(`${id} — `));
  assert.notEqual(start, -1, `integrity printed no block for ${id}:\n${r.stdout}`);
  const out = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) out.push(lines[i]);
  return out.join("\n");
}

/** Engine invocations in engine OUTPUT: code spans, plus plain lines whose first token is a verb
 *  (update-epic's regression refusal prints its invocation as such a line). */
export function engineInvocations(text) {
  const verbs = dispatchedVerbs();
  // A span holding a verb name alone (`sync`) is a MENTION; a remedy always carries its arguments.
  const spans = extractInvocations(text, verbs).invocations.filter(i => !i.marker && /\s/.test(i.text.trim()));
  const bare = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.includes("`") || !verbs.has(t.split(/\s+/)[0])) continue;
    bare.push({ line: 0, text: t, forms: expandForms(t), marker: null });
  }
  return [...spans, ...bare];
}

/** Fill one expanded form BY MEANING. `meaning` maps a flag name (or `positional`) to a value or a
 *  function of the placeholder's text; a placeholder with no meaning FAILS the test, so nothing is
 *  ever filled by name alone. A bare `a|b` value takes the meaning if one is given, else `a`. */
export function fillByMeaning(form, meaning) {
  const toks = form.tokens;
  const out = [toks[0]];
  for (let i = 1; i < toks.length; i++) {
    let t = toks[i];
    const inline = /^(--[a-z][a-z0-9-]*)=(.*)$/s.exec(t);
    const flag = inline ? inline[1].slice(2) : (i > 1 && /^--[a-z]/.test(toks[i - 1]) && !/^--/.test(t) ? toks[i - 1].slice(2) : (/^--/.test(t) ? null : "positional"));
    const value = inline ? inline[2] : t;
    const fill = (v) => v.replace(/@@PH(\d+)@@/g, (_, n) => {
      const name = form.placeholders[Number(n)];
      const m = meaning[flag];
      assert.ok(m !== undefined, `no meaning for placeholder <${name}> (${flag === "positional" ? "a positional" : `--${flag}`}) in \`${toks.join(" ")}\``);
      return typeof m === "function" ? m(name) : m;
    });
    let filled = flag === null ? value : fill(value);
    if (flag !== null && flag !== "positional" && /^[a-z0-9-]+(\|[a-z0-9-]+)+$/i.test(filled)) {
      filled = meaning[flag] !== undefined ? (typeof meaning[flag] === "function" ? meaning[flag](filled) : meaning[flag]) : filled.split("|")[0];
    }
    out.push(inline ? `${inline[1]}=${filled}` : filled);
  }
  return out;
}

/** Steps 2-5 for one alternative. `fx` is what the builder's setup returned. */
function followRemedy(fx, spec, alt) {
  const out1 = spec.produce(fx);
  assert.ok(spec.reported(out1, fx), `step 1: the producer does not report the condition:\n${out1}`);
  const all = engineInvocations(out1);
  const chosen = alt.select ? alt.select(all, fx) : all;
  assert.ok(chosen.length > 0, `step 2: no remedy invocation to follow in:\n${out1}`);
  const ran = [];
  for (const inv of chosen) {
    const form = alt.form ? inv.forms.find(f => alt.form(f)) || inv.forms[0] : inv.forms[0];
    const argv = fillByMeaning(form, { ...(spec.meaning ? spec.meaning(fx) : {}), ...(alt.meaning ? alt.meaning(fx) : {}) });
    const r = fx.repo.run(argv);
    ran.push(argv.join(" "));
    assert.equal(r.status, 0, `step 4: \`${argv.join(" ")}\` exited ${r.status}:\n${r.stderr}\nprinted:\n${out1}`);
  }
  if (alt.cleared) alt.cleared(fx);
  else {
    const out2 = spec.produce(fx);
    assert.ok(!spec.reported(out2, fx), `step 5: still reported after running ${ran.join(" ; ")}:\n${out2}`);
  }
  if (fx.epicId) assert.ok(fx.repo.epic(fx.epicId), `step 5: epic ${fx.epicId} no longer exists — deleting the evidence is not a fix`);
}

/** Layer A over an output a Layer B fixture produced (task 2.9): every invocation in it passes the
 *  pre-dispatch check. Engine output is never marked, so a refusal here is a finding. */
async function assertLayerA(label, out) {
  const { problems } = await layerA(label, out, dispatchedVerbs());
  assert.deepEqual(problems, [], `Layer A over ${label}'s output:\n${problems.join("\n")}`);
}

/** Register one builder as tests: one per alternative (fresh fixture each), or the prints-none check. */
function registerBuilder(label, spec) {
  if (spec.unconstructable) return;
  const cases = Array.isArray(spec) ? spec : [spec];
  cases.forEach((c, k) => {
    const name = `${label}${cases.length > 1 ? ` [${c.case || k}]` : ""}`;
    if (c.prints === "none") {
      test(`Layer B ${name} — reproduces its condition and prints no engine invocation`, async () => {
        const fx = c.setup();
        const out = c.produce(fx);
        assert.ok(c.reported(out, fx), `the producer does not report the condition:\n${out}`);
        await assertLayerA(name, out);
        assert.deepEqual(engineInvocations(out).map(i => i.text), [], `prints: none, but the output carries an invocation:\n${out}`);
      });
      return;
    }
    for (const alt of c.alternatives || [{ name: "remedy" }]) {
      test(`Layer B ${name} {${alt.name}} — the remedy clears what printed it`, async () => {
        const fx = c.setup(alt);
        if (c.observe) c.observe(fx);
        await assertLayerA(name, c.produce(fx));
        followRemedy(fx, c, alt);
      });
    }
  });
}

// ─────────────── fixture vocabulary ───────────────

/** An openspec-lane epic with `n` commits attributed to it, in landing order. */
function openspecEpic(repo, id, n = 1, extra = []) {
  repo.ok(["add-epic", "--id", id, "--lane", "openspec", "--title", id, ...extra]);
  const shas = repo.commits(...Array.from({ length: n }, (_, i) => `feat(${id}): ${i + 1}`));
  for (const sha of shas) repo.ok(["update-epic", id, "--attribute-commit", sha]);
  return shas;
}
const passGate2 = (repo, id, base, head) =>
  repo.ok(["record-gate-review", id, "--gate", "2", "--verdict", "pass", "--base-sha", base, "--head-sha", head]);
/** Archive by the drift heal: the change directory lands under archive/ and `render` heals. */
function healArchive(repo, id) {
  repo.file(`openspec/changes/archive/2026-09-01-${id}/proposal.md`, "# archived\n");
  repo.ok(["render"]);
  assert.equal(repo.epic(id).status, "archived", "fixture: the heal archived the epic");
}
/** Meaning shared by every Gate 2 range remedy: the range that covers what the epic attributed. */
const rangeMeaning = (repo, id) => () => {
  const a = repo.epic(id).attributedCommits;
  return { "base-sha": repo.parent(a[0]), "head-sha": a[a.length - 1] };
};
const blockHas = (id) => (out, fx) => out.includes(`\`${fx.epicId}\``);
const integrityProducer = (checkId) => (fx) => integrityBlock(fx.repo, checkId);

// ─────────────── integrity: one builder per CHECKS id ───────────────

const INTEGRITY_BUILDERS = {
  "archived-with-zero-ticked-tasks": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "zt", "--lane", "openspec", "--title", "zt"]);
      repo.file("openspec/changes/zt/tasks.md", "## 1\n\n- [ ] 1.1 never ticked\n");
      repo.file("openspec/changes/archive/2026-09-01-zt/tasks.md", "## 1\n\n- [ ] 1.1 never ticked\n");
      repo.ok(["render"]);
      return { repo, epicId: "zt" };
    },
    produce: integrityProducer("archived-with-zero-ticked-tasks"),
    reported: blockHas(),
  },
  "verdict-range-omits-cited-commits": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      const [a, b] = repo.commits("one", "two");
      const [elsewhere] = fixtureCommits(repo.cwd, ["unrelated"], { orphan: true });
      repo.write({ epics: [{ id: "vr", title: "vr", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [],
        gateReview: { gate2: { verdict: "pass", baseSha: a, headSha: b, reviewedAt: AT, note: `reviewed ${elsewhere}` } } }] });
      return { repo, epicId: "vr" };
    },
    produce: integrityProducer("verdict-range-omits-cited-commits"),
    reported: blockHas(),
  },
  "archived-with-no-gate-2-review": {
    setup() {
      const repo = remedyRepo();
      openspecEpic(repo, "ug", 2);
      healArchive(repo, "ug");
      return { repo, epicId: "ug" };
    },
    produce: integrityProducer("archived-with-no-gate-2-review"),
    reported: blockHas(),
    meaning: (fx) => rangeMeaning(fx.repo, fx.epicId)(),
  },
  "archived-with-withdrawn-gate-2": {
    setup() {
      const repo = remedyRepo();
      const shas = openspecEpic(repo, "wg", 1);
      passGate2(repo, "wg", repo.parent(shas[0]), shas[0]);
      repo.ok(["update-epic", "wg", "--withdraw-gate-review", "2", "--withdrawal-reason", REASON]);
      healArchive(repo, "wg");
      return { repo, epicId: "wg" };
    },
    produce: integrityProducer("archived-with-withdrawn-gate-2"),
    reported: blockHas(),
    meaning: (fx) => rangeMeaning(fx.repo, fx.epicId)(),
  },
  "delivered-epic-attributed-no-commits": [
    {
      case: "never attributed",
      setup() {
        const repo = remedyRepo();
        openspecEpic(repo, "na", 0);
        const [c1] = repo.commits("shipped");
        passGate2(repo, "na", repo.parent(c1), c1);
        repo.ok(["update-epic", "na", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
        return { repo, epicId: "na", shipped: c1 };
      },
      produce: integrityProducer("delivered-epic-attributed-no-commits"),
      reported: blockHas(),
      meaning: (fx) => ({ "attribute-commit": fx.shipped }),
    },
    {
      // 2.2 — archived delivered, C1 attributed under a Gate 2 headed at C1, C1 amended to C2; Gate 2
      // re-recorded over C2, then C1 withdrawn: the record attributes nothing, having withdrawn C1.
      case: "withdrawn",
      setup() {
        const repo = remedyRepo();
        const [c1] = openspecEpic(repo, "wd", 1);
        passGate2(repo, "wd", repo.parent(c1), c1);
        repo.ok(["update-epic", "wd", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
        const c2 = repo.amend(c1, "feat(wd): amended");
        passGate2(repo, "wd", repo.parent(c2), c2);
        repo.ok(["update-epic", "wd", "--withdraw-commit", c1, "--withdrawal-reason", `amended into ${c2.slice(0, 7)}`]);
        assert.deepEqual(repo.epic("wd").attributedCommits, [], "fixture: C1 withdrawn");
        return { repo, epicId: "wd", replacing: c2 };
      },
      produce: integrityProducer("delivered-epic-attributed-no-commits"),
      reported: blockHas(),
      meaning: (fx) => ({ "base-sha": fx.repo.parent(fx.replacing), "head-sha": fx.replacing, "attribute-commit": fx.replacing }),
    },
  ],
  "archived-openspec-epic-with-no-gate-1": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      const [c1] = openspecEpic(repo, "g1", 1);
      passGate2(repo, "g1", repo.parent(c1), c1);
      repo.ok(["update-epic", "g1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
      return { repo, epicId: "g1" };
    },
    produce: integrityProducer("archived-openspec-epic-with-no-gate-1"),
    reported: blockHas(),
  },
  "archive-directory-has-no-epic": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      repo.file("openspec/changes/archive/2026-09-01-orphan-change/proposal.md", "# x\n");
      return { repo };
    },
    produce: integrityProducer("archive-directory-has-no-epic"),
    reported: (out) => out.includes("orphan-change"),
  },
  "heal-archived-epic-passed-gate-2": {
    setup() {
      const repo = remedyRepo();
      const [c1] = openspecEpic(repo, "hg", 1);
      passGate2(repo, "hg", repo.parent(c1), c1);
      healArchive(repo, "hg");
      return { repo, epicId: "hg" };
    },
    produce: integrityProducer("heal-archived-epic-passed-gate-2"),
    reported: blockHas(),
    meaning: () => ({}),
  },
  "gate-recorded-as-bookkeeping": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      const [c1] = openspecEpic(repo, "bk", 1);
      const art = repo.file("openspec/changes/bk/proposal.md", "# bk\n");
      repo.ok(["record-gate-review", "bk", "--gate", "1", "--verdict", "pass", "--artifact", art]);
      passGate2(repo, "bk", repo.parent(c1), c1);
      return { repo, epicId: "bk" };
    },
    produce: integrityProducer("gate-recorded-as-bookkeeping"),
    reported: blockHas(),
  },
  "change-registered-under-two-lanes": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "twice", "--lane", "openspec", "--title", "twice"]);
      repo.ok(["add-epic", "--id", "2026-09-01-twice", "--lane", "superpowers", "--title", "twice"]);
      return { repo, epicId: "twice" };
    },
    produce: integrityProducer("change-registered-under-two-lanes"),
    reported: blockHas(),
  },
  "link-of-unknown-type": {
    setup() {
      const repo = remedyRepo();
      const base = { priority: "P1", status: "queued", role: "epic", lane: "claude-code" };
      repo.write({ epics: [
        { id: "lk", title: "lk", ...base, links: [{ type: "frobnicates", epic: "other" }] },
        { id: "other", title: "other", ...base, links: [] }] });
      return { repo, epicId: "lk" };
    },
    produce: integrityProducer("link-of-unknown-type"),
    reported: blockHas(),
    meaning: () => ({ link: "relates-to:other:fixture" }),
  },
  "epic-in-undefined-status": [
    ...["queued", ...["killed", "superseded", "abandoned", "declined", "unreconstructable"]].map(choice => ({
      // 2.5 — an openspec-lane epic with no Gate 2 in a status the engine does not define. Each
      // alternative the finding offers, in its own fixture; `delivered` must not be one of them.
      case: `openspec, no Gate 2 → ${choice}`,
      setup() {
        const repo = remedyRepo();
        repo.write({ epics: [{ id: "ud", title: "ud", priority: "P1", status: "done", role: "epic", lane: "openspec", links: [] }] });
        return { repo, epicId: "ud" };
      },
      observe(fx) {
        const out = integrityBlock(fx.repo, "epic-in-undefined-status");
        const archive = engineInvocations(out).find(i => i.text.includes("--status archived"));
        assert.ok(archive, `an archive invocation is offered:\n${out}`);
        assert.doesNotMatch(archive.text, /--outcome <[^>]*\bdelivered\b/, "delivered is not offered for an openspec epic with no Gate 2");
      },
      produce: integrityProducer("epic-in-undefined-status"),
      reported: blockHas(),
      alternatives: [{
        name: choice,
        select: (invs) => invs.filter(i => choice === "queued" ? !i.text.includes("--outcome") : i.text.includes("--outcome")),
        form: (f) => f.tokens.includes("--no-deferrals"),
        meaning: () => (choice === "queued" ? { status: "queued" } : { status: "archived", outcome: choice, reason: REASON }),
      }],
    })),
  ],
  "dangling-epic-reference": [
    {
      case: "release deferral",
      prints: "none",
      setup() {
        const repo = remedyRepo();
        repo.write({ epics: [], releases: [{ id: "1.0.0", deferred: [{ epic: "gone", reason: "cut", deferredAt: AT }] }] });
        return { repo };
      },
      produce: integrityProducer("dangling-epic-reference"),
      reported: (out) => out.includes("`gone`"),
    },
    {
      case: "detour-stack frame",
      prints: "none",
      setup() {
        const repo = remedyRepo();
        repo.write({ active: null, epics: [{ id: "p", title: "p", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [] }],
          detourStack: [{ pausedEpic: "p", spawnedDetour: "gone", reason: "x", pausedAt: AT, reconcileOnResume: false }] });
        return { repo };
      },
      produce: integrityProducer("dangling-epic-reference"),
      reported: (out) => out.includes("`gone`"),
    },
  ],
  "superseded-epic-never-ended": {
    setup() {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "old", "--lane", "claude-code", "--title", "old"]);
      repo.ok(["add-epic", "--id", "new", "--lane", "claude-code", "--title", "new", "--link", "supersedes:old:replaces it"]);
      return { repo, epicId: "old" };
    },
    produce: integrityProducer("superseded-epic-never-ended"),
    reported: blockHas(),
    meaning: () => ({ reason: REASON }),
  },
  "delivered-release-epic-left-open": [
    // 2.3 — an openspec member with no Gate 2, still open in a release another member delivered.
    // Each alternative in its own fixture: the archive (Gate 2 precondition first) and the deferral.
    ...[["archive", (i) => !i.text.startsWith("release ")], ["release --defer", (i) => i.text.startsWith("release ")]].map(([name, pick]) => ({
      case: name,
      setup() {
        const repo = remedyRepo();
        repo.ok(["add-epic", "--id", "shipped", "--lane", "claude-code", "--title", "shipped"]);
        openspecEpic(repo, "left", 1);
        repo.ok(["release", "1.0.0", "--intent", "fixture", "--member", "shipped", "--member", "left"]);
        repo.ok(["update-epic", "shipped", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
        return { repo, epicId: "left" };
      },
      observe(fx) {
        if (name !== "archive") return;
        const out = integrityBlock(fx.repo, "delivered-release-epic-left-open");
        const g = out.indexOf("record-gate-review left --gate 2");
        const archive = out.indexOf("update-epic left --status archived");
        assert.ok(g !== -1 && g < archive, `the Gate 2 precondition is named before the archive:\n${out}`);
        assert.match(out, /\beither\b[\s\S]*\bor\b/, "the two alternatives are explicitly separate");
      },
      produce: integrityProducer("delivered-release-epic-left-open"),
      reported: blockHas(),
      meaning: (fx) => ({ ...rangeMeaning(fx.repo, "left")(), reason: REASON, defer: "left" }),
      alternatives: [{ name, select: (invs) => invs.filter(pick) }],
    })),
  ],
  "recorded-sha-the-repository-cannot-resolve": [
    {
      // 2.7 — the absent arm: an orphan commit recorded, then destroyed; one reachable attributed
      // commit keeps the resolvability probe from skipping the arm. No engine remedy exists for it.
      case: "absent",
      prints: "none",
      setup() {
        const repo = remedyRepo();
        const [reachable] = openspecEpic(repo, "gone", 1);
        const [orphan] = fixtureCommits(repo.cwd, ["destroyed"], { orphan: true });
        repo.ok(["update-epic", "gone", "--attribute-commit", orphan]);
        fixtureGit(repo.cwd, "reflog", "expire", "--expire=now", "--all");
        fixtureGit(repo.cwd, "gc", "-q", "--prune=now");
        assert.deepEqual(repo.epic("gone").attributedCommits, [reachable, orphan], "fixture: both shas recorded after the gc");
        assert.notEqual(spawnSync("git", ["cat-file", "-e", `${orphan}^{commit}`], { cwd: repo.cwd }).status, 0, "fixture: the orphan is gone");
        return { repo, epicId: "gone" };
      },
      produce: integrityProducer("recorded-sha-the-repository-cannot-resolve"),
      reported: (out) => /cannot resolve at all/.test(out),
    },
    {
      case: "orphaned",
      prints: "none",
      setup() {
        const repo = remedyRepo();
        openspecEpic(repo, "orph", 1);
        const [orphan] = fixtureCommits(repo.cwd, ["orphaned"], { orphan: true });
        repo.ok(["update-epic", "orph", "--attribute-commit", orphan]);
        return { repo, epicId: "orph" };
      },
      produce: integrityProducer("recorded-sha-the-repository-cannot-resolve"),
      reported: (out) => /reachable from NO ref/.test(out),
    },
    ...[
      // The malformed-value arm, per holder: each alternative the finding offers for that holder.
      ["gate1", (repo) => ({ gate1: { verdict: "pass", baseSha: "HEAD", headSha: "main", reviewedAt: AT } }), []],
      ["gate2", (repo) => ({ gate2: { verdict: "pass", baseSha: "HEAD~1", headSha: "main", reviewedAt: AT } }), []],
      ["attributedCommits", () => ({}), ["not-a-commit"]],
    ].map(([holder, gates, attributed]) => ({
      case: `malformed ${holder}`,
      setup() {
        const repo = remedyRepo();
        const [c1] = repo.commits("reachable");
        repo.file("openspec/changes/mf/proposal.md", "# mf\n");
        repo.write({ epics: [{ id: "mf", title: "mf", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [],
          attributedCommits: [...attributed, c1], gateReview: gates(repo) }] });
        return { repo, epicId: "mf", c1 };
      },
      observe(fx) {
        if (holder !== "gate1") return;
        const out = integrityBlock(fx.repo, "recorded-sha-the-repository-cannot-resolve");
        const g = engineInvocations(out).filter(i => i.text.startsWith("record-gate-review"));
        assert.ok(g.length, `a re-record is offered:\n${out}`);
        for (const i of g) {
          assert.match(i.text, /--gate 1\b/, `the Gate 1 value's remedy re-records Gate 1: ${i.text}`);
          assert.match(i.text, /--artifact /, `a Gate 1 remedy carries --artifact: ${i.text}`);
          assert.doesNotMatch(i.text, /--base-sha|--head-sha/, `a Gate 1 remedy carries no range: ${i.text}`);
        }
      },
      produce: integrityProducer("recorded-sha-the-repository-cannot-resolve"),
      reported: (out) => /not a commit object name/.test(out),
      meaning: (fx) => ({ "withdraw-commit": "not-a-commit", "withdrawal-reason": REASON, artifact: "openspec/changes/mf/proposal.md",
        "base-sha": fx.repo.parent(fx.c1), "head-sha": fx.c1 }),
      alternatives: [{
        name: holder === "attributedCommits" ? "withdraw" : "re-record",
        select: (invs) => invs.filter(i => holder === "attributedCommits" ? i.text.includes("--withdraw-commit") : i.text.startsWith("record-gate-review")),
      }],
    })),
  ],
  "advisory-claim-shape": [
    {
      case: "archived",
      setup() {
        const repo = remedyRepo();
        repo.write({ epics: [{ id: "cl", title: "cl", priority: "P1", status: "archived", role: "epic", lane: "claude-code", links: [],
          disposition: agentDisposition({ outcome: "abandoned", reason: REASON, recordedAt: AT }),
          deferralAssertion: { none: true, recordedAt: AT },
          claim: { session: "s1", claimedAt: AT, ttlMinutes: 60 } }] });
        return { repo, epicId: "cl" };
      },
      produce: integrityProducer("advisory-claim-shape"),
      reported: blockHas(),
      meaning: () => ({}),
    },
    {
      case: "expired",
      setup() {
        const repo = remedyRepo();
        repo.write({ epics: [{ id: "cx", title: "cx", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [],
          claim: { session: "s1", claimedAt: "2026-01-01T00:00:00.000Z", ttlMinutes: 1 } }] });
        return { repo, epicId: "cx" };
      },
      produce: integrityProducer("advisory-claim-shape"),
      reported: blockHas(),
      meaning: () => ({ session: "s2" }),
    },
  ],
};

for (const [id, spec] of Object.entries(INTEGRITY_BUILDERS)) registerBuilder(`integrity:${id}`, spec);

// ─────────────── archive-gate: one builder per DELIVERED_OBLIGATIONS variant ───────────────
// Producer: the refused `delivered` archive; "reported" is the refusal; cleared is the same command
// then exiting 0.

const archiveDelivered = (id) => ["update-epic", id, "--status", "archived", "--outcome", "delivered", "--no-deferrals"];
const refusal = (argv) => (fx) => { const r = fx.repo.run(argv(fx)); fx.lastStatus = r.status; return r.status === 0 ? "" : r.stderr; };
const refused = (out, fx) => fx.lastStatus !== 0;

const OBLIGATION_BUILDERS = {
  "gate2-missing": {
    setup() { const repo = remedyRepo(); openspecEpic(repo, "om", 1); return { repo, epicId: "om" }; },
    produce: refusal(() => archiveDelivered("om")),
    reported: refused,
    meaning: (fx) => rangeMeaning(fx.repo, "om")(),
  },
  "gate2-withdrawn": {
    setup() {
      const repo = remedyRepo();
      const [c1] = openspecEpic(repo, "ow", 1);
      passGate2(repo, "ow", repo.parent(c1), c1);
      repo.ok(["update-epic", "ow", "--withdraw-gate-review", "2", "--withdrawal-reason", REASON]);
      return { repo, epicId: "ow" };
    },
    produce: refusal(() => archiveDelivered("ow")),
    reported: refused,
    meaning: (fx) => rangeMeaning(fx.repo, "ow")(),
  },
  "gate2-stale": {
    // 2.2 — a commit attributed after the reviewed head; base = parent of the first attributed
    // commit, head = the last attributed commit.
    setup() {
      const repo = remedyRepo();
      const [c1] = openspecEpic(repo, "os", 1);
      passGate2(repo, "os", repo.parent(c1), c1);
      const [c2] = repo.commits("feat(os): after the review");
      repo.ok(["update-epic", "os", "--attribute-commit", c2]);
      return { repo, epicId: "os" };
    },
    produce: refusal(() => archiveDelivered("os")),
    reported: refused,
    meaning: (fx) => rangeMeaning(fx.repo, "os")(),
  },
  "gate2-attribution-withdrawn": {
    // 2.2 — reaching the archive gate out of order: the regression refusal's own invocation for
    // `--withdraw-commit C1`, run with `--outcome delivered --correct-disposition`.
    setup() {
      const repo = remedyRepo();
      const [c1] = openspecEpic(repo, "oa", 1);
      passGate2(repo, "oa", repo.parent(c1), c1);
      repo.ok(archiveDelivered("oa"));
      const c2 = repo.amend(c1, "feat(oa): amended");
      const withdraw = ["update-epic", "oa", "--withdraw-commit", c1, "--withdrawal-reason", `amended into ${c2.slice(0, 7)}`];
      const r = repo.run(withdraw);
      assert.notEqual(r.status, 0, "fixture: the withdrawal of the last attributed commit is refused");
      const line = r.stderr.split("\n").find(l => l.startsWith("  update-epic "));
      assert.ok(line, `fixture: the refusal prints its invocation:\n${r.stderr}`);
      const [form] = expandForms(line.trim()).filter(f => !f.tokens.some(t => t === "--deferral"));
      const invocation = fillByMeaning(form, { outcome: "delivered", reason: REASON, "correct-disposition": REASON,
        "withdrawal-reason": REASON });
      assert.deepEqual(repo.epic("oa").attributedCommits, [c1], "fixture: C1 is still attributed before the producer runs");
      return { repo, epicId: "oa", invocation, replacing: c2, replaced: c1 };
    },
    observe(fx) {
      const out = refusal((f) => f.invocation)(fx);
      assert.match(out, /attributes no commits, having withdrawn/, `the archive gate refuses attribution-withdrawn:\n${out}`);
      const order = engineInvocations(out).map(i => i.text);
      const g = order.findIndex(t => t.startsWith("record-gate-review"));
      const a = order.findIndex(t => t.includes("--attribute-commit"));
      assert.ok(g !== -1 && a !== -1 && g < a, `the Gate 2 re-record is printed BEFORE --attribute-commit:\n${out}`);
    },
    produce: refusal((fx) => fx.invocation),
    reported: refused,
    meaning: (fx) => ({ "base-sha": fx.repo.parent(fx.replacing), "head-sha": fx.replacing, "attribute-commit": fx.replacing }),
    alternatives: [{
      name: "re-record then attribute, then the refused invocation",
      cleared(fx) {
        const r = fx.repo.run(fx.invocation);
        assert.equal(r.status, 0, `the refused invocation now runs:\n${r.stderr}`);
        const e = fx.repo.epic("oa");
        assert.equal(e.disposition.outcome, "delivered");
        assert.ok(!e.attributedCommits.includes(fx.replaced) && e.attributedCommits.includes(fx.replacing));
      },
    }],
  },
  "handoff": {
    setup() {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "oh", "--lane", "claude-code", "--title", "oh", "--add-story", "left behind"]);
      return { repo, epicId: "oh" };
    },
    produce: refusal(() => archiveDelivered("oh")),
    reported: refused,
    meaning: () => ({ story: "1", "carried-to": "oh", reason: REASON }),
    alternatives: [{ name: "tick the story", select: (invs) => invs.filter(i => i.text.includes("--done")) }],
  },
};
for (const [id, spec] of Object.entries(OBLIGATION_BUILDERS)) registerBuilder(`obligation:${id}`, spec);

// ─────────────── brief: one builder per BRIEF_REMEDIES id ───────────────

/** The brief lines that name `needle` — the producer scoped to the warning under test. */
const briefLines = (needle) => (fx) => {
  const r = fx.repo.run(["brief"]);
  assert.equal(r.status, 0, r.stderr);
  const text = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
  return text.split("\n").filter(l => l.includes(needle)).join("\n");
};

const BRIEF_BUILDERS = {
  "tracker-refresh-owed": {
    setup() {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "tr", "--lane", "claude-code", "--title", "tr", "--external-id", "7", "--external-url", "https://github.com/o/n/issues/7"]);
      repo.ok(["set-active", "tr"]);
      return { repo, epicId: "tr" };
    },
    produce: briefLines("TRACKER REFRESH OWED"),
    reported: (out) => out.includes("TRACKER REFRESH OWED"),
    meaning: () => ({ verdict: "unchanged", "external-updated-at": AT }),
  },
  "ungated-archive": {
    setup: INTEGRITY_BUILDERS["archived-with-no-gate-2-review"].setup,
    produce: briefLines("`ug` — "),
    reported: (out) => out.includes("`ug`"),
    meaning: (fx) => rangeMeaning(fx.repo, "ug")(),
  },
  "withdrawn-gate2-archive": {
    setup: INTEGRITY_BUILDERS["archived-with-withdrawn-gate-2"].setup,
    produce: briefLines("`wg` — "),
    reported: (out) => out.includes("`wg`"),
    meaning: (fx) => rangeMeaning(fx.repo, "wg")(),
  },
  "not-in-outward-tracker": {
    setup() {
      const repo = remedyRepo();
      repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "outward"]);
      repo.ok(["add-epic", "--id", "un", "--lane", "claude-code", "--title", "un"]);
      return { repo, epicId: "un" };
    },
    produce: briefLines("not yet in jira"),
    reported: (out) => out.includes("`un`"),
    meaning: () => ({ positional: "un", "external-id": "ABC-1", "external-url": "https://jira.example/browse/ABC-1" }),
  },
  "never-re-read": {
    prints: "none",
    setup() {
      const repo = remedyRepo();
      repo.ok(["set-tracker", "--system", "github-issues", "--repo", "o/n"]);
      repo.ok(["add-epic", "--id", "nr", "--lane", "claude-code", "--title", "nr", "--external-id", "5", "--external-url", "https://github.com/o/n/issues/5"]);
      return { repo, epicId: "nr" };
    },
    produce: briefLines("never re-read"),
    reported: (out) => /1 tracker-linked epic\(s\) never re-read/.test(out),
  },
};
for (const [id, spec] of Object.entries(BRIEF_BUILDERS)) registerBuilder(`brief:${id}`, spec);

// ─────────────── unconsidered-outcomes (2.4, 2.8) ───────────────

function unconsideredEntry(repo, id) {
  const r = repo.run(["unconsidered-outcomes"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).unconsidered.find(u => u.id === id) || null;
}
const unconsideredFixture = (lane) => () => {
  const repo = remedyRepo();
  repo.write({ epics: [{ id: "uc", title: "uc", priority: "P2", status: "archived", role: "epic", lane, links: [],
    disposition: engineStamp("archive-drift-heal", { recordedAt: AT }) }] });
  return { repo, epicId: "uc" };
};
const unconsideredProducer = (fx) => { const u = unconsideredEntry(fx.repo, "uc"); return u ? `\`${u.invocation}\`` : ""; };

registerBuilder("unconsidered:openspec-no-gate-2", {
  setup: unconsideredFixture("openspec"),
  observe(fx) {
    const u = unconsideredEntry(fx.repo, "uc");
    assert.ok(u, "fixture: the epic is in the unconsidered set");
    assert.doesNotMatch(u.invocation, /--outcome <[^>]*\bdelivered\b/, `delivered is not offered (gh-189): ${u.invocation}`);
    assert.ok(Array.isArray(u.deliveredBlockedBy), "deliveredBlockedBy is always present");
    const g = u.deliveredBlockedBy.find(b => b.kind === "gate2-missing");
    assert.ok(g, `deliveredBlockedBy names gate2-missing: ${JSON.stringify(u.deliveredBlockedBy)}`);
    assert.ok(g.remedy.some(l => /record-gate-review uc --gate 2 --verdict pass --base-sha <[^>]+> --head-sha <[^>]+>/.test(l)), JSON.stringify(g));
    assert.match(g.detail, /Gate 2/);
  },
  produce: unconsideredProducer,
  reported: (out) => out.length > 0,
  alternatives: ["killed", "superseded", "abandoned", "declined", "unreconstructable"].map(outcome => ({
    name: outcome, meaning: () => ({ outcome, reason: REASON }),
  })),
});

registerBuilder("unconsidered:claude-code (REGRESSION GUARD 2.8)", {
  setup: unconsideredFixture("claude-code"),
  observe(fx) {
    const u = unconsideredEntry(fx.repo, "uc");
    assert.match(u.invocation, /--outcome <delivered\|/, "a claude-code entry still offers delivered");
    assert.deepEqual(u.deliveredBlockedBy, [], "and names nothing blocking it");
  },
  produce: unconsideredProducer,
  reported: (out) => out.length > 0,
  alternatives: [{ name: "delivered", meaning: () => ({ outcome: "delivered", reason: REASON }) }],
});

// ─────────────── update-epic's archived-delivered regression refusal (2.6, 2.8) ───────────────

function archivedDeliveredWithGate(repo, id) {
  const [c1] = openspecEpic(repo, id, 1);
  passGate2(repo, id, repo.parent(c1), c1);
  repo.ok(archiveDelivered(id));
  return c1;
}
/** The refusal's invocation line(s): the lines beginning `  update-epic `. */
const invocationLines = (out) => out.split("\n").filter(l => l.startsWith("  update-epic "));
const notTheInvocation = (invs) => invs.filter(i => !i.text.includes("--status archived"));

for (const variant of ["remedy, then the refused command", "remedy, then the printed invocation"]) {
  registerBuilder("regression:stale", {
    // 2.6 — `--attribute-commit` of a later commit on an archived delivered openspec-lane epic.
    setup() {
      const repo = remedyRepo();
      const c1 = archivedDeliveredWithGate(repo, "rs");
      const [c2] = repo.commits("feat(rs): later");
      return { repo, epicId: "rs", c1, c2, refusedArgv: ["update-epic", "rs", "--attribute-commit", c2] };
    },
    observe(fx) {
      const out = refusal((f) => f.refusedArgv)(fx);
      assert.notEqual(fx.lastStatus, 0, "fixture: refused");
      assert.equal(invocationLines(out).length, 1, `exactly one line begins \`  update-epic \`:\n${out}`);
      assert.match(invocationLines(out)[0], /--outcome <delivered\|/, "the regression refusal keeps delivered");
      assert.match(invocationLines(out)[0], /--correct-disposition/);
      const gi = out.indexOf("record-gate-review rs --gate 2 --verdict pass --base-sha");
      assert.ok(gi !== -1 && gi < out.indexOf("  update-epic "), `the Gate 2 re-record is named before the invocation:\n${out}`);
    },
    produce: refusal((fx) => fx.refusedArgv),
    reported: refused,
    meaning: (fx) => ({ "base-sha": fx.repo.parent(fx.c1), "head-sha": fx.c2, "attribute-commit": fx.c2,
      outcome: "delivered", reason: REASON, "correct-disposition": REASON }),
    alternatives: [variant.endsWith("refused command")
      ? { name: variant, select: notTheInvocation }
      : { name: variant, cleared(fx) {
        const e = fx.repo.epic("rs");
        assert.equal(e.disposition.outcome, "delivered");
        assert.ok(e.attributedCommits.includes(fx.c2));
      } }],
  });
  registerBuilder("regression:attribution-withdrawn", {
    // 2.6 — commit-nudge 5.2a case E: ONE attributed commit C1 under a Gate 2 headed at C1, amended
    // to C2 (C1 still resolvable); `--withdraw-commit C1` is refused.
    setup() {
      const repo = remedyRepo();
      const c1 = archivedDeliveredWithGate(repo, "rw");
      const c2 = repo.amend(c1, "feat(rw): amended");
      return { repo, epicId: "rw", c1, c2,
        refusedArgv: ["update-epic", "rw", "--withdraw-commit", c1, "--withdrawal-reason", `amended into ${c2.slice(0, 7)}`] };
    },
    observe(fx) {
      const out = refusal((f) => f.refusedArgv)(fx);
      assert.notEqual(fx.lastStatus, 0, "fixture: refused");
      assert.equal(invocationLines(out).length, 1, `exactly one line begins \`  update-epic \`:\n${out}`);
      assert.match(invocationLines(out)[0], /--outcome <delivered\|/, "the regression refusal keeps delivered");
      const g = out.indexOf("record-gate-review rw --gate 2");
      const a = out.indexOf("--attribute-commit");
      const inv = out.indexOf("  update-epic ");
      assert.ok(g !== -1 && a !== -1 && g < a && a < inv, `re-record, then --attribute-commit, then the invocation:\n${out}`);
    },
    produce: refusal((fx) => fx.refusedArgv),
    reported: refused,
    meaning: (fx) => ({ "base-sha": fx.repo.parent(fx.c2), "head-sha": fx.c2, "attribute-commit": fx.c2,
      outcome: "delivered", reason: REASON, "correct-disposition": REASON, "withdrawal-reason": REASON }),
    alternatives: [variant.endsWith("refused command")
      ? { name: variant, select: notTheInvocation, cleared(fx) {
        const r = fx.repo.run(fx.refusedArgv);
        assert.equal(r.status, 0, `the refused --withdraw-commit C1 now exits 0:\n${r.stderr}`);
        assert.equal(fx.repo.epic("rw").disposition.outcome, "delivered", "delivered is kept");
      } }
      : { name: variant, cleared(fx) {
        const e = fx.repo.epic("rw");
        assert.equal(e.disposition.outcome, "delivered");
        assert.deepEqual(e.attributedCommits, [fx.c2]);
      } }],
  });
}

test("2.8 REGRESSION GUARD: a withdrawal on an archived delivered record whose Gate 2 is ALREADY stale still exits 0", () => {
  const repo = remedyRepo();
  const [c1, c2] = openspecEpic(repo, "st", 2);
  passGate2(repo, "st", repo.parent(c1), c2);
  repo.ok(archiveDelivered("st"));
  passGate2(repo, "st", repo.parent(c1), c1);
  const r = repo.run(["update-epic", "st", "--withdraw-commit", c2, "--withdrawal-reason", REASON]);
  assert.equal(r.status, 0, r.stderr);
});

test("2.8 REGRESSION GUARD: deliveredObligations() reports Gate 2 failures under kind gate2, the variant in its own field", async () => {
  const { deliveredObligations } = await import(lib("archive-gate.mjs"));
  const out = deliveredObligations({ id: "k", title: "k", status: "queued", role: "epic", lane: "openspec", links: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "gate2");
  assert.equal(out[0].variant, "gate2-missing");
});

// ─────────────── the commit nudge as a printer ───────────────

const shaIn = (repo, id, sha) => (repo.epic(id).attributedCommits || []).includes(sha);
const nudgeOf = (repo, command = "git commit") => { const o = repo.observe("PostToolUse", command); assert.equal(o.status, 0, o.stderr); return o.context; };
/** observationRepo() with the `remedyRepo` accessors Layer B's protocol needs. */
function observed(opts) {
  const repo = observationRepo(opts);
  return Object.assign(repo, {
    run: (args) => engineRun(repo.cwd, args),
    ok(args) { const r = engineRun(repo.cwd, args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r; },
    state: () => JSON.parse(fs.readFileSync(path.join(repo.cwd, ".conductor", "state.json"), "utf8")),
    epic(id) { return this.state().epics.find(e => e.id === id); },
  });
}

registerBuilder("nudge:auto-logged", [
  {
    case: "retract-detour",
    setup() {
      const repo = observed();
      repo.observe();
      const sha = repo.commit({ "src/auto.txt": "1" }, "chore: tidy an unrelated file");
      return { repo, epicId: "epic-a", sha, context: nudgeOf(repo) };
    },
    produce: (fx) => fx.context,
    reported: (out) => /AUTO-DETOUR/.test(out),
    meaning: () => ({ reason: REASON }),
    alternatives: [{
      name: "retract", select: (invs) => invs.filter(i => i.text.startsWith("retract-detour")),
      cleared(fx) {
        const md = fs.readFileSync(path.join(fx.repo.cwd, "PROJECT.md"), "utf8");
        const section = md.slice(md.indexOf("## Recent detours"), md.indexOf("## Briefing"));
        assert.ok(!section.includes(fx.sha.slice(0, 7)), `PROJECT.md shows no row for the retracted commit:\n${section}`);
      },
    }],
  },
  {
    case: "attribute",
    setup() {
      const repo = observed();
      repo.observe();
      const sha = repo.commit({ "src/auto.txt": "1" }, "chore: tidy an unrelated file");
      return { repo, epicId: "epic-a", sha, context: nudgeOf(repo) };
    },
    produce: (fx) => fx.context,
    reported: (out) => /ATTRIBUTION/.test(out),
    meaning: () => ({}),
    alternatives: [{
      name: "attribute", select: (invs) => invs.filter(i => i.text.includes("--attribute-commit")),
      cleared: (fx) => assert.ok(shaIn(fx.repo, "epic-a", fx.sha)),
    }],
  },
]);

registerBuilder("nudge:several candidates", ["detour-d", "epic-a"].map(candidate => ({
  case: candidate,
  setup() {
    const repo = observed();
    repo.ok(["add-epic", "--id", "detour-d", "--lane", "claude-code"]);
    repo.ok(["push-detour", "epic-a", "--detour", "detour-d", "--reason", "blocked", "--reconcile"]);
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: record the detour");
    repo.observe();
    const sha = repo.commit({ "src/detour.txt": "1" }, "fix: the detour's work");
    return { repo, epicId: candidate, sha, context: nudgeOf(repo) };
  },
  produce: (fx) => fx.context,
  reported: (out) => /^- `update-epic /m.test(out),
  meaning: () => ({}),
  alternatives: [{
    name: `attribute to ${candidate}`, select: (invs) => invs.filter(i => i.text.startsWith(`update-epic ${candidate} --attribute-commit`)),
    cleared: (fx) => assert.ok(shaIn(fx.repo, candidate, fx.sha), `the line attributes to ${candidate}`),
  }],
})));

registerBuilder("nudge:amend", [
  {
    case: "withdraw",
    setup() {
      const repo = observed();
      repo.observe();
      const c1 = repo.commit({ "src/amend.txt": "1" }, "feat: attributed then amended");
      nudgeOf(repo);
      repo.ok(["update-epic", "epic-a", "--attribute-commit", c1]);
      repo.git("commit", "-q", "--amend", "-m", "feat: amended");
      assert.ok(shaIn(repo, "epic-a", c1), "fixture: C1 is attributed after the amend");
      return { repo, epicId: "epic-a", c1, context: nudgeOf(repo, "git commit --amend") };
    },
    produce: (fx) => fx.context,
    reported: (out) => /--withdraw-commit/.test(out),
    meaning: () => ({}),
    alternatives: [{
      name: "withdraw", select: (invs) => invs.filter(i => i.text.includes("--withdraw-commit")),
      cleared: (fx) => assert.ok(!shaIn(fx.repo, "epic-a", fx.c1), "the replaced sha is gone from attributedCommits"),
    }],
  },
  {
    // The path where update-epic would refuse the withdrawal: change 1 suppresses the line there.
    case: "prints none where update-epic would refuse",
    prints: "none",
    setup() {
      const repo = observed({ epicId: null });
      repo.observe();
      const c1 = repo.commit({ "src/delivered.txt": "1" }, "feat: delivered work");
      nudgeOf(repo);
      repo.ok(["add-epic", "--id", "os", "--lane", "openspec", "--title", "os"]);
      repo.ok(["update-epic", "os", "--attribute-commit", c1]);
      repo.ok(["record-gate-review", "os", "--gate", "2", "--verdict", "pass", "--base-sha", repo.git("rev-parse", `${c1}^`), "--head-sha", c1]);
      repo.ok(archiveDelivered("os"));
      repo.git("commit", "-q", "--amend", "-m", "feat: delivered work, amended");
      assert.ok(shaIn(repo, "os", c1), "fixture: C1 is attributed to the delivered epic before the amend is observed");
      return { repo, epicId: "os", context: nudgeOf(repo, "git commit --amend") };
    },
    produce: (fx) => fx.context,
    reported: (out) => /is a delivered epic holding/.test(out),
  },
]);

// ─────────────── 2.7a — a legacy id holding a space prints as one shell word ───────────────

const MY_PLAN = "My Plan";
registerBuilder("2.7a legacy id: heal-archived-epic-passed-gate-2", {
  setup() {
    const repo = remedyRepo();
    const [c1] = repo.commits("shipped");
    repo.write({ epics: [{ id: MY_PLAN, title: MY_PLAN, priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
      attributedCommits: [c1], disposition: engineStamp("archive-drift-heal", { recordedAt: AT }),
      gateReview: { gate2: { verdict: "pass", baseSha: repo.parent(c1), headSha: c1, reviewedAt: AT } } }] });
    return { repo, epicId: MY_PLAN };
  },
  observe(fx) {
    const out = integrityBlock(fx.repo, "heal-archived-epic-passed-gate-2");
    assert.match(out, /update-epic 'My Plan' --status archived/, `the id is printed shell-quoted:\n${out}`);
  },
  produce: integrityProducer("heal-archived-epic-passed-gate-2"),
  reported: (out) => out.includes("My Plan"),
  meaning: () => ({}),
});

registerBuilder("2.7a legacy id: delivered-epic-attributed-no-commits", {
  setup() {
    const repo = remedyRepo();
    const [c1] = repo.commits("shipped");
    repo.write({ epics: [{ id: MY_PLAN, title: MY_PLAN, priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
      attributedCommits: [], disposition: agentDisposition({ outcome: "delivered", recordedAt: AT }),
      deferralAssertion: { none: true, recordedAt: AT },
      gateReview: { gate2: { verdict: "pass", baseSha: repo.parent(c1), headSha: c1, reviewedAt: AT } } }] });
    return { repo, epicId: MY_PLAN, c1 };
  },
  observe(fx) {
    const out = integrityBlock(fx.repo, "delivered-epic-attributed-no-commits");
    assert.match(out, /update-epic 'My Plan' --attribute-commit/, `the id is printed shell-quoted:\n${out}`);
  },
  produce: integrityProducer("delivered-epic-attributed-no-commits"),
  reported: (out) => out.includes("My Plan"),
  meaning: (fx) => ({ "attribute-commit": fx.c1 }),
});

registerBuilder("2.7a legacy id: the nudge", [
  {
    case: "--attribute-commit",
    setup() {
      const repo = observed({ epicId: null });
      writeState(repo.cwd, { version: 1, active: MY_PLAN, detourStack: [], epics: [{ id: MY_PLAN, title: MY_PLAN, priority: "P1",
        status: "active", role: "epic", lane: "claude-code", links: [], attributedCommits: [] }] });
      repo.observe();
      const sha = repo.commit({ "src/plan.txt": "1" }, "feat: the plan's work");
      return { repo, epicId: MY_PLAN, sha, context: nudgeOf(repo) };
    },
    observe: (fx) => assert.match(fx.context, /update-epic 'My Plan' --attribute-commit/, fx.context),
    produce: (fx) => fx.context,
    reported: (out) => /ATTRIBUTION/.test(out),
    meaning: () => ({}),
    alternatives: [{ name: "attribute", select: (invs) => invs.filter(i => i.text.includes("--attribute-commit")),
      cleared: (fx) => assert.ok(shaIn(fx.repo, MY_PLAN, fx.sha)) }],
  },
  {
    case: "--withdraw-commit",
    setup() {
      const repo = observed({ epicId: null });
      writeState(repo.cwd, { version: 1, active: MY_PLAN, detourStack: [], epics: [{ id: MY_PLAN, title: MY_PLAN, priority: "P1",
        status: "active", role: "epic", lane: "claude-code", links: [], attributedCommits: [] }] });
      repo.observe();
      const c1 = repo.commit({ "src/plan.txt": "1" }, "feat: the plan's work");
      nudgeOf(repo);
      repo.ok(["update-epic", MY_PLAN, "--attribute-commit", c1]);
      repo.git("commit", "-q", "--amend", "-m", "feat: amended");
      assert.ok(shaIn(repo, MY_PLAN, c1), "fixture: C1 attributed before the amend is observed");
      return { repo, epicId: MY_PLAN, c1, context: nudgeOf(repo, "git commit --amend") };
    },
    observe: (fx) => assert.match(fx.context, /update-epic 'My Plan' --withdraw-commit/, fx.context),
    produce: (fx) => fx.context,
    reported: (out) => /--withdraw-commit/.test(out),
    meaning: () => ({}),
    alternatives: [{ name: "withdraw", select: (invs) => invs.filter(i => i.text.includes("--withdraw-commit")),
      cleared: (fx) => assert.ok(!shaIn(fx.repo, MY_PLAN, fx.c1)) }],
  },
]);

// ─────────────── 2.1 — the population is the exported registries ───────────────

test("2.1 every exported registry entry has a Layer B builder, and the unconstructable count is asserted", async () => {
  const { CHECKS } = await import(lib("integrity.mjs"));
  const { DELIVERED_OBLIGATIONS } = await import(lib("archive-gate.mjs"));
  const { BRIEF_REMEDIES } = await import(lib("briefing.mjs"));
  assert.ok(Array.isArray(DELIVERED_OBLIGATIONS) && DELIVERED_OBLIGATIONS.length, "archive-gate.mjs exports DELIVERED_OBLIGATIONS");
  assert.ok(Array.isArray(BRIEF_REMEDIES) && BRIEF_REMEDIES.length, "briefing.mjs exports BRIEF_REMEDIES");
  const missing = [
    ...CHECKS.map(c => c.id).filter(id => !INTEGRITY_BUILDERS[id]).map(id => `integrity:${id}`),
    ...DELIVERED_OBLIGATIONS.map(o => o.variant).filter(id => !OBLIGATION_BUILDERS[id]).map(id => `obligation:${id}`),
    ...BRIEF_REMEDIES.map(b => b.id).filter(id => !BRIEF_BUILDERS[id]).map(id => `brief:${id}`),
  ];
  assert.deepEqual(missing, [], `registry entries with no Layer B builder: ${missing.join(", ")}`);
  const stale = [
    ...Object.keys(INTEGRITY_BUILDERS).filter(id => !CHECKS.some(c => c.id === id)),
    ...Object.keys(OBLIGATION_BUILDERS).filter(id => !DELIVERED_OBLIGATIONS.some(o => o.variant === id)),
    ...Object.keys(BRIEF_BUILDERS).filter(id => !BRIEF_REMEDIES.some(b => b.id === id)),
  ];
  assert.deepEqual(stale, [], `builders keyed by no registry entry: ${stale.join(", ")}`);
  const declared = [INTEGRITY_BUILDERS, OBLIGATION_BUILDERS, BRIEF_BUILDERS]
    .flatMap(m => Object.values(m)).flatMap(s => (Array.isArray(s) ? s : [s])).filter(s => s.unconstructable).length;
  assert.equal(declared, UNCONSTRUCTABLE, "declared-unconstructable builders");
});
