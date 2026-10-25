---
name: dead-code-finder
description: Finds unused functions, exports, files, flags and dependencies and proves each one unreachable before proposing deletion, including dynamic and out-of-code references. Use when the user asks to find dead code, what can be deleted safely, or to list unused exports.
---

# Dead code finder

## Goal

Produce a list of removal candidates, each with the evidence that nothing reaches it and a confidence level. Nothing is deleted without that evidence, and the user decides what goes.

## When to use

- The user asks for unused code, files or exports.
- A cleanup precedes a refactor or a dependency upgrade.
- To remove a whole feature that is still wired in, plan it as a refactor with `use_skill` and `refactor`.
- To find the riskiest code rather than the unused code, use `use_skill` with `complexity-hotspots`.
- A bundle or install size has grown and unused dependencies are suspected.

## Steps

1. Check for tooling first. Use `read_file` on `package.json`, `pyproject.toml` or the build config and look for unused-code tools (knip, ts-prune, vulture, `go vet`, compiler warnings). Run the one that exists with `run_command` and keep its output as the starting list.
2. If no tool exists, build candidates with `search_files`: take each exported symbol or top-level function and count references outside its own definition.
3. For every candidate, check the references that tools miss:
   - Dynamic lookups by string (`obj[name]`, `getattr`, `require(variable)`).
   - Registration by convention: route files, plugin folders, migrations, command handlers, test discovery.
   - Config, JSON, YAML, HTML, templates and scripts that name the symbol or path.
   - Public API that outside code may import.
   - Reflection, serialisation and decorators.
4. Check history cheaply with `run_command` and `git log -S "<name>" --oneline`, which shows when it was last used and why it was added.
5. Classify each candidate: unreferenced anywhere (high confidence), referenced only by tests or by other dead code (medium), possibly used dynamically or externally (low).
6. For unused dependencies, search for imports and for use in scripts and config before listing them. Check the live docs with `read_url` if a package works by side effect.
7. Report. If the user then asks for deletion, remove in small commits, then run build and tests with `run_command` after each.
8. Group the high-confidence list into small deletion batches by folder, so each batch can be reverted alone.
9. After any deletion the user approves, run the build, typecheck and tests with `run_command`, then search again, since removal exposes new unused code.

## Gotchas

- Zero grep hits do not prove deadness. Dynamic dispatch, config and external consumers hide references.
- Code used only by tests is not production-dead, but deleting it breaks those tests. Say which case it is.
- A function called only by other dead code is dead too, but only after the first layer goes. Work in layers.
- Feature flags that are always off look alive to a grep. Check the flag's current value and where it is set.
- Exported from a library is a different question from unused in this repo. Ask who else imports the package.
- Commented-out code and unused files in `scripts/` or `docs/` often have a human who still wants them.

## Output

- A table: item, location, evidence, confidence, suggested action.
- Items grouped by confidence, high first.
- What you could not check, such as external consumers, so the user can confirm.
- Suggested batch order if deletion goes ahead.
