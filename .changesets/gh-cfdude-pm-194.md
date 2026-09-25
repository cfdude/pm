### Fixed

* **cfdude/pm#194 — a malformed lesson `detect:` is rejected with a reason instead of being
  discarded silently.** The engine now tells three cases apart: a lesson with no matcher, which is
  retrieval-only by design; one whose matcher works; and one whose matcher cannot work. A matcher
  in the last group is rejected and named with its reason, for example not JSON, an unknown key,
  a regex that does not compile, or a JSON `\b` that decoded to a backspace. The hook stays silent
  about rejects. For now, only pm's own repository reports them, through a per-commit test that
  fails naming each one. A consumer repository gets no report yet; cfdude/pm#228 tracks that.
  pm's own six inert matchers were fixed: four now fire, and two that matched file content no
  matcher can see are now retrieval-only.
