* **The commit hook reports at most 50 commits per run, and says how many remain.** A window of 200 commits took
  8 s and printed 24 KB of hook context. The anchor now stops at the last commit reported, so the surplus is
  reported by the next run, none twice and none lost, and the output ends "N further commits landed since the
  last observation and will be reported on the next hook run."
* **A reflog line still being written is never the anchor.** The anchor is the last COMPLETE line, so a writer
  caught mid-append no longer makes the next run read "anchor lost" and fall back to the text heuristic.
* **A retraction row names every epic whose rows it covers.** `retract-detour` and the amend retraction wrote
  only the first row's epic; the `RETRACTED` row now carries each distinct epic, comma-separated.
* **`retract-detour` says when it retracted more than one stored sha together.** For a commit that no longer
  exists, two rows whose shas are prefixes of each other cannot be told apart from the log text and are hidden
  by the one retraction; the command now prints which, instead of doing it silently.
