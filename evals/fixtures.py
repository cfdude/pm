"""Materialize throwaway pm projects for evaluation.

Fixtures are built by invoking the REAL engine CLI, never by hand-writing
state.json -- so a fixture is schema-correct by construction and survives
future migrations.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE = REPO_ROOT / "scripts" / "conductor.mjs"

# Each seed is a list of engine invocations applied after `init`.
SEEDS: dict[str, dict] = {
    "single-active-epic": {
        "description": "One active P0 epic. The baseline shape for most scenarios.",
        "commands": [
            [
                "add-epic",
                "--id", "canary-active",
                "--lane", "claude-code",
                "--priority", "P0",
                "--status", "active",
                "--title", "Canary active epic for evaluation fixtures",
            ],
        ],
    },
    "reconcile-owed": {
        "description": (
            "An active epic that owes a reconcile, so the gate-guard PreToolUse hook "
            "should block edits."
        ),
        "commands": [
            [
                "add-epic",
                "--id", "paused-work",
                "--lane", "openspec",
                "--priority", "P1",
                "--status", "active",
                "--title", "Epic that owes a reconcile after a detour",
            ],
        ],
    },
}


def _engine(project: Path, args: list[str]) -> str:
    """Run the pm engine against `project`, returning stderr+stdout for diagnostics."""
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(project), "PM_QUIET_ENGINE_BANNER": "1"}
    proc = subprocess.run(
        ["node", str(ENGINE), *args],
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"engine {args!r} failed: {proc.stderr.strip()}")
    return proc.stdout + proc.stderr


def _write_memory_isolation(project: Path) -> None:
    """Suppress the operator's own instructions for this run.

    WHY THIS EXISTS. The corpus measures whether *pm's artifacts* make an agent behave
    correctly. But a headless `claude -p` also loads the operator's user-scope memory, and this
    maintainer's `~/.claude/CLAUDE.md` states pm's lane heuristic verbatim -- the very thing
    `chose_claude_code_lane` asserts. Verified live: in an empty directory with every tool
    disabled, a session still recited a fact that exists only in that file. So without this,
    a passing score cannot distinguish "pm's rules block worked" from "the operator's memory
    told it the answer."

    The bias is also ASYMMETRIC, which is what makes it a parity problem rather than a
    curiosity: Hermes and Codex read `AGENTS.md`, not `~/.claude/CLAUDE.md`, so Claude Code
    would enter every comparison with an assist the other platforms never get.

    Two separate sources, both required:
      * `claudeMdExcludes` -- absolute paths only, `~` is NOT expanded. `SHIP-REAL-SOFTWARE.md`
        is listed explicitly because `CLAUDE.md` `@`-imports it and whether excluding a parent
        also drops its imports is undocumented; do not assume.
      * `autoMemoryEnabled` -- `~/.claude/projects/<project>/memory/` loads into every session
        and is written from the operator's own corrections, so it drifts toward whatever is
        being tested. The more insidious of the two.

    Written into the throwaway fixture, never into `~/.claude` or the repo, so the maintainer's
    interactive sessions keep their memory and nothing needs a "testing window".

    Rejected alternatives, both of which look right and silently break the measurement:
      * `--bare` also disables hooks and keyring reads -- it removes the artifact under test.
      * `--setting-sources project,local` does suppress user memory, but plugin enablement
        lives in user-scope settings, so pm's SessionStart hook stops firing entirely.
    """
    home = Path.home()
    claude_dir = project / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)

    # Positive proof, not absence-of-evidence. An InstructionsLoaded hook records every
    # instruction file the session actually loads, with its memory_type ("User" / "Project" /
    # "Local" / "Managed"). A scorer then asserts no User-scope file appears. Without this, the
    # only evidence isolation worked is that the agent FAILED to recite something -- which is
    # indistinguishable from the probe simply not landing. This session has repeatedly found
    # assertions that could not fail; this one can.
    # .cjs, NOT .mjs: this needs `require` and `__dirname`, and neither exists in an ES
    # module. The first version was .mjs and threw ReferenceError -- which the catch below
    # silently swallowed, leaving the log empty and the scorer passing vacuously. The
    # swallow is right for production (an observability hook must never break the run it
    # observes) but it hides authoring bugs, so a unit test pipes a real payload through
    # this file rather than trusting it.
    recorder = claude_dir / "record-instructions.cjs"
    recorder.write_text(
        "// Appends one TAB-separated `memory_type<TAB>file_path` line per instruction file\n"
        "// loaded. Failures are swallowed on purpose: an observability hook must never be\n"
        "// able to break the run it is observing. Covered by a test so the swallow cannot\n"
        "// hide a broken recorder.\n"
        "let s = '';\n"
        "process.stdin.on('data', (d) => (s += d)).on('end', () => {\n"
        "  try {\n"
        "    const j = JSON.parse(s);\n"
        "    const fs = require('node:fs');\n"
        "    const path = require('node:path');\n"
        "    const out = path.join(__dirname, 'instructions-loaded.log');\n"
        "    fs.appendFileSync(out, `${j.memory_type}\\t${j.file_path}\\n`);\n"
        "  } catch { /* observability only -- never fail the session */ }\n"
        "});\n"
    )

    settings = {
        "claudeMdExcludes": [
            str(home / ".claude" / "CLAUDE.md"),
            str(home / ".claude" / "SHIP-REAL-SOFTWARE.md"),
            str(home / ".claude" / "rules" / "**"),
        ],
        "autoMemoryEnabled": False,
        "hooks": {
            "InstructionsLoaded": [
                {"hooks": [{"type": "command", "command": f'node "{recorder}"'}]}
            ]
        },
    }
    (claude_dir / "settings.local.json").write_text(json.dumps(settings, indent=2) + "\n")


def materialize(seed_name: str, workdir: Path) -> Path:
    """Build a pm-initialized project for `seed_name` inside `workdir`."""
    if seed_name not in SEEDS:
        raise KeyError(f"unknown seed {seed_name!r}; known: {sorted(SEEDS)}")

    project = Path(workdir) / "project"
    project.mkdir(parents=True, exist_ok=True)

    _engine(project, ["init"])
    for command in SEEDS[seed_name]["commands"]:
        _engine(project, command)

    # After init, so the engine's own scaffolding cannot clobber it.
    _write_memory_isolation(project)

    return project
