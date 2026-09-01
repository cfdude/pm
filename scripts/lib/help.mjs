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
import { cliFlagsFor, flagSpecsFor, FLAGLESS_VERBS, epicBatchKeys, BATCH_KEY_COMMANDS } from "./constants.mjs";
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
  const out = [];

  if (specs.length === 0) {
    // EXPLICIT, never an empty list. 21 of 48 verbs legitimately take no flags, and they are
    // declared in FLAGLESS_VERBS precisely so that "takes none" and "nobody declared this yet"
    // cannot look the same. Printing nothing here would re-introduce exactly that ambiguity at
    // the surface a reader actually looks at.
    const declared = FLAGLESS_VERBS.includes(command);
    out.push(`conductor.mjs ${command} — takes no flags.`);
    out.push(declared
      ? "  Positional arguments only, or none. See the command doc for what it expects."
      : "  No flags are declared for this verb in the registry.");
  } else {
    out.push(`conductor.mjs ${command} — ${specs.length} flag${specs.length === 1 ? "" : "s"}.`);
    out.push("");
    // Capped. A couple of `requires` phrases are full sentences (`--link`'s names its own
    // remedy), and padding every other line out to match one of those wrecks the column the
    // padding exists to create. A long signature simply carries its marks unaligned.
    const width = Math.min(44, Math.max(...specs.map(s =>
      (s.valueless ? `--${s.flag}` : `--${s.flag} <${s.requires}>`).length)));
    for (const s of specs) out.push(flagLine(s, width));
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

/** Is `command` something we can render help for? The caller asks BEFORE deciding between verb
 *  help and the global usage line, so an unknown word still gets the global answer. */
export const hasVerbHelp = (command, dispatchable) => dispatchable.includes(command);

/** Every verb's flags, one block each. Not wired to a flag today; exported because the sweep in
 *  conductor-35 renders all 48 and a single entry point keeps that honest. */
export const allVerbHelp = (verbs) => verbs.map(v => verbHelp(v)).join("\n");

export { cliFlagsFor };
