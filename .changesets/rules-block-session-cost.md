* **pm now measures what it costs every session, and caps the SessionStart brief.** `render` (`/pm:status`) and
  `upgrade` end with two lines: the managed rules block as it sits on disk (bytes and estimated tokens, bytes/4)
  and the SessionStart brief. The brief was uncapped and grows with a repository's history (78,275 bytes, about
  19.5K tokens, on pm's own repo); the hook now sends at most 16384 bytes: the head, a visible
  `[pm brief truncated: ...]` marker naming where the full text lives (PROJECT.md "Briefing", which stays
  uncapped), and the closing reminders. A brief under the cap is unchanged. `rules --sections` prints the rules
  block's per-section sizes, ranked. The block itself is unchanged; `docs/rules-block-session-cost.md` ranks
  its sections (the gate procedure is 29.8%) and which could move to on-demand skills later.
