// #158 — per-verb help, projected from the flag registry and from nothing else.
//
// `--help` was verb-blind: conductor.mjs short-circuited on any `--help` anywhere in argv and
// printed the global usage line, so the only way to learn a verb's flags was to read its module.
// A session upgrading another repo did exactly that, and said so.
//
// EVERY LINE BELOW IS DERIVED. The alternative — a per-verb help table — is the defect #152
// describes (a rule bound to a LIST rather than to the function that governs it) and would be
// stale the first time a flag was added. Because help reads the SAME rows the unknown-flag
// allowlists read, a row that grows the allowlist grows the help in the same edit, and help
// cannot advertise a flag the parser refuses.
//
// The one place that symmetry breaks is `add-many`, whose EPIC_FLAGS rows are batch-document
// state keys rather than CLI flags — hence `cliFlagsFor()` rather than `flagsFor()`. See
// BATCH_KEY_COMMANDS in constants.mjs.
import { flagSpecsFor, FLAGLESS_VERBS, POSITIONAL_USAGE, VERB_POSITIONALS, epicBatchKeys, BATCH_KEY_COMMANDS } from "./constants.mjs";
import { DOCS_INDEX_URL, DOCS_MCP_URL } from "./constants.mjs";

/** One flag's line: `--name <what it requires>`, then the modifiers a caller must know to invoke
 *  it correctly. `(no value)` and `(repeatable)` are the two that change the SHAPE of a correct
 *  invocation — a valueless flag given a value is refused, and a repeatable one given twice
 *  accumulates where a non-repeatable one silently overwrites. */
function flagLine(spec, width) {
  const sig = spec.valueless ? `--${spec.flag}` : `--${spec.flag} <${spec.requires}>`;
  const marks = [spec.valueless ? "no value" : null, spec.repeats ? "repeatable" : null]
    .filter(Boolean);
  return marks.length ? `  ${sig.padEnd(width)}  (${marks.join(", ")})` : `  ${sig}`;
}

/** Help for ONE verb. Returns a string; never writes, never exits — the caller owns both, which
 *  is what keeps a help flag side-effect-free (the property that fixed `log-detour --help`
 *  writing a real detour entry with "--help" as its description). */
export function verbHelp(command) {
  const specs = flagSpecsFor(command);
  // every-verb-refuses-what-it-does-not-read D9: help reads the SAME declarations the pre-dispatch
  // command-line check enforces — the positional form from VERB_POSITIONALS, and every flag
  // cliFlagsFor() accepts, the argv-level `--force` included. The first line names the form
  // wherever the verb reads positionals, so `remove-epic --help` no longer hides its `<id>`.
  const pos = VERB_POSITIONALS[command];
  const head = `conductor.mjs ${command}${pos && pos.max > 0 ? ` ${pos.form}` : ""}`;
  const own = specs.filter(s => !s.argvLevel);
  const argvLevel = specs.filter(s => s.argvLevel);
  const out = [];
  const flaglessBody = () => {
    if (!FLAGLESS_VERBS.includes(command)) { out.push("  No flags are declared for this verb in the registry."); return; }
    if (POSITIONAL_USAGE[command]) { out.push("  " + POSITIONAL_USAGE[command]); return; }
    // The form is already on the first line where the verb reads positionals.
    out.push(pos && pos.max > 0
      ? "  See the command doc for what the positional arguments mean."
      : "  It takes no positional arguments either.");
  };
  const flagLines = (list) => {
    // Capped. A couple of `requires` phrases are full sentences (`--link`'s names its own
    // remedy), and padding every other line out to match one of those wrecks the column the
    // padding exists to create. A long signature simply carries its marks unaligned.
    const width = Math.min(44, Math.max(...list.map(s =>
      (s.valueless ? `--${s.flag}` : `--${s.flag} <${s.requires}>`).length)));
    for (const s of list) out.push(flagLine(s, width));
  };

  if (specs.length === 0) {
    // EXPLICIT, never an empty list. A verb that takes no flags says so, and "takes no flags" is
    // said ONLY here — where cliFlagsFor() is empty — so help can never claim a verb refuses a flag
    // it accepts. Printing nothing would make "takes none" and "nobody declared this yet" look alike.
    out.push(`${head} — takes no flags.`);
    flaglessBody();
  } else if (own.length === 0) {
    // A verb whose PARSER reads no flags (FLAGLESS_VERBS keeps meaning exactly that) but which
    // accepts the argv-level `--force` because it mutates: say both, in that order.
    out.push(`${head} — no flags of its own.`);
    flaglessBody();
  } else {
    out.push(`${head} — ${own.length} flag${own.length === 1 ? "" : "s"}.`);
    out.push("");
    flagLines(own);
  }
  if (argvLevel.length) {
    out.push("");
    out.push("  Accepted on every mutating verb (it belongs to the state write, not to this verb):");
    flagLines(argvLevel);
  }

  // AND the POSITIONAL surface, for a verb that has BOTH flags and positionals. This branch is
  // the gh#178 half: the map was read only where `specs.length === 0`, so `release`'s read form —
  // the whole point of that change — was absent from the one surface a reader consults. Same map,
  // same wording, both branches; a verb absent from it renders exactly as before.
  if (own.length && POSITIONAL_USAGE[command]) {
    out.push("");
    out.push("  " + POSITIONAL_USAGE[command]);
  }

  // The batch surface is a real part of what `add-many` accepts — just not on the command line.
  // Naming it here is what stops a reader concluding the verb is impoverished and going back to
  // the source, which is the exact failure #158 reports.
  if (BATCH_KEY_COMMANDS.includes(command)) {
    out.push("");
    out.push(`  Each entry in the --from document may carry: ${epicBatchKeys().join(", ")}.`);
    out.push("  Those are STATE keys inside the JSON, not command-line flags: a batch entry");
    out.push("  carries `externalId`, written the way state.json writes it.");
  }

  out.push("");
  out.push(`  Docs: ${DOCS_INDEX_URL}`);
  return out.join("\n") + "\n";
}
