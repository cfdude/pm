// scripts/measure/overhead-survey.mjs
// pm-overhead-calibration-and-feature-switches B2 -- the WALK and CLI of the transcript survey.
// DEV TOOLING (outside scripts/lib/): READ-ONLY over ~/.claude/projects, zero model tokens.
//
//   node scripts/measure/overhead-survey.mjs [--root <dir>] [--out <file>] [--rows-out <file under .raw/>]
//
// PRIVACY. Only token counts, the model id, the project directory name and one boolean leave a
// transcript (overhead-survey-core.mjs). The committed aggregate holds no project name and no session id;
// the per-session rows (which DO name the project directory) go to a gitignored `.raw/` folder, and the
// walk refuses to write them anywhere else. Highway and employer-hosted project directories are never
// opened, not even listed.
//
// MEMORY. The corpus is GBs and single lines can be 100MB+. Each file is streamed in chunks, lines over
// `maxLineChars` are dropped without being held, and the stream is destroyed the moment the first
// assistant message is folded. The CLI also arms a watchdog that hard-exits past 4 GB RSS.
//
// IT READS `<root>/<project>/<session>.jsonl` only. `<session>/subagents/` is not read.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transcriptRoot } from "../lib/spend-reader.mjs";
import { aggregate, createScanner, exclusionReason } from "./overhead-survey-core.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_MAX_LINE_CHARS = 16 * 1024 * 1024;
const RSS_CAP_BYTES = 4 * 1024 ** 3;
const OVERSIZE = Symbol("oversize");

export const defaultPaths = () => ({
  out: path.join(REPO, "docs", "measurement", "2026-10-overhead-survey.json"),
  rowsOut: path.join(REPO, "docs", "measurement", ".raw", "overhead-survey-rows.json"),
});

export function parseSurveyArgs(argv) {
  const d = defaultPaths();
  const o = { root: null, out: d.out, rowsOut: d.rowsOut };
  const flags = { "--root": "root", "--out": "out", "--rows-out": "rowsOut" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = flags[argv[i]];
    if (!key) return { error: `unknown argument ${argv[i]}` };
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) return { error: `${argv[i]} needs a value` };
    o[key] = path.resolve(argv[i + 1]);
    i += 1;
  }
  return o;
}

/** Lines of a stream, never holding one longer than `cap` characters: such a line is yielded as OVERSIZE. */
async function* linesOf(stream, cap) {
  stream.setEncoding("utf8");
  let buf = "";
  let over = false;
  for await (const chunk of stream) {
    let from = 0;
    for (;;) {
      const nl = chunk.indexOf("\n", from);
      const end = nl === -1 ? chunk.length : nl;
      if (!over) {
        if (buf.length + (end - from) > cap) { over = true; buf = ""; } else buf += chunk.slice(from, end);
      }
      if (nl === -1) break;
      yield over ? OVERSIZE : buf;
      buf = "";
      over = false;
      from = nl + 1;
    }
  }
  if (over) yield OVERSIZE; else if (buf) yield buf;
}

/** The first message of one transcript file, closing the file as soon as it is folded. */
async function firstMessageOfFile(file, cap) {
  const stream = fs.createReadStream(file);
  const scanner = createScanner();
  try {
    for await (const l of linesOf(stream, cap)) {
      if (l === OVERSIZE) { scanner.pushOversize(); continue; }
      if (scanner.push(l)) break;
    }
  } finally { stream.destroy(); }
  return scanner.result();
}

const insideRaw = (file) => path.basename(path.dirname(path.resolve(file))) === ".raw";

export async function runSurvey({ root, out, rowsOut, maxLineChars = DEFAULT_MAX_LINE_CHARS, env = process.env } = {}) {
  const d = defaultPaths();
  const outFile = out || d.out;
  const rowsFile = rowsOut || d.rowsOut;
  if (!insideRaw(rowsFile)) throw new Error(`the per-session rows file must sit inside a .raw/ directory: ${rowsFile}`);
  const base = root || transcriptRoot(env, os.homedir());
  let dirents;
  try { dirents = fs.readdirSync(base, { withFileTypes: true }); } catch {
    throw new Error(`no transcript root at ${base}`);
  }
  const stats = { projectsListed: 0, projectsRead: 0, filesRead: 0 };
  const excludedProjects = {};
  const skipped = {};
  const rows = [];
  for (const ent of dirents.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    stats.projectsListed += 1;
    const why = exclusionReason(ent.name);
    if (why) { excludedProjects[why] = (excludedProjects[why] || 0) + 1; continue; }
    stats.projectsRead += 1;
    const files = fs.readdirSync(path.join(base, ent.name), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => e.name).sort();
    for (const f of files) {
      stats.filesRead += 1;
      const r = await firstMessageOfFile(path.join(base, ent.name, f), maxLineChars);
      if (r.skip) { skipped[r.skip] = (skipped[r.skip] || 0) + 1; continue; }
      rows.push({
        project: ent.name, model: r.model, input: r.input, cacheCreation: r.cacheCreation, cacheRead: r.cacheRead,
        briefPresent: r.briefPresent, start: r.start, entrypoint: r.entrypoint,
      });
    }
  }
  const agg = aggregate(rows, { skipped, excludedProjects, projectsRead: stats.projectsRead });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.mkdirSync(path.dirname(rowsFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(agg, null, 2)}\n`);
  fs.writeFileSync(rowsFile, `${JSON.stringify(rows, null, 2)}\n`);
  return { aggregate: agg, stats };
}

function startRssWatchdog(capBytes) {
  const t = setInterval(() => {
    if (process.memoryUsage.rss() > capBytes) {
      process.stderr.write("overhead-survey: RSS passed the 4 GB cap; exiting\n");
      process.exit(3);
    }
  }, 250);
  t.unref();
  return t;
}

async function main() {
  const args = parseSurveyArgs(process.argv.slice(2));
  if (args.error) { process.stderr.write(`overhead-survey: ${args.error}\n`); process.exit(2); }
  startRssWatchdog(RSS_CAP_BYTES);
  try {
    const { aggregate: a, stats } = await runSurvey({ root: args.root, out: args.out, rowsOut: args.rowsOut });
    process.stdout.write(
      `overhead-survey: ${stats.projectsRead} projects read of ${stats.projectsListed} listed, ${stats.filesRead} files, ` +
      `${a.population.headlineSessions} headline sessions\n  aggregate: ${args.out}\n  rows (gitignored): ${args.rowsOut}\n`,
    );
  } catch (e) {
    process.stderr.write(`overhead-survey: ${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
