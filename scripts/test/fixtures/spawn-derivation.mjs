// scripts/test/fixtures/spawn-derivation.mjs
// THE SPAWN-CALL DERIVATION, SHARED BY BOTH HALVES' GATEWAY GUARDS (G-I5, Gate 2).
//
// WHY IT MOVED OUT OF THE TWO GUARD TESTS. The functional guard and its assertion twin each carried
// their own copy of a regex, and the copy was the defect: both matched
// `(execFileSync|execSync)\(\s*"git` — two function names out of six, no aliased binding, and no
// path for a call whose program is an expression. Adding `spawnSync("git", ["rev-parse", "HEAD"])`
// to a library module left BOTH guards green (4/4 and 5/5), and `import { execFileSync as __x }`
// was green too. Two expressions that must agree and are maintained apart is the pattern this
// change exists to remove (`certification.mjs`'s header states it for the record), so the
// derivation is now one module and the guards are assertions over it.
//
// WHAT IT DERIVES, and why each part is needed:
//   * ALL SIX spawners — `spawn`, `spawnSync`, `exec`, `execFile`, `execFileSync`, `execSync`. The
//     old pattern knew two of them, and `spawnSync` is the one an engine reaches for when it wants a
//     status object rather than an exception. It is ALREADY in this repository:
//     `scripts/lib/self-hosting.mjs` spawns `process.execPath` with it.
//   * THE MODULE'S OWN BINDING NAMES, read from its import statements — `import { execFileSync as
//     __x }` means the call site to look for is `__x(`, and a derivation matched on the IMPORTED
//     name cannot see that. Namespace imports (`import * as cp`) and a destructured `require` are
//     resolved the same way.
//   * THE FIRST ARGUMENT, so a site is classified by what it actually runs rather than by which file
//     it sits in: a string literal beginning `git` is a git spawn; any other string literal or any
//     expression is something else, and the guards name those explicitly instead of filtering them
//     into invisibility.
//
// A METHOD CALL IS NOT A SPAWN: `pattern.exec(line)` is disqualified by requiring the name to be a
// BARE identifier (no `.`, word or `$` before it) — the same rule 5.2's guard uses, and for the same
// reason (three files in the assertion half call `RegExp.prototype.exec`, and a check that fired on
// them would be weakened the first day).

/** Every child-process entry point that starts a process. */
export const SPAWN_FUNCTIONS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec"];

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The local names a source binds for child-process spawners. Returns `{ bare: Set, namespaced:
 *  Set }` — `bare` for names called directly, `namespaced` for a module object whose members are
 *  called as `ns.execFileSync(`. A source that never mentions `child_process` gets two empty sets,
 *  which is the correct answer rather than a special case: nothing there can be a spawn. */
export function spawnerNames(src) {
  const bare = new Set();
  const namespaced = new Set();
  const record = (orig, local) => {
    if (!SPAWN_FUNCTIONS.includes(orig)) return;
    bare.add(local ?? orig);
  };

  // `import { a, b as c } from "node:child_process"` and `import * as ns from …`
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      if (!bits[0]) continue;
      record(bits[0], bits[1]);
    }
  }
  for (const m of src.matchAll(/import\s*\*\s*as\s*([\w$]+)\s*from\s*["'](?:node:)?child_process["']/g)) {
    namespaced.add(m[1]);
  }
  // `const { execFileSync: x } = require("child_process")`
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(["'](?:node:)?child_process["']\)/g)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().split(/\s*:\s*/);
      if (bits[0]) record(bits[0], bits[1]);
    }
  }
  return { bare, namespaced };
}

/** Every spawn call site in a source, as `{ index, call, arg }` — `call` being the matched text and
 *  `arg` the first argument as written (a quoted literal stays quoted). ORDERED by position.
 *
 *  `bindings` is optional and exists for callers that derive over a FRAGMENT — one operation's body
 *  extracted from the gateway — where the import statement lives outside the slice. Pass the whole
 *  file's `spawnerNames(src)` and the fragment is read with the names that are actually in scope. */
export function spawnSites(src, bindings = spawnerNames(src)) {
  const { bare, namespaced } = bindings;
  const patterns = [];
  for (const name of bare) patterns.push(`(?<![.\\w$])${escaped(name)}\\s*\\(`);
  for (const ns of namespaced) {
    for (const name of SPAWN_FUNCTIONS) patterns.push(`${escaped(ns)}\\.${name}\\s*\\(`);
  }
  if (!patterns.length) return [];
  const re = new RegExp(patterns.join("|"), "g");
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    // The first argument: a quoted literal (either quote) verbatim, or the expression up to the
    // first `,` or `)` — `process.execPath`, a variable, anything the caller computed.
    const rest = src.slice(m.index + m[0].length);
    const lit = /^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/.exec(rest);
    let arg;
    if (lit) {
      arg = lit[0].trim();
    } else {
      const end = rest.search(/[,)]/);
      arg = (end === -1 ? rest : rest.slice(0, end)).trim();
    }
    out.push({ index: m.index, call: m[0], arg });
  }
  return out;
}

/** What a site runs: `"git"` when its first argument is a string literal beginning `git` (an argv
 *  program for `execFile*`/`spawn*`, the whole command for `exec*`), `"other"` otherwise. */
export const runsGit = (site) => /^["']git(?:["'\s]|$)/.test(site.arg);

/** The sites that run git — the shape the guards compare against. `bindings` is forwarded (see
 *  `spawnSites`) so a fragment can be read with its file's bindings. */
export function gitSpawns(src, bindings) {
  return spawnSites(src, bindings).filter(runsGit);
}

/** The sites that run ANYTHING ELSE, as `<first argument>` — the named omissions. A guard that
 *  filtered these out silently would let the exclusion grow one call at a time. */
export function otherSpawns(src, bindings) {
  return spawnSites(src, bindings).filter((s) => !runsGit(s)).map((s) => s.arg);
}
