* **Running pm's own test suite no longer fills your temp directory.** The scratch repositories and
  fixture directories the suite creates are now removed when the test process exits. Before this, one
  run of the per-commit tests left 436 directories in the OS temp dir and one run of the functional
  tests left 1,517 more, so a contributor's machine accumulated tens of thousands of `pm-test-*`,
  `pm-plugin-*` and `pm-cache-*` directories over months, and slow runs were blamed on the suite. A
  per-commit test now refuses any new temp-directory site that is not scheduled for removal, and a
  functional test runs the fixture helpers in an isolated temp dir and fails if anything survives.
  This affects only people developing pm itself; the plugin you install is unchanged.
