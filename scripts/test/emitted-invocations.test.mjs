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
import { ENGINE, EMPTY_CACHE, observationRepo as helperObservationRepo, tmpRepo } from "./helpers.mjs";

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
    [{ system: "jira", projectKey: "SEC", role: "secondary" }],
    // A GitHub Enterprise HOST/owner/name repo (Gate 2 E-I2): its registration line runs too.
    [{ system: "github-issues", repo: "ghe.example.com/o/s", role: "secondary" }]];
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

/** EVERY engine output this file produces — each verb's stdout and stderr, each hook's context —
 *  kept so the final sweep (E-I4) can run Layer A over all of it, not only the keyword-filtered lines
 *  a builder's producer selects, and can check that every printed-invocation template in the engine
 *  source was reached by some fixture. */
const CORPUS = [];
function engineRun(cwd, args, input) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8", ...(input !== undefined ? { input } : {}),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, PM_QUIET_ENGINE_BANNER: "1" },
  });
  const out = { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  CORPUS.push({ args, text: outputText(out) });
  return out;
}
/** A run's output as an agent reads it: a hook-shaped verb (`brief`) prints JSON, so its context is
 *  DECODED — the JSON escaping (`\"`) is not text anyone reads. */
function outputText(r) {
  let text = r.stdout;
  try { const j = JSON.parse(r.stdout); if (j && j.hookSpecificOutput) text = j.hookSpecificOutput.additionalContext || ""; } catch { /* plain text */ }
  return `${text}\n${r.stderr}`;
}
/** The helper's observation repo, with every hook observation recorded into CORPUS. */
function observationRepo(opts) {
  const repo = helperObservationRepo(opts);
  const observe = repo.observe;
  repo.observe = (...a) => {
    const o = observe(...a);
    // The context, decoded — never the hook's raw stdout, whose JSON escaping (`\"`) is not text any
    // agent reads.
    CORPUS.push({ args: ["observe", ...a], text: `${o.context || ""}\n${o.stderr || ""}` });
    return o;
  };
  return repo;
}

/** Every commit-nudge message variant change 1 prints, each from its own fixture built anchor →
 *  commit → observe, with a sanity assertion that the fixture produced the variant it names. */
export function commitNudgeVariants(only = null) {
  const variants = [];
  const want = (label) => !only || only === label;
  const ok = (repo, args) => { const r = engineRun(repo.cwd, args); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); };
  if (want("nudge[auto-logged]")) {
    const repo = observationRepo();
    repo.observe();
    repo.commit({ "src/auto.txt": "1" }, "chore: tidy an unrelated file");
    const o = repo.observe("PostToolUse", "git commit");
    assert.match(o.context, /AUTO-DETOUR/, `fixture: auto-logged. ${o.stdout}`);
    assert.match(o.context, /retract-detour /, "fixture: the retract pointer is printed");
    variants.push({ label: "nudge[auto-logged]", text: o.context, repo });
  }
  if (want("nudge[plain]")) {
    const repo = observationRepo();
    repo.observe();
    repo.commit({ "openspec/changes/epic-a/tasks.md": "- [x] 1.1\n" }, "feat(a): the active epic's own work");
    const o = repo.observe("PostToolUse", "git commit");
    assert.match(o.context, /If this was a MINIMAL detour/, `fixture: plain. ${o.stdout}`);
    variants.push({ label: "nudge[plain]", text: o.context, repo });
  }
  if (want("nudge[detour commit · several candidates]")) {
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
  if (want("nudge[amend]")) {
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
    // Per source, not only in aggregate: a source yielding nothing is a source the sweep only
    // claims to check (init's stderr carried no code span until 6.4 made its verbs spans).
    assert.ok(a.count > 0, `${s.label} yielded no invocation to check`);
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

/** The initialized baseline every fixture starts from, built ONCE per file run (task 8.1: the sweep
 *  cost more wall-clock than the slowest existing test file). Each fixture is a fresh COPY of it — its
 *  own directory, its own `.git` — so no two builders or alternatives ever share a repository. */
let TEMPLATE = null;
function templateRepo() {
  if (TEMPLATE) return TEMPLATE;
  const cwd = tmpRepo();
  fixtureGit(cwd, "init", "-q", "-b", "main");
  fixtureGit(cwd, "config", "user.email", "test@example.com");
  fixtureGit(cwd, "config", "user.name", "Test");
  fixtureGit(cwd, "config", "commit.gpgsign", "false");
  const r0 = engineRun(cwd, ["init"]);
  assert.equal(r0.status, 0, `init: ${r0.stderr}`);
  fixtureGit(cwd, "add", "-A");
  fixtureGit(cwd, "commit", "-q", "-m", "chore: baseline");
  TEMPLATE = cwd;
  return cwd;
}

/** A hermetic pm fixture: git repo (own identity, no signing), `init`, a baseline commit — a fresh
 *  copy of the template. */
export function remedyRepo() {
  const cwd = tmpRepo();
  fs.cpSync(templateRepo(), cwd, { recursive: true });
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
/** The cases of one builder spec that are registered as tests: a whole spec or ANY array element
 *  declaring `unconstructable` is skipped (it is counted by 2.1 instead) — Gate 2 E-M4, where only a
 *  whole spec was skipped and an unconstructable element was still run. `k` keeps each case's index. */
export function buildableCases(spec) {
  if (!Array.isArray(spec) && spec.unconstructable) return [];
  const cases = Array.isArray(spec) ? spec : [spec];
  return cases.map((c, k) => ({ c, k, many: cases.length > 1 })).filter(x => !x.c.unconstructable);
}

function registerBuilder(label, spec) {
  buildableCases(spec).forEach(({ c: c0, k, many }) => {
    const name = `${label}${many ? ` [${c0.case || k}]` : ""}`;
    // A producer may read in-process (a library function, not a verb run): its output joins the corpus.
    const c = { ...c0, produce: (fx) => { const out = c0.produce(fx); CORPUS.push({ args: ["produce", name], text: out }); return out; } };
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
      // 2.2 — archived delivered, C1 attributed under a Gate 2 headed at C1, C1 amended to C2, C1
      // withdrawn: the record attributes nothing, having withdrawn C1 — with its passing Gate 2 STILL
      // headed at C1 (Gate 2 E-I6). Reached by verbs: Gate 2 re-recorded over C2 (stale against the
      // attributed C1, so the record is already broken and the withdrawal is no regression), C1
      // withdrawn, then Gate 2 recorded back over C1. In THIS state `--attribute-commit C2` alone EXITS 0 (the record was already
      // broken, so it is no regression) and clears this finding — but leaves Gate 2 stale, so the
      // archive gate would refuse the record's `delivered`. The alternative's check therefore re-runs
      // the archive gate on it, which a remedy printing the attribution first, or alone, fails.
      case: "withdrawn",
      setup() {
        const repo = remedyRepo();
        const [c1] = openspecEpic(repo, "wd", 1);
        passGate2(repo, "wd", repo.parent(c1), c1);
        repo.ok(["update-epic", "wd", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
        const c2 = repo.amend(c1, "feat(wd): amended");
        passGate2(repo, "wd", repo.parent(c2), c2);
        repo.ok(["update-epic", "wd", "--withdraw-commit", c1, "--withdrawal-reason", `amended into ${c2.slice(0, 7)}`]);
        passGate2(repo, "wd", repo.parent(c1), c1);
        assert.deepEqual(repo.epic("wd").attributedCommits, [], "fixture: C1 withdrawn");
        assert.equal(repo.epic("wd").gateReview.gate2.headSha, c1, "fixture: Gate 2 is headed at C1");
        return { repo, epicId: "wd", replacing: c2 };
      },
      observe(fx) {
        // The order is load-bearing: the re-record precedes the attribution, as the obligation prints it.
        const order = engineInvocations(integrityBlock(fx.repo, "delivered-epic-attributed-no-commits")).map(i => i.text);
        const g = order.findIndex(t => t.startsWith("record-gate-review wd --gate 2"));
        const a = order.findIndex(t => t.includes("--attribute-commit"));
        assert.ok(g !== -1 && a !== -1 && g < a, `the Gate 2 re-record is printed BEFORE --attribute-commit: ${order.join(" | ")}`);
      },
      produce: integrityProducer("delivered-epic-attributed-no-commits"),
      reported: blockHas(),
      meaning: (fx) => ({ "base-sha": fx.repo.parent(fx.replacing), "head-sha": fx.replacing, "attribute-commit": fx.replacing }),
      alternatives: [{
        name: "remedy",
        cleared(fx) {
          const out = integrityBlock(fx.repo, "delivered-epic-attributed-no-commits");
          assert.ok(!out.includes("`wd`"), `step 5: still reported:\n${out}`);
          const gate = fx.repo.run(["update-epic", "wd", "--status", "archived", "--outcome", "delivered", "--reason", REASON,
            "--correct-disposition", REASON, "--no-deferrals"]);
          assert.equal(gate.status, 0, `the record's delivered must still pass the archive gate (Gate 2 not left stale):\n${gate.stderr}`);
        },
      }],
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
  "heal-archived-epic-passed-gate-2": [
    {
      case: "nothing outstanding",
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
    // Gate 2 R-I1 sweep — this check's step is a second printer offering `--outcome delivered` for one
    // epic, and it consulted no obligation: an open task in a plan, or an open inline story, gets the
    // step refused "task(s) outstanding". A checkbox source carries the handoff on the archive itself;
    // a stories source names `--story <n> --done` first (the E-I5 shape).
    {
      case: "checkbox source",
      setup() {
        const repo = remedyRepo();
        repo.ok(["add-epic", "--id", "later", "--lane", "claude-code", "--title", "later"]);
        const plan = repo.file("docs/superpowers/plans/2026-08-01-hp.md", "# hp\n\n- [x] 1. done\n- [ ] 2. still open\n");
        const [c1] = openspecEpic(repo, "hp", 1, ["--plan", plan]);
        passGate2(repo, "hp", repo.parent(c1), c1);
        healArchive(repo, "hp");
        const bare = repo.run(archiveDelivered("hp"));
        assert.notEqual(bare.status, 0, "fixture: a bare delivered archive is refused on the open task");
        return { repo, epicId: "hp" };
      },
      produce: integrityProducer("heal-archived-epic-passed-gate-2"),
      reported: blockHas(),
      meaning: () => ({ "carried-to": "later", reason: REASON }),
      alternatives: [{ name: "archive, carrying the open task", cleared(fx) {
        assert.ok(!integrityBlock(fx.repo, "heal-archived-epic-passed-gate-2").includes("`hp`"), "the finding clears");
        assert.equal(fx.repo.epic("hp").disposition.carriedTo, "later");
      } }],
    },
    {
      case: "stories source",
      setup() {
        const repo = remedyRepo();
        const [c1] = openspecEpic(repo, "hs", 1, ["--add-story", "still open"]);
        passGate2(repo, "hs", repo.parent(c1), c1);
        healArchive(repo, "hs");
        const bare = repo.run(archiveDelivered("hs"));
        assert.notEqual(bare.status, 0, "fixture: a bare delivered archive is refused on the open story");
        return { repo, epicId: "hs" };
      },
      observe(fx) {
        const out = integrityBlock(fx.repo, "heal-archived-epic-passed-gate-2");
        const s = out.indexOf("update-epic hs --story <n> --done");
        const a = out.indexOf("update-epic hs --status archived");
        assert.ok(s !== -1 && s < a, `the story is recorded done before the archive:\n${out}`);
      },
      produce: integrityProducer("heal-archived-epic-passed-gate-2"),
      reported: blockHas(),
      meaning: () => ({ story: "1" }),
    },
  ],
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
    // Gate 2 E-I5 — a member whose work is a CHECKBOX source (a plan) with a task still open. No verb ticks
    // a checkbox, so the archive alternative must itself carry the handoff: `--carried-to` names where the
    // remaining work went. Without it, the printed archive exits 1 "task(s) outstanding".
    {
      case: "checkbox source",
      setup() {
        const repo = remedyRepo();
        repo.ok(["add-epic", "--id", "shipped", "--lane", "claude-code", "--title", "shipped"]);
        repo.ok(["add-epic", "--id", "later", "--lane", "claude-code", "--title", "later"]);
        const plan = repo.file("docs/superpowers/plans/2026-08-01-cb.md", "# cb\n\n- [x] 1. done\n- [ ] 2. still open\n");
        repo.ok(["add-epic", "--id", "cb", "--lane", "superpowers", "--title", "cb", "--plan", plan]);
        repo.ok(["release", "1.0.0", "--intent", "fixture", "--member", "shipped", "--member", "cb"]);
        repo.ok(["update-epic", "shipped", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
        const plain = repo.run(["update-epic", "cb", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
        assert.notEqual(plain.status, 0, "fixture: a bare delivered archive is refused on the open task");
        assert.match(plain.stderr, /outstanding/, plain.stderr);
        return { repo, epicId: "cb" };
      },
      produce: integrityProducer("delivered-release-epic-left-open"),
      reported: blockHas(),
      meaning: () => ({ "carried-to": "later", reason: REASON }),
      alternatives: [{ name: "archive, carrying the open task", select: (invs) => invs.filter(i => !i.text.startsWith("release ")) }],
    },
  ],
  // Gate 2 E-I2 — a github-issues repo recorded before the shape rule, which silently lost its `gh`
  // listing step on upgrade. Named, with the re-record that clears it; one fixture per role.
  "tracker-repo-not-a-github-repository": [
    {
      case: "primary",
      setup: () => ({ repo: trackerRepo({ system: "github-issues", repo: HOSTILE_REPO, direction: "inward" }) }),
      observe(fx) { assert.doesNotMatch(fx.repo.run(["rules"]).stdout, /gh issue list/, "fixture: no gh step for the legacy value"); },
      produce: integrityProducer("tracker-repo-not-a-github-repository"),
      reported: (out) => /primary/.test(out),
      meaning: () => ({ repo: "o/n" }),
      alternatives: [{ name: "re-record", cleared(fx) {
        assert.doesNotMatch(integrityBlock(fx.repo, "tracker-repo-not-a-github-repository"), /primary/);
        assert.match(fx.repo.run(["rules"]).stdout, /gh issue list --repo o\/n /, "the gh step is back");
      } }],
    },
    {
      case: "secondary",
      setup: () => ({ repo: trackerRepo(null, [{ system: "github-issues", repo: HOSTILE_REPO, role: "secondary", direction: "inward" }]) }),
      produce: integrityProducer("tracker-repo-not-a-github-repository"),
      reported: (out) => /secondary/.test(out),
      meaning: () => ({ repo: "o/s" }),
      alternatives: [{ name: "remove, then re-record", cleared(fx) {
        assert.doesNotMatch(integrityBlock(fx.repo, "tracker-repo-not-a-github-repository"), /secondary/);
        assert.deepEqual(fx.repo.state().secondaryTrackers.map(t => t.repo), ["o/s"]);
      } }],
    },
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

/** A `blocked` epic with no `depends-on` link, beside a queued epic it can be pointed at. */
const blockedFixture = (id, legacy) => () => {
  const repo = remedyRepo();
  const epic = (eid, status) => ({ id: eid, title: eid, priority: "P2", status, role: "epic", lane: "claude-code", links: [] });
  repo.write({ epics: [epic(id, "blocked"), epic("dep", "queued")] });
  return { repo, epicId: id, legacy };
};

const BRIEF_BUILDERS = {
  "blocked-without-depends-on": [
    ...[["bl", false], ["My Plan", true]].map(([id, legacy]) => ({
      case: legacy ? "legacy id My Plan" : "id",
      setup: blockedFixture(id, legacy),
      observe(fx) {
        if (!fx.legacy) return;
        const out = briefLines("no `depends-on` link")(fx);
        assert.match(out, /update-epic 'My Plan' --link/, `the id is printed shell-quoted (Gate 2 E-I3):\n${out}`);
      },
      produce: briefLines("no `depends-on` link"),
      reported: (out, fx) => out.includes(`\`${fx.epicId}\``),
      meaning: (fx) => ({ positional: fx.epicId, link: (name) => (name === "id" ? "dep" : "it waits on dep") }),
    })),
  ],
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
      // `both`, not `outward`: an inward procedure exists, so a key recorded WITHOUT a watermark is
      // counted never-re-read — the remedy must carry --external-updated-at to clear (Gate 2 E-I1).
      repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "both"]);
      repo.ok(["add-epic", "--id", "un", "--lane", "claude-code", "--title", "un"]);
      return { repo, epicId: "un" };
    },
    produce: (fx) => [briefLines("not yet in jira")(fx), briefLines("never re-read")(fx)].filter(Boolean).join("\n"),
    reported: (out) => out.includes("`un`") || /never re-read/.test(out),
    meaning: () => ({ positional: "un", "external-id": "ABC-1", "external-url": "https://jira.example/browse/ABC-1", "external-updated-at": AT }),
  },
  "never-re-read": {
    // 5.2 — an epic linked through an OUTWARD-ONLY primary, in a repo whose only inward procedure is a
    // secondary's: no inward procedure reads that link, so the remedy the line names must be one that
    // clears it for this epic too (repro.txt §B8).
    setup() {
      const repo = remedyRepo();
      repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "outward"]);
      repo.ok(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "o/s"]);
      repo.ok(["add-epic", "--id", "nr", "--lane", "claude-code", "--title", "nr", "--external-id", "ABC-5", "--external-url", "https://jira.example/browse/ABC-5"]);
      return { repo, epicId: "nr" };
    },
    produce: briefLines("never re-read"),
    reported: (out) => /1 tracker-linked epic\(s\) never re-read/.test(out),
    meaning: (fx) => ({ positional: fx.epicId, verdict: "unchanged", "external-updated-at": AT }),
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

// Gate 2 R-I1 — the HANDOFF regression on a CHECKBOX source. An archived delivered superpowers epic whose
// plan was fully ticked is re-pointed at a plan with a task still open. No verb ticks a checkbox, so the
// refusal's invocation must itself carry the handoff flag; without it the printed invocation, filled with
// `delivered`, is refused "task(s) outstanding" — the E-I5 defect at the refusal's own printer.
registerBuilder("regression:handoff-checkbox", {
  setup() {
    const repo = remedyRepo();
    repo.ok(["add-epic", "--id", "later", "--lane", "claude-code", "--title", "later"]);
    const ticked = repo.file("docs/superpowers/plans/2026-08-01-hc.md", "# hc\n\n- [x] 1. done\n");
    const open = repo.file("docs/superpowers/plans/2026-08-02-hc.md", "# hc\n\n- [x] 1. done\n- [ ] 2. still open\n");
    repo.ok(["add-epic", "--id", "hc", "--lane", "superpowers", "--title", "hc", "--plan", ticked]);
    repo.ok(archiveDelivered("hc"));
    const refusedArgv = ["update-epic", "hc", "--plan", open];
    const bare = repo.run(["update-epic", "hc", "--plan", open, "--status", "archived", "--outcome", "delivered",
      "--reason", REASON, "--correct-disposition", REASON]);
    assert.notEqual(bare.status, 0, "fixture: the invocation without the handoff flag is refused on the open task");
    assert.match(bare.stderr, /outstanding/, bare.stderr);
    return { repo, epicId: "hc", open, refusedArgv };
  },
  observe(fx) {
    const out = refusal((f) => f.refusedArgv)(fx);
    assert.notEqual(fx.lastStatus, 0, "fixture: refused");
    assert.match(out, /broken: the handoff demand/, out);
    const lines = invocationLines(out);
    assert.equal(lines.length, 1, `exactly one line begins \`  update-epic \`:\n${out}`);
    assert.match(lines[0], /--outcome <delivered\|/, "the regression refusal keeps delivered");
    assert.match(lines[0], /--carried-to <epicId>/, `the invocation carries the handoff:\n${out}`);
    assert.equal((lines[0].match(/--reason\b/g) || []).length, 1, `one --reason, not two:\n${lines[0]}`);
  },
  produce: refusal((fx) => fx.refusedArgv),
  reported: refused,
  meaning: () => ({ outcome: "delivered", reason: REASON, "correct-disposition": REASON, "carried-to": "later" }),
  alternatives: [{ name: "the printed invocation, carrying the open task", cleared(fx) {
    const e = fx.repo.epic("hc");
    assert.equal(e.planPath, fx.open, "the edit the refusal stopped is made");
    assert.equal(e.disposition.outcome, "delivered");
    assert.equal(e.disposition.carriedTo, "later");
  } }],
});

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
  const { DELIVERED_OBLIGATIONS, deliveredObligations } = await import(lib("archive-gate.mjs"));
  const out = deliveredObligations({ id: "k", title: "k", status: "queued", role: "epic", lane: "openspec", links: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "gate2");
  assert.equal(out[0].variant, "gate2-missing");
  // EVERY Gate 2 variant, not only the one a bare epic reaches (Gate 2 E-M1): deliveredRegression
  // compares by kind, so one variant under its own kind would read a stale→withdrawn move as a regression.
  const gate2 = DELIVERED_OBLIGATIONS.filter(o => /^gate2-/.test(o.variant));
  assert.ok(gate2.length >= 4, `the Gate 2 variants: ${gate2.map(o => o.variant).join(", ")}`);
  for (const o of gate2) assert.equal(o.kind, "gate2", `${o.variant} reports under kind gate2`);
});

test("2.8 REGRESSION GUARD: the refusal's invocation keeps offering delivered where the pre-edit record already blocks it", () => {
  // Gate 2 E-M2 — keepDelivered. The pre-edit record's Gate 2 is already stale (so blockedDelivered()
  // names it), and the edit newly breaks the HANDOFF: the refusal's invocation must still offer the
  // `delivered` that was considered, which the epic-aware default would omit.
  const repo = remedyRepo();
  const [c1, c2] = openspecEpic(repo, "kd", 2);
  passGate2(repo, "kd", repo.parent(c1), c2);
  repo.ok(archiveDelivered("kd"));
  passGate2(repo, "kd", repo.parent(c1), c1);
  const r = repo.run(["update-epic", "kd", "--add-story", "left behind"]);
  assert.notEqual(r.status, 0, `fixture: the new outstanding story is a handoff regression:\n${r.stderr}`);
  assert.match(r.stderr, /broken: the handoff demand/, r.stderr);
  const [line] = invocationLines(r.stderr);
  assert.ok(line, `the refusal prints its invocation:\n${r.stderr}`);
  assert.match(line, /--outcome <[^>]*\bdelivered\b/, `delivered stays offered: ${line}`);
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

// ═══════════════════════════════ Layer C — tracker recipes execute for every role and system ═══════════════════════════════
//
// design.md Decision 1 Layer C and Decision 3. Every inward section the tracker matrix emits — the
// primary's and each secondary's, github-issues and jira — has its registration line filled from a
// synthetic item of that system's key shape, FOLLOWING THE SECTION'S OWN QUOTING INSTRUCTION, and
// run through `sh -c`. A title that is shell-hostile, flag-shaped, help-shaped or multi-line must
// store byte-identically and execute nothing.

const INWARD_HEADINGS = /^## (GitHub issue sync|Inward tracker sync|Secondary tracker sync) \(/;

/** Every distinct inward section across the tracker matrix (claude-code platform), with the
 *  configuration that produced it. */
export async function inwardSections() {
  const { rulesBlock } = await import(lib("rules.mjs"));
  const seen = new Map();
  for (const { tracker, secondaries } of trackerMatrix()) {
    const lines = rulesBlock(tracker, "standard", secondaries, "claude-code").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!INWARD_HEADINGS.test(lines[i])) continue;
      let j = i + 1;
      while (j < lines.length && !/^## /.test(lines[j])) j++;
      const text = lines.slice(i, j).join("\n");
      const secondary = /^## Secondary/.test(lines[i]);
      const cfg = secondary ? secondaries.find(s => text.includes(`(${s.system}`)) : tracker;
      if (!seen.has(text)) seen.set(text, { heading: lines[i], text, system: cfg.system, secondary, tracker, secondaries });
    }
  }
  return [...seen.values()];
}

/** The section's quoting sentence, if it carries one: item values filled as ONE single-quoted word. */
const quotingInstruction = (section) => /ONE shell-quoted word/.test(section.text) && /'\\''/.test(section.text);
const posixQuote = (v) => `'${v.replace(/'/g, "'\\''")}'`;

/** The span in a section that begins `prefix`, joined across its wrapped lines. */
function sectionSpan(section, prefix) {
  const spans = [];
  const joined = section.text.replace(/\n\s+/g, " ");
  for (const m of joined.matchAll(/`([^`]+)`/g)) if (m[1].startsWith(prefix)) spans.push(m[1]);
  return spans;
}

/** Does the section's listing step request an updated timestamp for the item? */
const listingFetchesUpdated = (section) => {
  // The whole step, wrapped lines included: from `1. ` to the next numbered step.
  const m = /^1\. [\s\S]*?(?=^2\. )/m.exec(section.text);
  const step1 = (m ? m[0] : "").replace(/\n\s+/g, " ");
  return /updatedAt/.test(step1) || /updated timestamp/.test(step1);
};

/** Fill one recipe line from `item` following the section's own instruction, as a shell line. */
function fillRecipe(section, line, item) {
  const quoted = quotingInstruction(section);
  // Item-sourced values: one shell word per the instruction, or — where the section gives none —
  // exactly what its text shows (a value dropped inside the double quotes it prints).
  const itemValue = (v) => (quoted ? posixQuote(v) : v);
  let out = line
    .replace(/<issue-title>/g, () => itemValue(item.title))
    .replace(/<issue-url>/g, () => itemValue(item.url))
    .replace(/<issue-key-slug>/g, item.key.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .replace(/<issue-key>/g, () => itemValue(item.key))
    .replace(/<issue-number>/g, item.key)
    .replace(/<lane>/g, "claude-code");
  if (listingFetchesUpdated(section)) out = out.replace(/<issue-updated-at>/g, AT);
  return out;
}

function shRun(cwd, line) {
  const r = spawnSync("sh", ["-c", `node "${ENGINE}" ${line}`], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, PM_QUIET_ENGINE_BANNER: "1" },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const HOSTILE_TITLES = [
  "Ordinary title",
  "it's \"done\" $(touch pwned) `id`",
  "--limit=5 ignored",
  "-h",
  "--help",
  "-x starts with a dash",
  "line one\nline two",
];
const itemFor = (section, n) => section.system === "github-issues"
  ? { key: String(40 + n), url: `https://github.com/o/n/issues/${40 + n}` }
  : { key: `ABC-${120 + n}`, url: `https://jira.example/browse/ABC-${120 + n}` };

test("3.1/3.3 Layer C: every inward section's registration line and lane-routing call, filled per its quoting instruction, run through sh", async () => {
  const sections = await inwardSections();
  assert.ok(sections.some(s => s.secondary && s.system === "github-issues") && sections.some(s => s.secondary && s.system === "jira") &&
    sections.some(s => !s.secondary && s.system === "github-issues") && sections.some(s => !s.secondary && s.system === "jira"),
    `the matrix emits primary and secondary inward sections for both systems: ${sections.map(s => s.heading).join(" | ")}`);
  const problems = [];
  for (const section of sections) {
    const [registration] = sectionSpan(section, "add-epic --id ");
    const [routing] = sectionSpan(section, "suggest-lane");
    if (!registration || !routing) { problems.push(`${section.heading}: no registration line or no lane-routing call`); continue; }
    for (const flag of ["--title=", "--external-url="]) {
      if (!registration.includes(flag)) problems.push(`${section.heading}: registration does not use ${flag}`);
    }
    if (!routing.startsWith("suggest-lane --ask=")) problems.push(`${section.heading}: lane routing is not \`suggest-lane --ask=\`: ${routing}`);
    const repo = remedyRepo();
    HOSTILE_TITLES.forEach((title, n) => {
      const item = { ...itemFor(section, n), title };
      const reg = fillRecipe(section, registration, item);
      const r = shRun(repo.cwd, reg);
      if (r.status !== 0) { problems.push(`${section.heading} [${JSON.stringify(title)}]: registration exited ${r.status}: ${r.stderr.split("\n")[0]}\n    ${reg}`); return; }
      const epic = repo.state().epics.find(e => e.externalUrl === item.url);
      if (!epic) problems.push(`${section.heading} [${JSON.stringify(title)}]: no epic registered for ${item.url}`);
      // The read-back value is NOT printed: when a title executed, it holds the command's output
      // (for `id`, the machine's user and groups), which does not belong in a saved test transcript.
      else if (epic.title !== title) problems.push(`${section.heading}: title ${JSON.stringify(title)} did not read back byte-identical (${epic.title.length} chars stored)`);
      const lane = shRun(repo.cwd, fillRecipe(section, routing, item));
      if (lane.status !== 0 || !/"lane"/.test(lane.stdout)) {
        problems.push(`${section.heading} [${JSON.stringify(title)}]: lane routing exited ${lane.status}: ${(lane.stderr || lane.stdout).split("\n")[0]}`);
      }
    });
    if (fs.existsSync(path.join(repo.cwd, "pwned"))) problems.push(`${section.heading}: a title executed a command (pwned exists)`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("3.2 jira keys ABC-123 and ABC-124 register as two distinct epics; the same key twice is refused", async () => {
  const sections = (await inwardSections()).filter(s => s.system === "jira" && !s.secondary && /· ABC\)/.test(s.heading));
  assert.ok(sections.length, "an inward jira primary scoped to ABC is emitted");
  for (const section of sections) {
    const [registration] = sectionSpan(section, "add-epic --id ");
    const repo = remedyRepo();
    const itemA = { key: "ABC-123", url: "https://jira.example/browse/ABC-123", title: "A" };
    const itemB = { key: "ABC-124", url: "https://jira.example/browse/ABC-124", title: "B" };
    for (const item of [itemA, itemB]) {
      const r = shRun(repo.cwd, fillRecipe(section, registration, item));
      assert.equal(r.status, 0, `${section.heading}: ${item.key} registers: ${r.stderr}`);
    }
    const ids = repo.state().epics.filter(e => /ABC-12[34]/.test(e.externalUrl || "")).map(e => e.id);
    assert.equal(new Set(ids).size, 2, `two distinct ids: ${ids}`);
    const again = shRun(repo.cwd, fillRecipe(section, registration, { ...itemA, url: "https://jira.example/browse/ABC-123?again" }));
    assert.notEqual(again.status, 0, "the same key derives the same id, refused as a duplicate");
  }
});

test("3.3a suggest-lane --ask reads a flag-shaped text; the positional form is unchanged; both at once is refused; help lists --ask", () => {
  const repo = remedyRepo();
  const ask = repo.run(["suggest-lane", "--ask=--limit=5 ignored"]);
  assert.equal(ask.status, 0, ask.stderr);
  assert.deepEqual(JSON.parse(ask.stdout), { lane: null, matched: null });
  repo.ok(["set-lane-routing", "--add", "limit=5:superpowers"]);
  assert.equal(JSON.parse(repo.run(["suggest-lane", "--ask=--limit=5 ignored"]).stdout).lane, "superpowers",
    "it routes on the text --limit=5 ignored");
  const positional = repo.run(["suggest-lane", "fix a typo"]);
  assert.equal(positional.status, 0, positional.stderr);
  assert.deepEqual(JSON.parse(positional.stdout), { lane: null, matched: null });
  const both = repo.run(["suggest-lane", "--ask=x", "y"]);
  assert.notEqual(both.status, 0, "--ask and a positional text together are refused");
  assert.match(both.stderr, /extra argument/);
  const help = repo.run(["suggest-lane", "--help"]);
  assert.match(help.stdout + help.stderr, /--ask/);
});

test("3.4 every github-issues listing step names --limit, and the truncation stop precedes the closed-item step", async () => {
  for (const section of (await inwardSections()).filter(s => s.system === "github-issues")) {
    const step1 = section.text.split("\n").find(l => /^1\. /.test(l));
    assert.match(step1, /gh issue list .*--limit \d+/, `${section.heading}: ${step1}`);
    const flat = section.text.replace(/\n\s+/g, " ");
    const stop = flat.search(/do not run the closed-item step/i);
    const closed = flat.search(/did NOT appear in the open list/);
    assert.ok(stop !== -1 && closed !== -1 && stop < closed, `${section.heading}: truncation stop before the closed-item step`);
  }
});

test("3.5 no emitted section names /pm:epic list", async () => {
  for (const { label, text } of await renderedRulesBlocks()) {
    assert.ok(!/pm:epic list|\$pm-epic list|pm-epic list/.test(text), `${label} names an epic list command pm does not ship`);
  }
});

test("3.6 every secondary section carries the watermark step before its closed-item step", async () => {
  const secondaries = (await inwardSections()).filter(s => s.secondary);
  assert.ok(secondaries.length >= 2);
  for (const section of secondaries) {
    const flat = section.text.replace(/\n\s+/g, " ");
    const watermark = flat.search(/listing alone must never advance the watermark/);
    const closed = flat.search(/did NOT appear in the open list/);
    assert.ok(watermark !== -1 && watermark < closed, `${section.heading}: watermark step before the closed-item step`);
    assert.match(flat, /record-tracker-refresh|--external-updated-at <iso>/);
  }
});

test("3.7 the completion-sync reminder names no writeback step the block does not emit", async () => {
  const { rulesBlock } = await import(lib("rules.mjs"));
  const block = rulesBlock({ system: "github-issues", repo: "o/n", direction: "inward" }, "standard", [], "claude-code");
  const reminder = block.slice(block.indexOf("## Sync after completing tracker-linked work"));
  assert.ok(block.includes("## Sync after completing tracker-linked work"), "the reminder is present");
  const head = reminder.split("\n## ")[0];
  assert.doesNotMatch(head.replace(/\n/g, " "), /writeback steps above/, `an inward-only github-issues primary with no secondary emits no writeback step:\n${head}`);
  const withSecondary = rulesBlock({ system: "github-issues", repo: "o/n", direction: "inward" }, "standard",
    [{ system: "jira", projectKey: "SEC", role: "secondary" }], "claude-code");
  if (/writeback steps above/.test(withSecondary.replace(/\n/g, " "))) {
    assert.match(withSecondary, /Completion status writeback/, "where the reference is printed, the step exists");
  }
});

test("3.8 the outward record-the-key line carries --external-updated-at, and an epic recorded by it is not counted never-re-read", async () => {
  const { rulesBlock } = await import(lib("rules.mjs"));
  const block = rulesBlock({ system: "jira", projectKey: "ABC", direction: "outward" }, "standard",
    [{ system: "github-issues", repo: "o/s", role: "secondary" }], "claude-code");
  const flat = block.replace(/\n\s+/g, " ");
  const line = [...flat.matchAll(/`(update-epic <id> --external-id [^`]+)`/g)].map(m => m[1])[0];
  assert.ok(line, "the outward section names its record-the-key line");
  assert.match(line, /--external-updated-at <[^>]+>/, line);
  const repo = remedyRepo();
  repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "outward"]);
  repo.ok(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "o/s"]);
  repo.ok(["add-epic", "--id", "ow", "--lane", "claude-code", "--title", "ow"]);
  const argv = fillByMeaning(expandForms(line)[0], { positional: "ow", "external-id": "ABC-9",
    "external-url": "https://jira.example/browse/ABC-9", "external-updated-at": AT });
  repo.ok(argv);
  const brief = repo.run(["brief"]);
  const text = brief.stdout.trim() ? JSON.parse(brief.stdout).hookSpecificOutput.additionalContext : "";
  assert.doesNotMatch(text, /never re-read/, text);
});

// ═══════════════════════════════ 4 — set-tracker: repository shape and vendor switch ═══════════════════════════════

const HOSTILE_REPO = "a/b; touch pwned";
const stateBytes = (repo) => fs.readFileSync(path.join(repo.cwd, ".conductor", "state.json"));
const trackerRepo = (tracker, secondaries = []) => {
  const repo = remedyRepo();
  const s = repo.state();
  if (tracker) s.tracker = tracker;
  s.secondaryTrackers = secondaries;
  writeState(repo.cwd, s);
  return repo;
};

test("4.1 set-tracker refuses a github-issues --repo that is not owner/name, for both roles, writing nothing", () => {
  const NL = String.fromCharCode(10);
  for (const role of [[], ["--role", "secondary"]]) {
    const repo = remedyRepo();
    const before = stateBytes(repo);
    const shell = repo.run(["set-tracker", ...role, "--system", "github-issues", "--repo", HOSTILE_REPO]);
    assert.notEqual(shell.status, 0, `${role.join(" ") || "primary"}: a shell-metacharacter repo is refused`);
    assert.match(shell.stderr, /owner\/name/, shell.stderr);
    assert.ok(stateBytes(repo).equals(before), "state.json is byte-identical");
    const control = repo.run(["set-tracker", ...role, "--system", "github-issues", "--repo", `a/b${NL}x`]);
    assert.notEqual(control.status, 0, `${role.join(" ") || "primary"}: a control-character repo is refused`);
    assert.ok(!control.stderr.slice(0, -1).includes(NL + "x"), `the refused value is escaped, never echoed raw:\n${control.stderr}`);
    assert.ok(stateBytes(repo).equals(before), "state.json is byte-identical");
  }
  // `--remove` exempts only the SECONDARY role, which has a remove handler matching the recorded
  // value. The primary has none: exempting it there let the refused value fall through to the merge
  // and be SAVED — then rendered into the rules block's heading (Gate 2 E-C1).
  const primary = trackerRepo({ system: "github-issues", repo: "o/n", direction: "inward" });
  const before = stateBytes(primary);
  const removed = primary.run(["set-tracker", "--repo", HOSTILE_REPO, "--remove"]);
  assert.notEqual(removed.status, 0, `primary --remove with a malformed repo is refused:\n${removed.stdout}${removed.stderr}`);
  assert.match(removed.stderr, /owner\/name/, removed.stderr);
  assert.ok(stateBytes(primary).equals(before), "state.json is byte-identical");
  assert.equal(primary.state().tracker.repo, "o/n");
});

test("4.2 a legacy malformed github-issues repo loads for every read verb, and no emitted shell command contains it", async () => {
  const repo = trackerRepo({ system: "github-issues", repo: HOSTILE_REPO, direction: "inward" });
  for (const argv of [["rules"], ["brief"], ["integrity"], ["unconsidered-outcomes"], ["owners"], ["rules-target"], ["triage", "anything"]]) {
    const r = repo.run(argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}`);
  }
  const { rulesBlock } = await import(lib("rules.mjs"));
  const block = rulesBlock({ system: "github-issues", repo: HOSTILE_REPO, direction: "inward" }, "standard", [], "claude-code");
  const spans = [...block.replace(/\n\s+/g, " ").matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(t => t.includes(HOSTILE_REPO));
  assert.deepEqual(spans, [], "no code span (an emitted command) carries the malformed repo");
  const secondary = rulesBlock(null, "standard", [{ system: "github-issues", repo: HOSTILE_REPO, role: "secondary" }], "claude-code");
  assert.deepEqual([...secondary.replace(/\n\s+/g, " ").matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(t => t.includes(HOSTILE_REPO)), [],
    "nor for a legacy secondary");
});

test("4.3 switching a github-issues primary to jira drops the old repo and names it", async () => {
  const repo = trackerRepo({ system: "github-issues", repo: "o/n", direction: "inward" });
  const r = repo.ok(["set-tracker", "--system", "jira", "--project", "ABC"]);
  const t = repo.state().tracker;
  assert.equal(t.repo, undefined, JSON.stringify(t));
  assert.match(r.stderr, /dropped repo="o\/n"/, r.stderr);
  const block = repo.run(["rules"]).stdout;
  assert.match(block, /## Inward tracker sync \(jira · ABC\)/);
  assert.match(block, /add-epic --id jira-abc-/);
  assert.ok(!block.includes("o/n"), "no section names the old scope");
});

test("4.4 a vendor switch never silently changes the resolved direction", () => {
  {
    const repo = trackerRepo({ system: "github-issues", repo: "o/n" });
    const r = repo.ok(["set-tracker", "--system", "jira", "--project", "ABC"]);
    assert.equal(repo.state().tracker.direction, "inward");
    assert.match(r.stderr, /direction inward recorded — kept from the previous github-issues tracker/, r.stderr);
    assert.ok(!repo.run(["rules"]).stdout.includes("## External tracker sync"), "no outward section");
  }
  {
    const repo = trackerRepo({ system: "jira", projectKey: "ABC" });
    repo.ok(["set-tracker", "--system", "linear", "--project", "LIN"]);
    assert.equal(repo.state().tracker.direction, "outward");
  }
  {
    const repo = trackerRepo({ system: "github-issues", repo: "o/n" });
    repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "both"]);
    assert.equal(repo.state().tracker.direction, "both");
  }
});

test("4.5 REGRESSION GUARD: a legacy malformed secondary stays removable", () => {
  const repo = trackerRepo(null, [{ system: "github-issues", repo: HOSTILE_REPO, role: "secondary", direction: "inward" }]);
  repo.ok(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", HOSTILE_REPO, "--remove"]);
  assert.deepEqual(repo.state().secondaryTrackers || [], []);
});

test("4.6 REGRESSION GUARD: re-stating the same system keeps its scope; --intent still merges", () => {
  const repo = trackerRepo({ system: "jira", projectKey: "ABC", direction: "inward", statusIntent: { active: "in-progress" } });
  repo.ok(["set-tracker", "--system", "jira", "--direction", "both"]);
  assert.equal(repo.state().tracker.projectKey, "ABC");
  repo.ok(["set-tracker", "--intent", "paused:todo"]);
  assert.deepEqual(repo.state().tracker.statusIntent, { active: "in-progress", paused: "todo" });
});

test("E-I2 a GitHub Enterprise HOST/owner/name repo is accepted for both roles, and its gh step names it", async () => {
  const GHE = "ghe.example.com/o/n";
  const repo = remedyRepo();
  repo.ok(["set-tracker", "--system", "github-issues", "--repo", GHE, "--direction", "inward"]);
  repo.ok(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "ghe.example.com/o/s"]);
  assert.equal(repo.state().tracker.repo, GHE);
  const block = repo.run(["rules"]).stdout;
  assert.match(block, /gh issue list --repo ghe\.example\.com\/o\/n /, "the primary's listing step");
  assert.match(block, /gh issue list --repo ghe\.example\.com\/o\/s /, "the secondary's listing step");
  assert.match(repo.run(["integrity"]).stdout, /tracker-repo-not-a-github-repository — 0 finding/);
  for (const bad of ["a/b/c/d", "-h.example.com/o/n", "ghe.example.com//n"]) {
    const r = remedyRepo().run(["set-tracker", "--system", "github-issues", "--repo", bad]);
    assert.notEqual(r.status, 0, `refused: ${bad}`);
  }
});

// ═══════════════════════════════ 5 — brief tracker lines ═══════════════════════════════

test("5.1 with a secondary configured, the brief does not claim every active epic is mirrored to the primary", () => {
  const repo = remedyRepo();
  repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "outward"]);
  repo.ok(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "o/s"]);
  repo.ok(["add-epic", "--id", "gh1", "--lane", "claude-code", "--title", "gh1", "--external-id", "9",
    "--external-url", "https://github.com/o/s/issues/9", "--external-updated-at", AT]);
  repo.ok(["set-active", "gh1"]);
  const text = briefLines("mirrored")({ repo }) + "\n" + briefLines("external link")({ repo });
  assert.doesNotMatch(text, /mirrored to jira/, text);
  assert.match(text, /every active epic carries an external link \(this record cannot tell which tracker holds it\)/, text);
});

test("5.3 REGRESSION GUARD: with no secondary tracker the mirror line is unchanged", () => {
  const repo = remedyRepo();
  repo.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "outward"]);
  repo.ok(["add-epic", "--id", "j1", "--lane", "claude-code", "--title", "j1", "--external-id", "ABC-1",
    "--external-url", "https://jira.example/browse/ABC-1", "--external-updated-at", AT]);
  assert.equal(briefLines("mirrored")({ repo }), "  ✓ all active epics are mirrored to jira");
  const inwardOnly = remedyRepo();
  inwardOnly.ok(["set-tracker", "--system", "github-issues", "--repo", "o/n"]);
  inwardOnly.ok(["add-epic", "--id", "g1", "--lane", "claude-code", "--title", "g1", "--external-id", "1", "--external-url", "https://github.com/o/n/issues/1"]);
  assert.equal(briefLines("mirrored")({ repo: inwardOnly }), "", "an inward-only tracker still gets no mirror line");
  assert.match(briefLines("never re-read")({ repo: inwardOnly }), /1 tracker-linked epic/, "and still gets the freshness line");
  const outwardOnly = remedyRepo();
  outwardOnly.ok(["set-tracker", "--system", "jira", "--project", "ABC", "--direction", "outward"]);
  outwardOnly.ok(["add-epic", "--id", "o1", "--lane", "claude-code", "--title", "o1", "--external-id", "ABC-2", "--external-url", "https://jira.example/browse/ABC-2"]);
  assert.equal(briefLines("never re-read")({ repo: outwardOnly }), "", "no inward procedure, no freshness line");
});

// ═══════════════════════════════ 6 — no hand-edit instructions (conductor-record) ═══════════════════════════════

/** design.md Decision 7's scanner, exactly: units (paragraphs, list items) outside fences; sentences
 *  split after `.`/`!`/`?` + whitespace; a WRITE VERB in IMPERATIVE POSITION (sentence start, or right
 *  after `:`, `;`, `—` or `then`); a NEGATION anywhere in the sentence. HIT (a): imperative write +
 *  literal `state.json` + no negation. HIT (b): a list item nested under a unit that names
 *  `state.json` and ends with `:`, whose FIRST sentence is an unnegated imperative write — the only
 *  way a bare field name counts. A sentence carrying `<!-- pm:explains-hand-edit -->` is exempt. */
const WRITE_IMPERATIVE = /(^|[:;—]\s*|\bthen\s+)(edit|hand-edit|update|set|modify|change|write|flip)\s/i;
const NEGATION = /\b(never|not|don't|do not|instead of|used to|without|no longer|rather than)\b/i;
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+/);
export function handEditHits(label, markdown) {
  const units = [];
  let cur = null, fence = false;
  markdown.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; cur = null; return; }
    if (fence) return;
    if (!line.trim()) { cur = null; return; }
    const item = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item || !cur) {
      cur = { line: i + 1, indent: item ? item[1].length : line.search(/\S/), item: !!item, text: item ? item[2] : line.trim() };
      units.push(cur);
    } else cur.text += ` ${line.trim()}`;
  });
  const hits = [];
  const exempt = (s) => s.includes("<!-- pm:explains-hand-edit -->");
  let lead = null;
  for (const u of units) {
    if (lead && u.item && u.indent > lead.indent) {
      const first = sentencesOf(u.text)[0];
      if (WRITE_IMPERATIVE.test(first) && !NEGATION.test(first) && !exempt(first)) hits.push(`${label}:${u.line}`);
      continue;
    }
    lead = null;
    for (const s of sentencesOf(u.text)) {
      if (WRITE_IMPERATIVE.test(s) && s.includes("state.json") && !NEGATION.test(s) && !exempt(s)) { hits.push(`${label}:${u.line}`); break; }
    }
    if (u.text.includes("state.json") && /:\s*$/.test(u.text)) lead = u;
  }
  return hits;
}

test("6.1 init's closing line names the verbs, not a hand-edit of state.json", () => {
  const { text } = initOutput();
  const last = text.trim().split("\n").pop();
  assert.match(last, /update-epic/, last);
  assert.match(last, /set-active/, last);
  assert.doesNotMatch(last, /in \.conductor\/state\.json/, last);
  assert.ok(extractInvocations(last, dispatchedVerbs()).invocations.length >= 2,
    `init's verbs are code spans, so Layer A reads them (closes 1.5's zero-invocation source): ${last}`);
});

test("6.2 the plain commit-nudge message names update-epic, not .conductor/state.json", () => {
  const plain = commitNudgeVariants("nudge[plain]").find(v => v.label === "nudge[plain]");
  const para = plain.text.split("\n\n")[0];
  assert.match(para, /update-epic/, para);
  assert.doesNotMatch(para, /\.conductor\/state\.json/, para);
});

test("6.3 the hand-edit scanner over shipped docs reports nothing", () => {
  const hits = shippedDocs().flatMap(d => handEditHits(d.rel, d.text));
  assert.deepEqual(hits, [], `shipped text directs a write to state.json:\n${hits.join("\n")}`);
});

test("6.3 the hand-edit scanner: exactly the rules, on constructed text", () => {
  assert.deepEqual(handEditHits("x", "Then update `state.json` with the new status.\n"), ["x:1"], "an imperative write naming state.json");
  assert.deepEqual(handEditHits("x", "Never edit `state.json` by hand.\n"), [], "a negated sentence");
  assert.deepEqual(handEditHits("x", "This is what you must\nnot do: edit `state.json` directly.\n"), [], "a negation wrapped onto the previous line");
  assert.deepEqual(handEditHits("x", "- set `active` to the epic being built\n"), [], "a bare field name outside a state.json lead-in");
  assert.deepEqual(handEditHits("x", "Read `.conductor/state.json` and triage:\n  - set `priority` on each epic\n"), ["x:2"], "rule b");
  assert.deepEqual(handEditHits("x", "Update `state.json` here.<!-- pm:explains-hand-edit -->\n"), [], "an explains-hand-edit sentence");
  assert.deepEqual(handEditHits("x", "```\nedit state.json\n```\n"), [], "fenced text is outside the scan");
});

// ═══════════════════════════════ 7 — gate forms in shipped docs ═══════════════════════════════

const readDoc = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

test("7.0 the child agent doc gives no pm-repository-only instruction; review-mode names the unset the engine has", () => {
  const child = readDoc("agents/hierarchy-child-executor.md");
  assert.doesNotMatch(child, /README\.md/, "pm's README.md exists only in pm's repository");
  assert.doesNotMatch(child, /scripts\/test/, "pm's scripts/test exists only in pm's repository");
  const reviewMode = readDoc("commands/review-mode.md");
  assert.match(reviewMode, /update-epic <id> --clear review-mode/);
  assert.doesNotMatch(reviewMode.replace(/\n\s*/g, " "), /no separate "?unset"?/i);
});

/** Every passing `record-gate-review` form in shipped docs, each with the problem it has, if any. */
function gateFormProblems() {
  const verbs = dispatchedVerbs();
  const problems = [];
  let forms = 0;
  for (const doc of shippedDocs()) {
    for (const inv of extractInvocations(doc.text, verbs).invocations) {
      if (!inv.text.startsWith("record-gate-review") || (inv.marker && inv.marker.kind === "refused")) continue;
      for (const form of inv.forms) {
        const t = form.tokens;
        const at = (flag) => { const i = t.indexOf(flag); return i === -1 ? undefined : t[i + 1]; };
        const verdict = at("--verdict");
        if (!verdict || !/(^|\|)pass(\||$)/.test(verdict)) continue;
        forms++;
        const gate = at("--gate");
        const where = `${doc.rel}:${inv.line}: \`${inv.text}\``;
        if (gate === "1|2" || gate === "2|1") problems.push(`${where} — one form for both gates`);
        else if (gate === "1" && !t.includes("--artifact")) problems.push(`${where} — a Gate 1 pass without --artifact`);
        else if (gate === "1" && (t.includes("--base-sha") || t.includes("--head-sha"))) problems.push(`${where} — a Gate 1 pass carrying a range`);
        else if (gate === "2" && !(t.includes("--base-sha") && t.includes("--head-sha"))) problems.push(`${where} — a Gate 2 pass without both range flags`);
      }
    }
  }
  return { problems, forms };
}

test("7.1 every passing record-gate-review form in shipped docs carries its own gate's evidence", () => {
  const { problems, forms } = gateFormProblems();
  assert.ok(forms >= 4, `only ${forms} passing gate forms found — the scan regressed`);
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("7.1 the hierarchy child's gate-recording forms, filled, exit 0 for a Gate 1 and a Gate 2 pass", () => {
  const verbs = dispatchedVerbs();
  const forms = extractInvocations(readDoc("agents/hierarchy-child-executor.md"), verbs).invocations
    .filter(i => i.text.startsWith("record-gate-review")).flatMap(i => i.forms);
  const byGate = (g) => forms.filter(f => { const i = f.tokens.indexOf("--gate"); return i !== -1 && f.tokens[i + 1].split("|").includes(g); });
  for (const gate of ["1", "2"]) {
    const [form] = byGate(gate);
    assert.ok(form, `the child doc shows a Gate ${gate} form`);
    const repo = remedyRepo();
    const [c1] = openspecEpic(repo, "child", 1);
    const art = repo.file("openspec/changes/child/proposal.md", "# child\n");
    const argv = fillByMeaning(form, { positional: "child", gate, verdict: "pass", artifact: art, reviewer: "fixture",
      "base-sha": repo.parent(c1), "head-sha": c1 });
    const r = repo.run(argv);
    assert.equal(r.status, 0, `Gate ${gate}: \`${argv.join(" ")}\` exited ${r.status}: ${r.stderr}`);
  }
});

// ═══════════════════════════════ 9.1 findings — sites the call-site sweep reached ═══════════════════════════════

registerBuilder("9.1 update-epic's refusal to withdraw an ungated Gate 2", {
  // The sweep's `record-gate-review \${` pattern found a gate re-record printed outside gateRemedy():
  // withdrawing an `ungated` entry is refused with "clear it by recording a real verdict", and that
  // verdict must carry its gate's evidence to be accepted.
  setup() {
    const repo = remedyRepo();
    openspecEpic(repo, "wu", 1);
    healArchive(repo, "wu");
    assert.equal(repo.epic("wu").gateReview.gate2.verdict, "ungated", "fixture: the heal stamped Gate 2 ungated");
    return { repo, epicId: "wu" };
  },
  produce: refusal(() => ["update-epic", "wu", "--withdraw-gate-review", "2", "--withdrawal-reason", REASON]),
  reported: (out, fx) => fx.lastStatus !== 0 && /ungated/.test(out),
  meaning: (fx) => rangeMeaning(fx.repo, "wu")(),
  alternatives: [{
    name: "record a real verdict",
    cleared(fx) { assert.equal(fx.repo.epic("wu").gateReview.gate2.verdict, "pass", "the ungated entry is superseded by a real verdict"); },
  }],
});

test("E-M4 an unconstructable array element is not registered as a test; a whole unconstructable spec neither", () => {
  assert.deepEqual(buildableCases([{ case: "a" }, { case: "b", unconstructable: "why" }]).map(x => x.c.case), ["a"]);
  assert.deepEqual(buildableCases({ unconstructable: "why" }), []);
  assert.deepEqual(buildableCases({ case: "one" }).map(x => [x.c.case, x.many]), [["one", false]]);
});

test("E-M3 every closed-item step in every rules block states the Gate 2 condition beside its outcome list", async () => {
  const { rulesBlock } = await import(lib("rules.mjs"));
  let steps = 0;
  for (const { tracker, secondaries } of trackerMatrix()) {
    const flat = rulesBlock(tracker, "standard", secondaries, "claude-code").replace(/\n\s+/g, " ");
    for (const m of flat.matchAll(/did NOT appear in the open list you just read[\s\S]*?need a second ending\. Then re-render with `[^`]+`\./g)) {
      steps++;
      const after = flat.slice(m.index + m[0].length, m.index + m[0].length + 200);
      assert.match(after, /^ For an openspec-lane epic, `delivered` also needs a passing Gate 2/, `${m[0]}${after}`);
    }
  }
  assert.ok(steps > 20, `only ${steps} closed-item steps found across the matrix`);
});

test("E-M5 a repo on a non-github secondary is quoted as data in the writeback line, never set in a code span", async () => {
  const { rulesBlock } = await import(lib("rules.mjs"));
  const BT = "`";
  const repo = `team${BT}x`;
  const block = rulesBlock(null, "standard", [{ system: "jira", repo, projectKey: "SEC", role: "secondary" }], "claude-code");
  const line = block.split("\n").find(l => l.startsWith("tracker's repo"));
  assert.ok(line, `the writeback line names the repo:\n${block}`);
  assert.ok(line.includes(JSON.stringify(repo)), line);
  assert.ok(!line.includes(`(${BT}${repo}${BT})`), line);
  const gh = rulesBlock(null, "standard", [{ system: "github-issues", repo: "o/s", role: "secondary" }], "claude-code");
  assert.ok(gh.includes("tracker's repo (`o/s`)"), "a shaped github-issues repo is still spanned");
});

test("9.1 the rules block's disposition rule states the Gate 2 condition beside its placeholder-id outcome list", async () => {
  const { rulesBlock } = await import(lib("rules.mjs"));
  const block = rulesBlock(null, "standard", [], "claude-code");
  const item = block.slice(block.indexOf("**End work by recording a disposition.**"));
  const head = item.slice(0, item.indexOf("\n7. ")).replace(/\n\s+/g, " ");
  assert.match(head, /openspec-lane epic, `delivered` also needs a passing Gate 2/, head);
});

// ═══════════════════════════════ E-I4 — the whole corpus, and every printer reached ═══════════════════════════════

/** Every printed-invocation TEMPLATE in the engine source: a code span in a string literal of
 *  scripts/lib/*.mjs whose text begins with a dispatched verb and a space. Returned with a matcher
 *  built from the literal text up to the span's end or the literal's end, each `${…}` a wildcard. */
const quotesBeforeOf = (line, index) => (line.slice(0, index).match(/(^|[^\\])"/g) || []).length;
export function printedTemplates(verbs = dispatchedVerbs()) {
  const BS = String.fromCharCode(92);
  const HOLE = "@@HOLE@@";
  const out = [];
  const dir = path.join(REPO, "scripts", "lib");
  const verbAlt = [...verbs].sort((a, b) => b.length - a.length).map(v => v.replace(/-/g, "\\-")).join("|");
  // A span opener (`\``/`` ` ``) or a string literal that IS an indented invocation line (two or
  // more leading spaces, as the regression refusal and verify-specs print them).
  const opener = new RegExp(`(${BS}${BS}\`|\`|["\`] {2,})(${verbAlt}) `, "g");
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".mjs")).sort()) {
    const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(opener)) {
        const quotesBefore = quotesBeforeOf(line, m.index);
        let inTemplate;
        if (m[1].length > 2) {
          // An indented invocation LINE: a template literal, or a double-quoted string that opens here.
          inTemplate = m[1][0] === "`";
          if (!inTemplate && quotesBefore % 2 === 1) continue;
        } else if (m[1].length === 2) {
          inTemplate = true;                               // an escaped span inside a template literal
        } else if (quotesBefore % 2 === 1) {
          inTemplate = false;                              // a span inside a double-quoted string
        } else {
          // A plain backtick outside a double-quoted string OPENS a template literal. It is an
          // invocation only where a function BUILDS one — returned, a ternary arm, an arrow body, an
          // array element or a line of its own (gateRemedy, dispositionInvocation, a remedy list);
          // elsewhere it is a message that merely begins with a verb's name.
          if (!/(^\s*|\breturn\s+|[?:,[]\s*|=>\s*)$/.test(line.slice(0, m.index))) continue;
          inTemplate = true;
        }
        let j = m.index + m[1].length;
        let seg = "";
        const holes = [];
        while (j < line.length) {
          if (inTemplate && line.startsWith("${", j)) {
            let depth = 0, k = j + 1;
            for (; k < line.length; k++) { if (line[k] === "{") depth++; else if (line[k] === "}" && --depth === 0) break; }
            holes.push(line.slice(j + 2, k).trim());
            seg += HOLE; j = k + 1; continue;
          }
          if (line[j] === BS) {
            if (line[j + 1] === "`") break;
            seg += line[j + 1]; j += 2; continue;
          }
          const literalEnds = inTemplate ? line[j] === "`" : line[j] === '"';
          if (literalEnds) {
            // The literal closes mid-span and the line concatenates a value onto it (`"…claim " + id`):
            // that value is a hole too.
            const next = /^\s*\+\s*([A-Za-z_$][\w$.]*(?:\([^()]*\))?)/.exec(line.slice(j + 1));
            if (next) { holes.push(next[1]); seg += HOLE; }
            // …or the concatenation wraps, and the next line's literal OPENS with the value.
            else if (/^\s*\+\s*$/.test(line.slice(j + 1)) && i + 1 < lines.length) {
              const wrapped = /^\s*`\$\{([^}]*)\}/.exec(lines[i + 1]);
              if (wrapped) { holes.push(wrapped[1].trim()); seg += HOLE; }
            }
            break;
          }
          if (line[j] === "`") break;
          seg += line[j]; j++;
        }
        const literal = seg.split(HOLE).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^`\\n]*?");
        out.push({ site: `scripts/lib/${file}:${i + 1}`, text: seg.split(HOLE).join("${…}"), re: new RegExp(literal), holes, raw: seg, HOLE });
      }
    });
  }
  return out;
}

/** The printers OUTSIDE the three registries — notices, refusals and reports that print an engine
 *  invocation. Each fixture makes the engine print its line into CORPUS; the sweep below then runs
 *  Layer A over it and asserts every template in the source was reached. `expect` is the fixture's
 *  own sanity check that it produced the printer it is named for. */
const PRINTER_FIXTURES = {
  "reconcile owed: pop-detour, --clear-links, a bad --link, remove-epic, and moving the pointer off"() {
    const repo = remedyRepo();
    repo.ok(["add-epic", "--id", "rp", "--lane", "claude-code", "--title", "rp"]);
    repo.ok(["set-active", "rp"]);
    repo.ok(["add-epic", "--id", "rd", "--lane", "claude-code", "--title", "rd"]);
    repo.ok(["push-detour", "rp", "--detour", "rd", "--reason", REASON, "--reconcile"]);
    return [
      [repo.run(["pop-detour", "rp"]), /record-reconcile rp --detour rd --verdict/],
      [repo.run(["update-epic", "rp", "--clear-links"]), /record-reconcile rp --detour <detourId>/],
      [repo.run(["update-epic", "rp", "--link", "bogus:rd:x"]), /record-reconcile rp --detour <detourId>/],
      [repo.run(["remove-epic", "rd"]), /record-reconcile rp --detour rd --verdict/],
      [repo.run(["clear-active"]), /record-reconcile rp --detour <detourId>/],
    ];
  },
  "activity log off"() {
    const repo = remedyRepo();
    return [[repo.run(["activity"]), /set-activity-log on/]];
  },
  "a stale claim marker"() {
    const repo = remedyRepo();
    repo.write({ epics: [{ id: "cl", title: "cl", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [],
      claim: { session: "s1", claimedAt: "2026-01-01T00:00:00.000Z", ttlMinutes: 1 } }] });
    return [[repo.run(["owners"]), /claim <id> --session <you>/]];
  },
  "clearing a parent"() {
    const repo = remedyRepo();
    repo.ok(["add-epic", "--id", "pa", "--lane", "claude-code", "--title", "pa"]);
    repo.ok(["add-epic", "--id", "ch", "--lane", "claude-code", "--title", "ch", "--parent", "pa"]);
    return [[repo.run(["update-epic", "ch", "--clear", "parent"]), /plan-hierarchy --parent <that id>/]];
  },
  "a blocked epic with no depends-on link"() {
    const repo = remedyRepo();
    repo.ok(["add-epic", "--id", "bl", "--lane", "claude-code", "--title", "bl", "--status", "blocked"]);
    return [[repo.run(["brief"]), /update-epic bl --link "depends-on:<id>:<why>"/]];
  },
  "gate guard: the read, the reconcile block and the tracker-refresh block"() {
    const out = [];
    {
      const repo = remedyRepo();
      out.push([repo.run(["set-gate-guard"]), /set-gate-guard on\|off/]);
    }
    {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "gp", "--lane", "claude-code", "--title", "gp"]);
      repo.ok(["set-active", "gp"]);
      repo.ok(["add-epic", "--id", "gd", "--lane", "claude-code", "--title", "gd"]);
      repo.ok(["push-detour", "gp", "--detour", "gd", "--reason", REASON, "--reconcile"]);
      repo.ok(["pop-detour", "gp"]);
      out.push([engineRun(repo.cwd, ["gate-guard"], "{}"), /`set-gate-guard off` does not/]);
    }
    {
      const repo = remedyRepo();
      repo.ok(["set-gate-guard", "on"]);
      repo.ok(["add-epic", "--id", "gt", "--lane", "claude-code", "--title", "gt", "--external-id", "7", "--external-url", "https://github.com/o/n/issues/7"]);
      repo.ok(["set-active", "gt"]);
      out.push([engineRun(repo.cwd, ["gate-guard"], "{}"), /Turn the guard off with `set-gate-guard off`/]);
    }
    return out;
  },
  "releases: none declared, one declared, an unknown id, an unknown cross-spec release"() {
    const repo = remedyRepo();
    const none = repo.run(["release", "show"]);
    repo.ok(["release", "r1", "--intent", "the first"]);
    return [
      [none, /release <id> --intent/],
      [repo.run(["release", "show"]), /release show <id>/],
      [repo.run(["release", "nope"]), /release nope --intent/],
      [repo.run(["record-cross-spec-review", "nope", "--verdict", "pass", "--reviewer", "r"]), /release nope --intent/],
    ];
  },
  "a release write on a detached checkout"() {
    const repo = remedyRepo();
    fixtureGit(repo.cwd, "checkout", "-q", "--detach");
    return [[repo.run(["release", "r2", "--intent", "detached"]), /release show/]];
  },
  "remove-epic tombstones a plan, then sync skips it; a near-name plan"() {
    const repo = remedyRepo();
    const plan = repo.file("docs/superpowers/plans/2026-08-01-tomb.md", "# tomb\n\n- [ ] 1\n");
    repo.ok(["add-epic", "--id", "tomb", "--lane", "superpowers", "--title", "tomb", "--plan", plan]);
    const removed = repo.run(["remove-epic", "tomb"]);
    const skipped = repo.run(["sync"]);
    repo.ok(["add-epic", "--id", "near", "--lane", "superpowers", "--title", "near"]);
    repo.file("docs/superpowers/plans/2026-09-01-near.md", "# near\n\n- [ ] 1\n");
    return [
      [removed, /update-epic <id> --plan <path>/],
      [skipped, /update-epic <id> --plan docs\/superpowers\/plans\/2026-08-01-tomb\.md/],
      [repo.run(["sync"]), /add-epic --id 2026-09-01-near --lane superpowers --plan/],
    ];
  },
  "verify-specs: no root, an uncovered document, a header naming an epic, a dangling spec"() {
    const out = [];
    {
      const repo = remedyRepo();
      out.push([repo.run(["verify-specs"]), /verify-specs --root <path>/]);
      out.push([repo.run(["verify-specs", "--headers"]), /verify-specs --headers --root <path>/]);
    }
    {
      const repo = remedyRepo();
      repo.ok(["add-epic", "--id", "hd", "--lane", "claude-code", "--title", "hd", "--spec", "docs/superpowers/specs/gone.md"]);
      repo.file("docs/superpowers/specs/2026-08-01-hd-design.md", "# hd\n\n**Epic:** `hd`\n\nbody\n");
      out.push([repo.run(["verify-specs"]), /verify-specs --headers/]);
      out.push([repo.run(["verify-specs"]), /update-epic <id> --spec <path>/]);
      out.push([repo.run(["verify-specs", "--headers"]), /update-epic hd --spec docs\/superpowers\/specs\/2026-08-01-hd-design\.md/]);
    }
    return out;
  },
};

test("E-I4 printers outside the registries: each fixture prints the invocation it is named for", () => {
  for (const [name, build] of Object.entries(PRINTER_FIXTURES)) {
    for (const [r, expected] of build()) {
      assert.match(outputText(r), expected, `${name}: the fixture did not print its invocation:\n${outputText(r)}`);
    }
  }
});

/** The printedId() category of the call-site sweep (Gate 2 E-I3), derived from the source scan rather
 *  than a typed list: every printed-invocation template placing a VALUE where an epic id goes — the
 *  positional after a verb that takes an epic id, or the value of an id-bearing flag — must place
 *  `printedId(…)` there. A raw `${e.id}` prints a legacy `My Plan` as two shell words. */
const NOT_AN_EPIC_POSITIONAL = new Set(["release", "record-cross-spec-review", "retract-detour", "reorder", "honcho-memory", "suggest-lane", "triage"]);
// Every flag whose value is a bare epic id (`release --member/--defer`, the archive's `--carried-to`).
// `--unmember`/`--undefer`/`--link`/`--deferral` carry `<epicId>:<…>` — not a whole-token slot.
const EPIC_ID_FLAGS = new Set(["--id", "--detour", "--parent", "--carried-to", "--member", "--defer"]);
export function rawEpicIdSites(templates = printedTemplates()) {
  const bad = [];
  for (const t of templates) {
    let n = 0;
    const toks = t.raw.split(/\s+/).filter(Boolean).map(tok => tok.split(t.HOLE).length > 1
      ? { tok, holes: tok.split(t.HOLE).slice(1).map(() => t.holes[n++]) } : { tok, holes: [] });
    const verb = toks[0].tok;
    // honcho-memory's epic id follows its action word (`honcho-memory pop <id>`).
    const idAt = verb === "honcho-memory" ? 2 : 1;
    toks.forEach((x, k) => {
      if (x.tok !== t.HOLE) return;                          // only a WHOLE-token value is an id slot
      const slot = (k === idAt && !NOT_AN_EPIC_POSITIONAL.has(verb)) || (verb === "honcho-memory" && k === 2)
        || (k > 0 && EPIC_ID_FLAGS.has(toks[k - 1].tok));
      if (slot && !/^printedId\(/.test(x.holes[0])) bad.push(`${t.site}  \`${t.text}\` — \${${x.holes[0]}}`);
    });
  }
  return bad;
}

test("E-I3 every epic id a printed invocation interpolates goes through printedId()", () => {
  assert.deepEqual(rawEpicIdSites(), [], "raw epic ids in printed invocations");
});

/** Is this file running filtered? The reach half needs every fixture above to have run. */
const FILTERED = process.execArgv.some(a => /^--test-(name-pattern|skip-pattern|only)/.test(a));

test("E-I4 Layer A over EVERY output this file produced, and every printed-invocation template in the engine reached", async () => {
  const verbs = dispatchedVerbs();
  // The WHOLE output of every run — every brief, every integrity report, every refusal and notice —
  // not the keyword-filtered lines a producer selected; plus the rules blocks and init, which 1.5
  // renders in-process.
  const texts = [...new Set([...CORPUS.map(c => c.text), ...(await renderedRulesBlocks()).map(b => b.text), initOutput().text])];
  const problems = [];
  for (const t of texts) problems.push(...(await layerA("engine output", t, verbs)).problems);
  assert.deepEqual([...new Set(problems)], [], problems.join("\n"));
  if (FILTERED) return;
  assert.ok(CORPUS.length > 300, `only ${CORPUS.length} outputs recorded — the corpus hook regressed`);
  const all = texts.join("\n");
  const templates = printedTemplates(verbs);
  assert.ok(templates.length > 60, `only ${templates.length} printed templates found — the source scan regressed`);
  const unreached = templates.filter(t => !t.re.test(all)).map(t => `${t.site}  \`${t.text}\``);
  assert.deepEqual(unreached, [],
    "printed-invocation templates no fixture in this file makes the engine print — add a Layer B builder or a " +
    `PRINTER_FIXTURES entry so Layer A checks what it prints:\n${unreached.join("\n")}`);
});
