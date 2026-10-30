* **The rules block's Intake section is 685 bytes smaller, and a test holds it under 900 tokens.** `rules:intake`
  sat at 4,021 bytes (~1,006 tokens), 6 over the 1,000-token line the feature-switch audit uses, so the audit
  left it as an open candidate for a switch. The two measured-evidence sentences moved out to the conductor
  skill's Intake section, where that evidence already lived, and the rest was tightened: now 3,336 bytes (~834
  tokens). Every command in the section is unchanged and still runs as written, apart from the added `--ask=` hint on the triage command. No switch is built, because
  nothing unconditional is at the line any more. Run `/pm:upgrade` to refresh a repository's managed block.
