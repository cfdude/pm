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
const SPEC = /(?:from\s*|import\s*\(\s*|export\s+\*\s+from\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SCOPE = /^(scripts\/|\.githooks\/|hooks\/)/;

function treeInfo(sha) {
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
  const stack = [...fnl, "scripts/conductor.mjs"];
  while (stack.length) {
    const f = stack.pop();
    if (closure.has(f) || !idOf.has(f)) continue;
    closure.add(f);
    for (const m of src(f).matchAll(SPEC)) {
      const t = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (idOf.has(t) && !closure.has(t)) stack.push(t);
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
  const ROOTS = ["commands", "skills", "agents", ".claude-plugin"];
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
  return { engine, certified, closure, observed, named, widened, wide };
}

const commits = git(["rev-list", "--reverse", "--no-merges", `${base}..${head}`]).split("\n").filter(Boolean);
const rows = [];
for (const c of commits) {
  const changed = git(["diff-tree", "--no-commit-id", "-r", "--name-only", "--no-renames", `${c}^`, c]).split("\n").filter(Boolean);
  const t = treeInfo(c);
  const hit = (s) => changed.some((f) => s.has(f));
  rows.push({
    c: c.slice(0, 8),
    A_certified: hit(t.certified),
    sweeps_engine: hit(t.engine),
    B_closure: hit(t.closure),
    B_observed: hit(t.observed),
    B_widened: hit(t.widened),
    C_anyEngine: hit(t.engine),
    C_anyEngine_or_functionalFiles: hit(t.engine) || changed.some((f) => /^scripts\/test\/(functional|fixtures)\//.test(f)),
    funcFile: changed.some((f) => f.startsWith("scripts/test/functional/")),
    sizes: { widened: t.widened.size, wideOnly: t.wide.size, closure: t.closure.size, observed: t.observed.size, engine: t.engine.size, certified: t.certified.size },
    named: [...t.named],
  });
}
const n = rows.length;
const count = (k) => rows.filter((r) => r[k]).length;
const last = rows[n - 1];
console.log(JSON.stringify({
  range: `${base}..${head}`, nonMergeCommits: n,
  A_certified_today: count("A_certified"), sweeps_engineSource_today: count("sweeps_engine"),
  B_importClosure: count("B_closure"), B_closurePlusNamed: count("B_observed"), B_widenedShippedSurface: count("B_widened"),
  C_anyEngineModule: count("C_anyEngine"), C_plusFunctionalAndFixtureFiles: count("C_anyEngine_or_functionalFiles"),
  functionalFileChanged: count("funcFile"),
  engineCommitsMissedToday: rows.filter((r) => !r.A_certified && r.C_anyEngine).length,
  headSizes: last.sizes, headNamedByLiteral: last.named,
  b4ffe164: rows.find((r) => r.c === "b4ffe164"),
}, null, 1));
