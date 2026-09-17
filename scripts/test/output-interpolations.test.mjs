// The per-interpolation output sweep, run by the suite (user-text-never-forges-output, Gate 2 U2-I1).
// The method is in output-interpolations.mjs and the declared judgments in
// output-interpolations.judged.mjs. Before this test existed the sweep lived in the change directory,
// guarded nothing after the commit that ran it, and resolved its repository from a path that the
// change's own archive would have broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO, sweepInterpolations, sweptFiles } from "./output-interpolations.mjs";
import { JUDGED } from "./output-interpolations.judged.mjs";

const source = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
/** Sweep with ONE file's text replaced by `mutate(text)`; the replacement must apply exactly once. */
function sweepMutated(rel, from, to) {
  const text = source(rel);
  assert.equal(text.split(from).length - 1, 1, `mutation anchor occurs exactly once in ${rel}: ${from}`);
  return sweepInterpolations({ read: (r) => (r === rel ? text.replace(from, () => to) : source(r)) });
}

test("the sweep resolves the repository from scripts/test and reaches the engine's files", () => {
  const files = sweptFiles();
  assert.ok(files.includes("scripts/conductor.mjs") && files.includes("scripts/lib/claims.mjs"));
  for (const rel of files) assert.ok(fs.existsSync(path.join(REPO, rel)), rel);
});

test("every interpolation into engine output is escaped, literal, sunk or judged — no UNCLASSIFIED, STALE, EXCESS or WIDE", () => {
  const { rows, findings } = sweepInterpolations();
  assert.ok(rows.length > 1000, `the sweep saw ${rows.length} interpolations`);
  assert.deepEqual(findings, [], "escape each UNCLASSIFIED value, or judge it with its reason in scripts/test/output-interpolations.judged.mjs; " +
    "fix or remove each STALE / EXCESS / WIDE judgment there (run `node scripts/test/output-interpolations.mjs` to list them)");
});

test("mutant (Gate 2 U2-I1): a raw stored session in claim()'s takeover line is UNCLASSIFIED", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs",
    "from session '${escapeControls(held.session)}' ", "from session '${held.session}' ");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/claims\.mjs:\d+ \[claim\] \$\{\} held\.session$/.test(f)), findings.join("\n"));
});

test("mutant (Gate 2 U2-I1): a raw title added to supersedeAmended()'s withdrawal command is UNCLASSIFIED", () => {
  const { findings } = sweepMutated("scripts/lib/subcommands.mjs",
    "`update-epic ${printedId(epic.id)} --withdraw-commit", "`update-epic ${printedId(epic.id)} ${epic.title} --withdraw-commit");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/subcommands\.mjs:\d+ \[supersedeAmended\] \$\{\} epic\.title$/.test(f)), findings.join("\n"));
});

test("a second copy of a judged expression is EXCESS, and a judged expression that is gone is STALE", () => {
  const excess = sweepMutated("scripts/lib/claims.mjs", "claimExpiry(epic.claim)}", "claimExpiry(epic.claim)} ${claimExpiry(epic.claim)}");
  assert.ok(excess.findings.some(f => /^EXCESS scripts\/lib\/claims\.mjs \[claim\] "claimExpiry\(epic\.claim\)"/.test(f)), excess.findings.join("\n"));
  const stale = sweepMutated("scripts/lib/claims.mjs", "until ${claimExpiry(epic.claim)}", "until later");
  assert.ok(stale.findings.some(f => /^STALE scripts\/lib\/claims\.mjs \[claim\] "claimExpiry\(epic\.claim\)"/.test(f)), stale.findings.join("\n"));
});

test("only a sink-flow or json judgment may cover a whole declaration", () => {
  const wide = { file: "scripts/lib/claims.mjs", fn: "claim", re: /.*/, class: "engine", why: "a whole function" };
  const { findings } = sweepInterpolations({ judged: [...JUDGED, wide] });
  assert.ok(findings.some(f => /^WIDE scripts\/lib\/claims\.mjs \[claim\] \/\.\*\/: a engine judgment/.test(f)), findings.join("\n"));
  for (const jd of JUDGED) {
    if (jd.exact === undefined) assert.ok(["sink-flow", "json"].includes(jd.class), `${jd.file} [${jd.fn}] is function-wide as ${jd.class}`);
    assert.ok(typeof jd.why === "string" && jd.why.trim(), `${jd.file} [${jd.fn}] carries a reason`);
  }
});

// ── Gate 2 V-I2: six raw values the classifier accepted in place of claim()'s escaped session ──
// asCode/orNoRemedy were escapers whatever they wrapped, splitTop split `a || b && "y"` at the `&&`, and the
// `.length` / `+ 1` patterns accepted any left operand. Each of these printed held.session raw with 0 findings.
const SESSION = "from session '${escapeControls(held.session)}' ";
const V_I2_MUTANTS = [
  "held.session || held.x && \"y\"",
  "held.session ?? held.x && \"y\"",
  "held.session + 1",
  "held.session + held.x.length",
];
for (const expr of V_I2_MUTANTS) {
  test(`mutant (Gate 2 V-I2): \`${expr}\` in claim()'s takeover line is UNCLASSIFIED`, () => {
    const { findings } = sweepMutated("scripts/lib/claims.mjs", SESSION, `from session '\${${expr}}' `);
    assert.ok(findings.some(f => f.startsWith("UNCLASSIFIED scripts/lib/claims.mjs:") && f.endsWith(`[claim] \${} ${expr}`)), findings.join("\n"));
  });
}

// The two WRAPPER mutants run in subcommands.mjs, which really imports asCode and orNoRemedy from constants.mjs
// (Gate 2 W-I3). In claims.mjs, which imports neither, `asCode(held.session)` was UNCLASSIFIED on import trust
// alone, so putting the wrappers back among the escapers failed no V-I2 test.
const WRAPPED_SITE = "`update-epic ${printedId(epic.id)} --withdraw-commit";
for (const expr of ["asCode(epic.title)", "orNoRemedy(() => epic.title)"]) {
  test(`mutant (Gate 2 V-I2, W-I3): \`${expr}\` in supersedeAmended()'s withdrawal command — a file importing both wrappers — is UNCLASSIFIED`, () => {
    const text = source("scripts/lib/subcommands.mjs");
    assert.match(text, /^import \{[^}]*\basCode\b[^}]*\borNoRemedy\b[^}]*\} from "\.\/constants\.mjs";$/m, "the mutated file really imports both wrappers");
    const { findings } = sweepMutated("scripts/lib/subcommands.mjs", WRAPPED_SITE, `\`update-epic \${${expr}} --withdraw-commit`);
    assert.ok(findings.some(f => f.startsWith("UNCLASSIFIED scripts/lib/subcommands.mjs:") && f.endsWith(`[supersedeAmended] \${} ${expr}`)), findings.join("\n"));
  });
}

test("mutant (Gate 2 V-I2): a local named esc is trusted only while it is escapeControls — `.map(esc)` over an identity esc is UNCLASSIFIED", () => {
  const { findings } = sweepMutated("scripts/lib/archive-gate.mjs",
    "const esc = (v) => escapeControls(String(v));", "const esc = (v) => String(v);");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/archive-gate\.mjs:\d+ \[DELIVERED_OBLIGATIONS\] \$\{\} staleness\.uncovered\.map\(esc\)\.join\(", "\)$/.test(f)), findings.join("\n"));
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/archive-gate\.mjs:\d+ \[DELIVERED_OBLIGATIONS\] \$\{\} esc\(staleness\.headSha\)$/.test(f)), findings.join("\n"));
});

test("mutant (Gate 2 V-I2): an escaper name is trusted only as the real import — a local escapeControls shadowing it is not", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs",
    "REPO_CLAIM_DEFAULT_TTL_MINUTES, escapeControls, isFlagToken, splitFlagToken } from \"./constants.mjs\";",
    "REPO_CLAIM_DEFAULT_TTL_MINUTES, isFlagToken, splitFlagToken } from \"./constants.mjs\";\nconst escapeControls = (s) => s;");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/claims\.mjs:\d+ \[claim\] \$\{\} escapeControls\(held\.session\)$/.test(f)), findings.join("\n"));
});

// ── Gate 2 V-M3: a judged expression reformatted across lines is still the judged expression ──
test("a judged expression split across lines with a trailing comma still matches its judgment (Gate 2 V-M3)", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs",
    "jsonText({ quiescent: rows.length === 0, claims: rows }, null, 2)",
    "jsonText({\n      quiescent: rows.length === 0,\n      claims: rows,\n    }, null, 2)");
  assert.deepEqual(findings, []);
  const judged = sweepMutated("scripts/lib/update-epic.mjs", "${asCode(l)}", "${asCode(\n        l,\n      )}");
  assert.deepEqual(judged.findings, []);
});

test("a STALE or EXCESS finding names the judgments file it is declared in (Gate 2 V-M3)", () => {
  const stale = sweepMutated("scripts/lib/claims.mjs", "until ${claimExpiry(epic.claim)}", "until later");
  assert.ok(stale.findings.some(f => f.startsWith("STALE ") && f.includes("output-interpolations.judged.mjs")), stale.findings.join("\n"));
});

// ── Gate 2 W-I2: an ALL_CAPS name was literal by its spelling alone ──
const CLAIMS_IMPORT = "REPO_CLAIM_DEFAULT_TTL_MINUTES, escapeControls, isFlagToken, splitFlagToken } from \"./constants.mjs\";";
/** Sweep claims.mjs with a top-level declaration added after its constants import and claim()'s session
 *  interpolation replaced by `expr`. */
function sweepClaimWith(decl, expr, extra = []) {
  const text = source("scripts/lib/claims.mjs");
  let t = text;
  for (const [from, to] of [[CLAIMS_IMPORT, `${CLAIMS_IMPORT}\n${decl}`], [SESSION, `from session '\${${expr}}' `], ...extra]) {
    assert.equal(t.split(from).length - 1, 1, `mutation anchor occurs exactly once: ${from}`);
    t = t.replace(from, () => to);
  }
  return sweepInterpolations({ read: (r) => (r === "scripts/lib/claims.mjs" ? t : source(r)) });
}
const unclassifiedInClaim = (findings, expr) =>
  findings.some(f => f.startsWith("UNCLASSIFIED scripts/lib/claims.mjs:") && f.endsWith(`[claim] \${} ${expr}`));

test("mutant (Gate 2 W-I2): an ALL_CAPS name bound to a stored value is UNCLASSIFIED, and so is its .join()", () => {
  const a = sweepClaimWith("const HELD_SESSION = globalThis.held.session;", "HELD_SESSION");
  assert.ok(unclassifiedInClaim(a.findings, "HELD_SESSION"), a.findings.join("\n"));
  const b = sweepClaimWith("const SESSIONS = globalThis.held.sessions;", "SESSIONS.join(\" \")");
  assert.ok(unclassifiedInClaim(b.findings, "SESSIONS.join(\" \")"), b.findings.join("\n"));
});

test("mutant (Gate 2 W-I2): an ALL_CAPS literal is still literal, unless it is reassigned or also bound as a parameter", () => {
  const literal = sweepClaimWith("const HELD_SESSION = [\"a\", \"b\"];", "HELD_SESSION.join(\" \")");
  assert.deepEqual(literal.findings, [], "a literal array's join is literal");
  const reassigned = sweepClaimWith("let HELD_SESSION = \"a\";", "HELD_SESSION",
    [["  const session = resolveSession(f);\n  if (!session) die(`claim requires", "  const session = resolveSession(f);\n  HELD_SESSION = session;\n  if (!session) die(`claim requires"]]);
  assert.ok(unclassifiedInClaim(reassigned.findings, "HELD_SESSION"), reassigned.findings.join("\n"));
  const param = sweepClaimWith("const HELD_SESSION = \"a\";\nconst f2 = (HELD_SESSION) => HELD_SESSION;", "HELD_SESSION");
  assert.ok(unclassifiedInClaim(param.findings, "HELD_SESSION"), param.findings.join("\n"));
});

test("mutant (Gate 2 W-I2): render's PROJECT_MD — a path under CLAUDE_PROJECT_DIR — printed raw is UNCLASSIFIED, though render() is judged sink-flow as a whole", () => {
  const { findings } = sweepMutated("scripts/lib/render.mjs", "${escapeControls(PROJECT_MD)}", "${PROJECT_MD}");
  assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/render\.mjs:\d+ \[render\] \$\{\} PROJECT_MD$/.test(f)), findings.join("\n"));
});

test("every LITERAL_ALLOWLIST entry names a declaration that exists with exactly that text, and carries a reason (Gate 2 W-I2)", async () => {
  const { LITERAL_ALLOWLIST, literalConstant } = await import("./output-interpolations.mjs");
  assert.ok(Object.keys(LITERAL_ALLOWLIST).length > 0);
  for (const [key, { decl, why }] of Object.entries(LITERAL_ALLOWLIST)) {
    const [rel, name] = key.split(":");
    assert.ok(typeof why === "string" && why.trim(), `${key} carries a reason`);
    assert.ok(source(rel).includes(`const ${name} = ${decl}`), `${key}: declared as ${decl}`);
    assert.equal(literalConstant(rel, name, source), true, `${key} resolves`);
  }
});

// ── Gate 2 W-M2: escaper-trust bypasses and false positives of the lexical sweep ──
test("mutant (Gate 2 W-M2): a MEMBER call named like an escaper — fake.escapeControls(`…`) — escapes nothing", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs", SESSION, "from session '${fake.escapeControls(`${held.session}`)}' ");
  assert.ok(unclassifiedInClaim(findings, "held.session"), findings.join("\n"));
});

test("mutant (Gate 2 W-M2): fs.writeSync to a file descriptor is output, not a filesystem call", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs", "  const session = resolveSession(f);\n  if (!session) die(`claim requires",
    "  const session = resolveSession(f);\n  fs.writeSync(2, `taken from ${held.session}\\n`);\n  if (!session) die(`claim requires");
  assert.ok(unclassifiedInClaim(findings, "held.session"), findings.join("\n"));
});

test("mutant (Gate 2 W-M2): a push is a sink only when X.map(escapeControls) is joined or returned — not in a comment, a string or a dropped expression", () => {
  const sinkless = (joinLine) => `\nfunction sinkless(held) {\n  const L = [];\n  L.push(\`taken from \${held.session}\`);\n  ${joinLine}\n  process.stdout.write(L.join("\\n"));\n}`;
  for (const line of ["// L.map(escapeControls).join(\"\\n\")", "const note = \"L.map(escapeControls).join()\";", "L.map(escapeControls);"]) {
    const { findings } = sweepMutated("scripts/lib/claims.mjs", CLAIMS_IMPORT, CLAIMS_IMPORT + sinkless(line));
    assert.ok(findings.some(f => /^UNCLASSIFIED scripts\/lib\/claims\.mjs:\d+ \[sinkless\] \$\{\} held\.session$/.test(f)), `${line}\n${findings.join("\n")}`);
  }
  const joined = sweepMutated("scripts/lib/claims.mjs", CLAIMS_IMPORT, CLAIMS_IMPORT +
    `\nfunction sinkless(held) {\n  const L = [];\n  L.push(\`taken from \${held.session}\`);\n  process.stdout.write(L.map(escapeControls).join("\\n"));\n}`);
  assert.deepEqual(joined.findings, [], "the real sink shape still classifies");
});

test("a string holding \"const escapeControls =\" does not un-trust the real import (Gate 2 W-M2 false positive)", () => {
  const { findings } = sweepMutated("scripts/lib/claims.mjs", CLAIMS_IMPORT, `${CLAIMS_IMPORT}\nconst NOTE_TEXT = "const escapeControls = (s) => s";`);
  assert.deepEqual(findings, []);
});

test("normaliseExpr never collapses whitespace inside a string or template literal (Gate 2 W-M2)", async () => {
  const { normaliseExpr } = await import("./output-interpolations.mjs");
  assert.equal(normaliseExpr("f(\"a  b\",\n    `c   ${d}`)"), "f(\"a  b\", `c   ${d}`)");
  assert.notEqual(normaliseExpr("f(\"a  b\")"), normaliseExpr("f(\"a b\")"));
});
