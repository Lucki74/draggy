---
name: repro-case-minimizer
description: Shrinks a failing program, input or configuration step by step to the smallest version that still shows the bug, and checks it in a clean directory. Use when the user wants a minimal reproduction, a small repro for a bug report, or to narrow down which input breaks something.
---

# Repro case minimizer

## Goal

Produce the smallest self-contained example that still fails in the same way. A good result runs from a clean folder with one command, has no unrelated code, and is easy for someone else to read in a minute.

## When to use

- A bug report needs a reproduction for a maintainer.
- A failure only happens inside a big project and the cause is unclear.
- A large input file, config or data set triggers a failure and the trigger is unknown.
- A maintainer asked for a reproduction before they will look.
- A failing input file is thousands of lines long.
- A bug only shows with one combination of options.

For finding the cause in the full project, use `use_skill` with `systematic-debugging`. For finding the commit, `bisect-regression`.

## Steps

1. **Capture the failure signature.** Run the original with `run_command` and record the exact error text, exit code or wrong output. This is the test for "still fails the same way".
2. **Script the check.** Write a small script with `create_file` that runs the case and exits non-zero only when the signature appears. Every later step uses it.
3. **Copy to a scratch directory.** Work on a copy, never on the original project. Use `list_directory` to see what you are cutting.
4. **Cut big pieces first.** Remove half of the files, routes, config blocks, dependencies or input rows. Run the check. If it still fails, keep the cut; if not, restore and cut the other half. Halving beats removing line by line.
5. **Cut finer.** Remove functions, options, fields, plugins and imports one at a time. Replace real data with literals. Replace services with constants.
6. **Simplify values.** Shorten strings, reduce numbers to the smallest failing size, rename to plain names.
7. **Stop at a floor.** When removing anything changes the failure, you are done. Note which parts proved necessary.
8. **Verify clean.** Place the case in a fresh empty folder, install only what it declares, and run the check. Pin the versions in use by reading them from the tool output.
9. **Write the report** with the steps, expected result, actual result and versions.
10. Compare the failure of the final case with step 1 once more, character by character where it matters.

## Gotchas

- Removing a part can change the failure into a different error. The check must test the exact signature and match the exact error text.
- Stopping at "smaller" leaves unrelated code that distracts the reader. Keep cutting until each part is needed.
- A repro that depends on files in your home directory or local services does not reproduce elsewhere.
- Secrets, private data and company code must not go into a shared repro. Replace them with dummies.
- Unpinned dependencies make the repro fail differently next week. Record versions.

## Output

The minimal files (paths in the scratch directory), the one-line run command, the expected and actual result, versions used, and the list of things proven unnecessary.

Add a line telling the reader how to run it on their machine.
