---
name: lint-config-tuning
description: Adjusts a linter or formatter configuration so it catches real defects with few false positives, by measuring each rule's hits before and after any change. Use when the user says the linter is too noisy, asks to tune the lint config, or wants to know which rules to enable.
---

# Lint config tuning

## Goal

A lint setup people trust: every rule that fires points at something worth fixing, and rules that guard against real bugs are on. The result is a config change backed by hit counts, rolled out without a giant unrelated diff.

## When to use

- The team ignores lint output because of noise.
- A new project needs a sensible baseline.
- A recurring bug class in reviews could be caught by a rule.
- To act on one-off lint failures in a diff, use `use_skill` with `pr-self-review`.
- A migration to a new linter version changed which rules are on by default.

## Steps

1. Find the tooling. Use `list_directory` and `read_file` on the root for config files (`eslint.config.*`, `.eslintrc*`, `ruff.toml`, `.golangci.yml`, `.editorconfig`, `.prettierrc`) and the lint script in the package manifest. Note which tool formats and which one lints.
2. Run the linter with `run_command` and save the full output. Count findings per rule (use JSON output when the tool has it). This is the baseline.
3. Read the top ten rules by count. For each, sample five hits with `read_file` and decide: real defect, style only, or false positive.
4. Pick the action per rule:
   - Real defect with few hits: keep, fix the hits.
   - Real defect with many hits: keep as warning or scope it to new and changed files, then burn down.
   - Style only: leave to the formatter, or turn off.
   - False positive: narrow the rule options or the file globs, with a comment saying why.
5. Look for missing rules that catch real bugs: unused variables, floating promises, unreachable code, shadowing, unsafe comparisons. Check the current rule names and defaults in the tool's docs with `read_url`, since they change between versions.
6. Apply the change with `edit_file`, then rerun the linter and compare the per-rule counts with the baseline. Confirm the intended rules moved and nothing else did.
7. Run the project's test command with `run_command` if any autofix was applied.
8. Check the CI config with `read_file` to confirm the lint command there matches the local one. A rule that passes locally and fails in CI wastes more time than any style rule saves.
9. Document the decisions next to the config as short comments, one line per disabled or customised rule.

## Gotchas

- Enabling a strict rule across the repo yields one huge fix commit that buries real history. Scope it or ratchet it.
- Disabling a rule to silence a handful of hits throws away protection everywhere. Fix the few hits instead.
- Linter and formatter rules can fight each other. Use the integration config the tool provides, and run both to check for ping-pong.
- Autofix changes code. Run tests after it, and review the diff for rules whose fixes are not safe.
- Inline disable comments without a reason pile up. Count them as part of the baseline.
- Rule names and defaults differ by version. Do not copy a config from memory or another project without checking against the installed version.

## Output

- A table: rule, hits before, hits after, decision, reason.
- The config diff.
- A rollout note: what is fixed now, what is a warning, and the plan to tighten later.
- The commands to reproduce the before and after counts.
