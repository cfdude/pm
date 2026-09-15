// scripts/test/managed-rules-block.test.mjs
//
// state-file-refuses-to-guess, capability `managed-rules-block`: how the engine locates, replaces
// and refuses to replace its managed block inside a HUMAN-OWNED rules file. On 0.43.0 the markers
// were matched as substrings and the block spliced in with a string replacement, so `write-rules`
// deleted a hand-written section above a prose mention of the BEGIN marker and printed `refreshed`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, fixturePluginRoot } from "./helpers.mjs";

const UNREADABLE = 11;
const BEGIN = "<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->";
const END = "<!-- END pm-conductor rules -->";

function sh(args, { cwd, env = {} } = {}) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const claude = (cwd) => path.join(cwd, "CLAUDE.md");
const bytes = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
const sameBytes = (a, b) => (a === null ? b === null : b !== null && Buffer.compare(a, b) === 0);
const beginLines = (text) => text.split("\n").filter((l) => l.replace(/\r$/, "").startsWith("<!-- BEGIN pm-conductor rules") && l.replace(/\r$/, "").endsWith("-->"));

/** An initialized repository, and the managed block init wrote, as text. */
function initRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const text = fs.readFileSync(claude(cwd), "utf8");
  const block = text.slice(text.indexOf(BEGIN), text.indexOf(END) + END.length + 1);
  return { cwd, block };
}

// ─────────────── 6.1 ───────────────

test("6.1: prose mentioning the BEGIN marker does not cost hand-written content", () => {
  const { cwd, block } = initRepo();
  const prefix = "Our rules file uses the `<!-- BEGIN pm-conductor rules` marker for pm's block.\n\n" +
    "## My rules\n\nMY-HAND-SENTINEL — never delete this line.\n\n";
  fs.writeFileSync(claude(cwd), prefix + block);
  const r = sh(["write-rules"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const after = fs.readFileSync(claude(cwd), "utf8");
  assert.equal(after.slice(0, prefix.length), prefix, "every byte before the BEGIN marker line is identical");
  assert.equal(beginLines(after).length, 1, "exactly one BEGIN marker line");
});

test("6.1: a BEGIN marker without an END is refused, naming the file and the line", () => {
  const { cwd } = initRepo();
  fs.writeFileSync(claude(cwd), `# CLAUDE.md\n\n${BEGIN}\nold managed body\n\n## Hand-written\n\nmine\n`);
  const before = bytes(claude(cwd));
  const r = sh(["write-rules"], { cwd });
  assert.equal(r.status, UNREADABLE, `stderr: ${r.stderr}`);
  assert.ok(sameBytes(before, bytes(claude(cwd))), "CLAUDE.md byte-identical");
  assert.match(r.stderr, /CLAUDE\.md/);
  assert.match(r.stderr, /line 3: BEGIN/);
  assert.doesNotMatch(r.stderr, /refreshed|appended|created/);
});

test("6.1: two managed blocks are refused, naming all four marker lines", () => {
  const { cwd, block } = initRepo();
  const text = `# CLAUDE.md\n\n${block}\n## Between\n\nhand text\n\n${block}`;
  fs.writeFileSync(claude(cwd), text);
  const lines = text.split("\n");
  const markerLines = lines.map((l, i) => (l === BEGIN || l === END ? i + 1 : 0)).filter(Boolean);
  assert.equal(markerLines.length, 4, "precondition: four marker lines");
  const before = bytes(claude(cwd));
  const r = sh(["set-review-mode", "--mode", "thorough"], { cwd });
  assert.equal(r.status, UNREADABLE, `stderr: ${r.stderr}`);
  assert.ok(sameBytes(before, bytes(claude(cwd))), "CLAUDE.md byte-identical");
  for (const n of markerLines) assert.match(r.stderr, new RegExp(`line ${n}: (BEGIN|END)`), `names line ${n}: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /refreshed/);
  assert.match(r.stderr, /write-rules/, "names the completion: write-rules then render");
});

test("6.1 REGRESSION GUARD: a single well-formed block between hand text is refreshed in place", () => {
  const { cwd } = initRepo();
  const head = "# CLAUDE.md\n\nHEAD-SENTINEL\n\n";
  const tail = "\n## After\n\nTAIL-SENTINEL\n";
  fs.writeFileSync(claude(cwd), `${head}${BEGIN}\nSTALE BODY\n${END}\n${tail}`);
  const r = sh(["write-rules"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const after = fs.readFileSync(claude(cwd), "utf8");
  assert.ok(after.startsWith(head), "bytes before the BEGIN marker line unchanged");
  assert.ok(after.endsWith(tail), "bytes after the END marker line unchanged");
  assert.doesNotMatch(after, /STALE BODY/, "the block carries the new content");
  assert.match(after, /PM Conductor/);
});

test("6.1 REGRESSION GUARD: a file with no markers gets exactly one block appended", () => {
  const { cwd } = initRepo();
  const original = "# CLAUDE.md\n\nOnly hand-written content here.\n";
  fs.writeFileSync(claude(cwd), original);
  const r = sh(["write-rules"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const after = fs.readFileSync(claude(cwd), "utf8");
  assert.ok(after.startsWith(original.trimEnd()), "the original content is a prefix");
  assert.equal(beginLines(after).length, 1);
});

test("6.1: a CRLF rules file stays CRLF", () => {
  const { cwd } = initRepo();
  const crlf = fs.readFileSync(claude(cwd), "utf8").split("\n").join("\r\n");
  fs.writeFileSync(claude(cwd), "Hand line one\r\n\r\n" + crlf.replace(/^# CLAUDE\.md\r\n\r\n/, ""));
  const r = sh(["write-rules"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const segments = fs.readFileSync(claude(cwd), "utf8").split("\n");
  const last = segments.pop();
  assert.equal(last, "", "the file ends with a line terminator");
  const lf = segments.filter((s) => !s.endsWith("\r"));
  assert.equal(lf.length, 0, `every line ends CRLF; ${lf.length} of ${segments.length} do not`);
});

test("6.1: a CRLF rules file with no markers gets a CRLF block appended", () => {
  const { cwd } = initRepo();
  fs.writeFileSync(claude(cwd), "# CLAUDE.md\r\n\r\nHand-written only.\r\n");
  const r = sh(["write-rules"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const after = fs.readFileSync(claude(cwd), "utf8");
  assert.ok(after.startsWith("# CLAUDE.md\r\n\r\nHand-written only.\r\n"), "the original content is a prefix");
  const segments = after.split("\n");
  assert.equal(segments.pop(), "", "the file ends with a line terminator");
  assert.equal(segments.filter((s) => !s.endsWith("\r")).length, 0, "every line ends CRLF");
  assert.equal(beginLines(after).length, 1);
});

// ─────────────── 6.3 ───────────────

test("6.3: an upgrade over a malformed block writes nothing — pmVersion included", () => {
  const { cwd } = initRepo();
  const sp = path.join(cwd, ".conductor", "state.json");
  const s = JSON.parse(fs.readFileSync(sp, "utf8"));
  s.pmVersion = "0.1.0";
  fs.writeFileSync(sp, JSON.stringify(s, null, 2) + "\n");
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(claude(cwd), `# CLAUDE.md\n\n${BEGIN}\nbody with no end\n\nhand text\n`);
  const watched = [sp, path.join(cwd, "PROJECT.md"), path.join(cwd, ".gitignore"), claude(cwd)];
  const before = watched.map(bytes);
  const r = sh(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: fixturePluginRoot("0.3.0") } });
  assert.equal(r.status, UNREADABLE, `stderr: ${r.stderr}`);
  watched.forEach((p, i) => assert.ok(sameBytes(before[i], bytes(p)), `${path.basename(p)} changed`));
  assert.match(r.stderr, /line 3: BEGIN/);
});

test("6.3: init over a malformed block creates no .conductor/", () => {
  const cwd = tmpRepo();
  fs.writeFileSync(claude(cwd), `# CLAUDE.md\n\n${BEGIN}\nbody with no end\n\nhand text\n`);
  const before = bytes(claude(cwd));
  const r = sh(["init"], { cwd });
  assert.equal(r.status, UNREADABLE, `stderr: ${r.stderr}`);
  assert.ok(!fs.existsSync(path.join(cwd, ".conductor")), "no .conductor/ directory created");
  assert.ok(sameBytes(before, bytes(claude(cwd))));
  assert.ok(!fs.existsSync(path.join(cwd, ".gitignore")), "no .gitignore written");
});

// ─────────────── 6.5 ───────────────

test("6.5: substitution patterns in the block are written verbatim", () => {
  const { cwd } = initRepo();
  const text = fs.readFileSync(claude(cwd), "utf8");
  fs.writeFileSync(claude(cwd), "PREFIX-SENTINEL\n\n" + text);
  const repo = "o/n$`x$&y$'z";
  const r = sh(["set-tracker", "--system", "github-issues", "--repo", repo], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const after = fs.readFileSync(claude(cwd), "utf8");
  assert.equal(after.split("PREFIX-SENTINEL").length - 1, 1, "PREFIX-SENTINEL occurs exactly once");
  assert.ok(after.includes(repo), "the repo value, with each of $` $& $', is present verbatim");
});
