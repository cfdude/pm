* **The "tests in the engine" number on pm-plugin.dev comes only from a clean run, and the run is
  kept (#219).** The release checklist's Real Numbers recipe used to pipe the combined test run
  straight into a count, so a run that also had a failing test still produced a number to publish,
  and the output that could have identified the failure was thrown away. The recipe now saves the
  whole run to a UTC-dated file under the git common dir (`pm-real-numbers/`), names that file,
  and publishes nothing unless the runner exited 0 with `fail 0`, `cancelled 0`, more than zero
  tests and every counted test passed (a skipped or todo test is not a pass). The log name carries
  the PID, so two runs in one second keep two logs. A failed run is recorded against #219 before it
  is re-run, so a flake cannot be retried away silently. The flaky test #219 reported is not
  identified yet; this makes its next occurrence diagnosable.
