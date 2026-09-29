// Measure how often each candidate functional trigger fires over a commit range.
// usage: node measure.mjs <repo> <base> <head>
// Every set is derived from THAT commit's own tree (ls-tree + blob reads, cached by blob id).
import { execFileSync } from "node:child_process";
import path from "node:path";

const [repo, base, head] = process.argv.slice(2);
const git = (args, input) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 512 << 20, input });
const blobs = new Map();
function readBlobs(ids) {
  const need = [...new Set(ids)].filter((id) => !blobs.has(id));
  if (!need.length) return;
  const out = execFileSync("git", ["-C", repo, "cat-file", "--batch"], { input: need.join("\n") + "\n", maxBuffer: 1 << 30 });
  let i = 0;
  while (i < out.length) {
    const nl = out.indexOf(10, i);
    const [id, , size] = out.subarray(i, nl).toString().split(" ");
    const n = Number(size);
    blobs.set(id, out.subarray(nl + 1, nl + 1 + n).toString("utf8"));
    i = nl + 1 + n + 1;
  }
}

const CALLS = /\bgitOps\s*\(/;
// Gate 1 M1: a bare side-effect `import "./x.mjs"` is followed too (e.g. fixtures/hermetic-git.mjs).
const SPEC = /(?:from\s*|import\s*\(\s*|\bimport\s*|export\s+\*\s+from\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SCOPE = /^(scripts\/|\.githooks\/|hooks\/)/;
const EXEC = /["'](?:scripts\/test\/)?((?:assert|unit)\/[^"'\/]+\.test\.mjs)["']/g;

// Gate 1 round 3, R4: COMMENTS ARE STRIPPED before the EXEC match. Gate 1 round 4, T1: by the
// REGEX-AWARE lexer the design now names, `lex()` with KEYWORDS_BEFORE_REGEX from
// scripts/test/sweeps/output-interpolations.mjs (task 3.1 moves it to scripts/test/js-lexer.mjs; this
// standalone script carries a copy because that module does not exist at the commits it measures).
// One left-to-right pass: a `//` or `/*` comment, a quoted string, a template (its `${…}` is code by
// the same rules), a REGEX literal where the previous significant token cannot end an expression, or
// code. FAIL CLOSED (T1 b): a quoted string or a regex literal that meets an unescaped newline, an
// unterminated comment, or a pass that ends inside a string, template or `${…}` throws, naming the
// line, rather than returning a misread. String and regex text is KEPT here, because EXEC matches
// quoted paths; only comments go.
const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);
function stripComments(src, name = "<src>") {
  const cut = [];                                   // comment ranges [start, end)
  const fail = (k, what) => { throw new Error(`lex: ${name}:${src.slice(0, k).split("\n").length}: ${what}`); };
  const stack = [{ mode: "code", toks: [] }];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const t = stack[stack.length - 1], c = src[i];
    if (t.mode === "template") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); stack[stack.length - 1].toks.push({ kind: "template" }); i++; continue; }
      if (c === "$" && src[i + 1] === "{") { stack.push({ mode: "interp", toks: [], braces: 0 }); i += 2; continue; }
      i++; continue;
    }
    if (c === "/" && src[i + 1] === "/") { const s0 = i; while (i < n && src[i] !== "\n") i++; cut.push([s0, i, ""]); continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); if (e < 0) fail(i, "unterminated comment"); cut.push([i, e + 2, " "]); i = e + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "\n") fail(i, "string spans an unescaped newline"); j++; }
      if (j >= n) fail(i, "unterminated string");
      t.toks.push({ kind: "string" }); i = j + 1; continue;
    }
    if (c === "`") { stack.push({ mode: "template", toks: t.toks }); i++; continue; }
    if (c === "{") { if (t.mode === "interp") t.braces++; t.toks.push({ kind: "punct", text: "{" }); i++; continue; }
    if (c === "}") {
      if (t.mode === "interp" && t.braces === 0) { stack.pop(); i++; continue; }
      if (t.mode === "interp") t.braces--;
      t.toks.push({ kind: "punct", text: "}" }); i++; continue;
    }
    if (c === "/") {
      const p = t.toks[t.toks.length - 1];
      const division = p && (p.kind === "number" || p.kind === "string" || p.kind === "template" || p.kind === "regex" ||
        (p.kind === "ident" && !KEYWORDS_BEFORE_REGEX.has(p.text)) || (p.kind === "punct" && (p.text === ")" || p.text === "]" || p.text === "}")));
      if (!division) {
        let j = i + 1, inClass = false;
        while (j < n) {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "\n") fail(i, "regex literal spans a newline");
          if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
        if (j >= n) fail(i, "unterminated regex literal");
        j++; while (/[a-z]/.test(src[j] || "")) j++;
        t.toks.push({ kind: "regex" }); i = j; continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (/[\w$]/.test(src[j] || "")) j++; t.toks.push({ kind: "ident", text: src.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (/[\w.]/.test(src[j] || "")) j++; t.toks.push({ kind: "number" }); i = j; continue; }
    t.toks.push({ kind: "punct", text: c }); i++;
  }
  if (stack.length > 1) fail(n, `ends inside a ${stack[stack.length - 1].mode}`);
  let out = "", at = 0;
  for (const [a, b, fill] of cut) { out += src.slice(at, a) + fill; at = b; }
  return out + src.slice(at);
}

const treeCache = new Map();
function treeInfo(sha) {
  if (!treeCache.has(sha)) treeCache.set(sha, treeInfoUncached(sha));
  return treeCache.get(sha);
}
function treeInfoUncached(sha) {
  const entries = git(["ls-tree", "-r", sha]).split("\n").filter(Boolean).map((l) => {
    const [meta, p] = l.split("\t"); const [, , id] = meta.split(" "); return [p, id];
  });
  const idOf = new Map(entries);
  readBlobs(entries.filter(([p]) => SCOPE.test(p)).map(([, id]) => id));
  const src = (p) => (idOf.has(p) ? blobs.get(idOf.get(p)) ?? "" : "");
  const files = [...idOf.keys()];
  const lib = files.filter((f) => /^scripts\/lib\/[^/]+\.mjs$/.test(f));
  const engine = new Set(["scripts/conductor.mjs", ...lib]);
  const certified = new Set(lib.filter((f) => !/\/(git-gateway|invocation)\.mjs$/.test(f) && CALLS.test(src(f))));
  if (CALLS.test(src("scripts/conductor.mjs"))) certified.add("scripts/conductor.mjs");
  const fnl = files.filter((f) => /^scripts\/test\/functional\/[^/]+\.test\.mjs$/.test(f));
  const closure = new Set();
  const executed = new Set();
  const stack = [...fnl, "scripts/conductor.mjs"];
  while (stack.length) {
    const f = stack.pop();
    if (closure.has(f) || !idOf.has(f)) continue;
    closure.add(f);
    for (const m of src(f).matchAll(SPEC)) {
      const t = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (idOf.has(t) && !closure.has(t)) stack.push(t);
    }
    // Gate 1 round 2, C1 option (a): an assertion-half test file that a closure file under
    // scripts/test/ spells as a single- or double-quoted path (`assert/<name>.test.mjs`,
    // `unit/<name>.test.mjs`, optionally prefixed `scripts/test/`) is EXECUTED by the functional half
    // (temp-dir-cleanup's nested `node --test` runs), so it is a closure ROOT: it and its imports are
    // in the subject. Comments are stripped first (R4), so a twin named only in a comment is not matched.
    if (f.startsWith("scripts/test/")) {
      for (const m of stripComments(src(f), f).matchAll(EXEC)) {
        const t = `scripts/test/${m[1]}`;
        if (idOf.has(t) && !closure.has(t)) { executed.add(t); stack.push(t); }
      }
    }
  }
  // OBSERVED-BY-NAME: a tracked file under scripts/, .githooks/ or hooks/ whose basename appears as a
  // literal in a functional file or fixture of the closure (the coversFor() basename precedent).
  const readers = [...closure].filter((f) => f.startsWith("scripts/test/"));
  const text = readers.map(src).join("\n");
  const named = new Set();
  for (const f of files) {
    if (!SCOPE.test(f) || closure.has(f) || /^scripts\/test\/(assert|unit)\//.test(f)) continue;
    const base = path.posix.basename(f).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`["'/]${base}["'\`]`).test(text)) named.add(f);
  }
  // WIDENED (advisor finding): the functional half also reads the shipped surface and two root docs.
  // A shipped-surface ROOT is wholly in the subject when a closure file spells it as a quoted segment
  // (parity walks them by readdir); README.md and docs/parity-ledger.json by name.
  // Gate 1 round 3: hooks/ is a shipped-surface root too (PARITY_ROOTS, fixtures/parity-helpers.mjs:13).
  const ROOTS = ["commands", "skills", "agents", "hooks", ".claude-plugin"];
  const wide = new Set();
  for (const r of ROOTS) {
    if (new RegExp(`["'/]${r.replace(".", "\\.")}["'/]`).test(text)) for (const f of files) if (f.startsWith(r + "/")) wide.add(f);
  }
  for (const f of ["README.md", "docs/parity-ledger.json", "CLAUDE.md"]) {
    const b = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("docs/", "");
    if (idOf.has(f) && new RegExp(`["'/]${path.posix.basename(f).replace(".", "\\.")}["']`).test(text)) wide.add(f);
  }
  const observed = new Set([...closure, ...named]);
  const widened = new Set([...observed, ...wide]);
  return { engine, certified, closure, observed, named, widened, wide, executed, tracked: idOf };
}

const commits = git(["rev-list", "--reverse", "--no-merges", `${base}..${head}`]).split("\n").filter(Boolean);
const rows = [];
for (const c of commits) {
  const changed = git(["diff-tree", "--no-commit-id", "-r", "--name-only", "--no-renames", `${c}^`, c]).split("\n").filter(Boolean);
  const t = treeInfo(c);
  // Gate 1 B2: a DELETED subject path is judged against the parent (HEAD) tree's subject, because the
  // commit's own tree no longer holds it. Gate 1 round 2 m2 (spec "A staged change"): subject(HEAD)
  // applies ONLY to a path the commit's tree no longer holds; every other path is judged by
  // subject(commit) alone.
  const p = treeInfo(`${c}^`);
  const hit = (s) => changed.some((f) => s.has(f));
  const hitWithHead = (s, sp) => changed.some((f) => s.has(f) || (!t.tracked.has(f) && sp.has(f)));
  rows.push({
    c: c.slice(0, 8),
    A_certified: hit(t.certified),
    sweeps_engine: hit(t.engine),
    B_closure: hit(t.closure),
    B_observed: hit(t.observed),
    B_widened: hit(t.widened),
    B_widenedWithHead: hitWithHead(t.widened, p.widened),
    deletesSubjectPath: changed.some((f) => !t.tracked.has(f) && p.widened.has(f)),
    C_anyEngine: hit(t.engine),
    C_anyEngine_or_functionalFiles: hit(t.engine) || changed.some((f) => /^scripts\/test\/(functional|fixtures)\//.test(f)),
    funcFile: changed.some((f) => f.startsWith("scripts/test/functional/")),
    sizes: { executedAssertion: t.executed.size, widened: t.widened.size, wideOnly: t.wide.size, closure: t.closure.size, observed: t.observed.size, engine: t.engine.size, certified: t.certified.size },
    named: [...t.named],
    executed: [...t.executed].sort(),
  });
}
const n = rows.length;
const count = (k) => rows.filter((r) => r[k]).length;
const last = rows[n - 1];
console.log(JSON.stringify({
  range: `${base}..${head}`, nonMergeCommits: n,
  A_certified_today: count("A_certified"), sweeps_engineSource_today: count("sweeps_engine"),
  B_importClosure: count("B_closure"), B_closurePlusNamed: count("B_observed"), B_widenedShippedSurface: count("B_widened"),
  B_widenedPlusHeadDeletions: count("B_widenedWithHead"), commitsDeletingOrLeavingSubjectPath: count("deletesSubjectPath"),
  C_anyEngineModule: count("C_anyEngine"), C_plusFunctionalAndFixtureFiles: count("C_anyEngine_or_functionalFiles"),
  functionalFileChanged: count("funcFile"),
  engineCommitsMissedToday: rows.filter((r) => !r.A_certified && r.C_anyEngine).length,
  headSizes: last.sizes, headNamedByLiteral: last.named, headExecutedAssertion: last.executed,
  b4ffe164: rows.find((r) => r.c === "b4ffe164"),
}, null, 1));
