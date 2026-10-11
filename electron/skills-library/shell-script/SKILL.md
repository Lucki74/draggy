---
name: shell-script
description: Writes robust shell scripts for bash, PowerShell or cmd, with safe quoting, error handling, dry-run options and clear usage, and explains commands before anything destructive. Use when the user wants a script to automate a task, a one-liner explained, or a script fixed.
---

# Shell scripts

## Pick the shell

Match the user's system and the project: PowerShell on Windows (pwsh 7 when available), bash for Linux, macOS and CI. Ask if unclear. Do not write bash-only syntax for cmd or PowerShell.

## Bash essentials

- Start with `#!/usr/bin/env bash` and `set -euo pipefail`.
- Quote every variable: `"$file"`, `"${items[@]}"`. Use `[[ ... ]]` for tests.
- Use `mktemp` for temporary files and a `trap 'rm -f "$tmp"' EXIT` to clean up.
- Loop over files safely: `find ... -print0 | while IFS= read -r -d '' f; do ...` or globs with `shopt -s nullglob`; never parse `ls`.
- Check required commands exist: `command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }`.
- Print errors to stderr and exit non-zero on failure.

## PowerShell essentials

- `$ErrorActionPreference = 'Stop'` and `Set-StrictMode -Version Latest`.
- Use approved Verb-Noun names for functions, parameters with `param()` and types, and `-LiteralPath` for paths that may contain brackets.
- Use `-WhatIf` / `SupportsShouldProcess` for destructive functions.
- Pipeline objects, not text parsing, when cmdlets return objects.

## Every script

- A usage message (`-h` / `--help`) and argument validation.
- A dry-run option for anything that deletes, moves or overwrites, showing what would happen.
- Idempotent where possible: running twice does no harm.
- No secrets hardcoded; read from environment variables.

## Testing

- **In Code**, save the script with write_file and run it with run_command in dry-run mode first, on a safe test folder. Ask before running it for real on anything that deletes or changes files outside the project.
- **In Chat**, where commands cannot run, save it with create_file if the user wants a file (note that script extensions like .sh or .ps1 may be refused for safety, in which case give it in the reply to copy) and explain how to run it.

## Output

The script in a code block, what it does step by step, how to run it (including making it executable on Unix), and what it changes.
