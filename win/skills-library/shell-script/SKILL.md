---
name: shell-script
description: Writes shell scripts for bash, PowerShell or cmd with safe quoting, error handling, dry-run options and clear usage, and explains commands before anything destructive. Use when the user wants a script to automate a task, a one-liner explained, or a broken script fixed.
---

# Shell scripts

## Goal

A script that does the job, fails loudly instead of silently, and is safe to run twice. A good result states what it will change before anyone runs it.

## When to use

- The user wants a bash, PowerShell or cmd script to automate something.
- The user wants a one-liner explained or a script fixed.
- For a CI pipeline file, use `use_skill` with `ci-workflow`.
- For a container build file, use `use_skill` with `dockerfile`.

## Steps

1. Pick the shell to match the user's system and project: PowerShell on Windows (pwsh 7 when available), bash for Linux, macOS and CI. Ask if unclear.
2. For bash:
   - Start with `#!/usr/bin/env bash` and `set -euo pipefail`.
   - Quote every variable: `"$file"`, `"${items[@]}"`. Use `[[ ... ]]` for tests.
   - Use `mktemp` for temporary files and `trap 'rm -f "$tmp"' EXIT` to clean up.
   - Loop over files with `find ... -print0 | while IFS= read -r -d '' f; do ...` or globs with `shopt -s nullglob`.
   - Check required commands: `command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }`.
   - Print errors to stderr and exit non-zero on failure.
3. For PowerShell:
   - Set `$ErrorActionPreference = 'Stop'` and `Set-StrictMode -Version Latest`.
   - Use approved Verb-Noun function names, `param()` with types, and `-LiteralPath` for paths that may contain brackets.
   - Use `-WhatIf` through `SupportsShouldProcess` for destructive functions.
   - Pass objects through the pipeline instead of parsing text when cmdlets return objects.
4. For every script:
   - Add a usage message (`-h` or `--help`) and argument validation.
   - Add a dry-run option for anything that deletes, moves or overwrites, showing what would happen.
   - Make it idempotent where possible.
   - Read secrets from environment variables, never hardcode them.
5. Test:
   - In Code, save the script with `write_file` and run it with `run_command` in dry-run mode on a safe test folder first. Ask before running it for real on anything that deletes or changes files outside the project.
   - In Chat, where commands cannot run, save it with `create_file` if the user wants a file and explain how to run it. Script extensions such as .sh or .ps1 may be refused for safety. In that case give the script in the reply to copy.

## Gotchas

- Bash-only syntax does not run in cmd or PowerShell. Match the shell.
- An unquoted variable breaks on spaces and can expand into something destructive.
- Never parse `ls` output. Use globs or `find -print0`.
- A script that deletes with no dry-run option cannot be checked before it does damage.
- Running a destructive script outside the project without asking is not acceptable, even as a test.

## Output

The script in a code block, what it does step by step, how to run it (including making it executable on Unix), and what it changes.
