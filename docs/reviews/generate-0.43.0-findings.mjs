import fs from "node:fs";
const st = JSON.parse(fs.readFileSync(".conductor/state.json", "utf8"));
const linked = st.epics.filter(e => (e.links || []).some(l => l.epic === "comprehensive-code-review-after-0-43-0"));
const parent = st.epics.find(e => e.id === "comprehensive-code-review-after-0-43-0");
const rank = { P1: 0, P2: 1, P3: 2 };
const byPri = [...linked].filter(e => e.id !== "release-0-43-0-cut")
  .sort((a, b) => (rank[a.priority] - rank[b.priority]) || a.id.localeCompare(b.id));
const shipped = e => e.status === "archived";
const out = [];
out.push("# Comprehensive code review of pm 0.43.0 — findings\n");
out.push("_Generated from `.conductor/state.json`; each finding below is the epic the review registered, verbatim._\n");
out.push("## How it ran\n");
out.push(parent.disposition?.reason ? parent.disposition.reason + "\n" : "");
out.push("## Where the findings stand\n");
out.push("| Priority | Finding | Status | Shipped in / notes |");
out.push("|---|---|---|---|");
for (const e of byPri) {
  const r = (e.disposition?.reason || "").replace(/\s+/g, " ").trim();
  const where = shipped(e) ? (r.length > 150 ? r.slice(0, 150) + "\u2026" : r) : "open";
  out.push(`| ${e.priority} | \`${e.id}\` | ${shipped(e) ? "fixed" : "open"} | ${where.replace(/\|/g, "\\|")} |`);
}
out.push("\n---\n");
for (const group of ["P1", "P2", "P3"]) {
  const g = byPri.filter(e => e.priority === group);
  if (!g.length) continue;
  out.push(`## ${group} findings (${g.filter(shipped).length} fixed, ${g.filter(e => !shipped(e)).length} open)\n`);
  for (const e of g) {
    out.push(`### ${shipped(e) ? "✅" : "⬜"} \`${e.id}\`\n`);
    out.push(`**${(e.title || "").replace(/^\[.\]\s*/, "")}**\n`);
    out.push(`*${e.lane} lane · ${e.status}${e.disposition?.outcome ? ` · ${e.disposition.outcome}` : ""}*\n`);
    if (e.description) out.push(e.description.trim() + "\n");
    if (shipped(e) && e.disposition?.reason) out.push(`**Outcome:** ${e.disposition.reason.trim()}\n`);
    out.push("");
  }
}
fs.writeFileSync("docs/reviews/2026-09-14-code-review-0.43.0-findings.md", out.join("\n"));
console.log("wrote", out.length, "blocks;", byPri.length, "findings");
