---
name: crash-dump-reading
description: Reads a stack trace or crash report from top to bottom, separates library frames from the user's code, maps lines to the right build and points at the frame to fix. Use when the user pastes a stack trace, asks what a trace means, or reports an app crash with a report.
---

# Crash and stack trace reading

## Goal

Turn a trace into a clear statement: what failed, in which of the user's own frames, and why. A good result points at one file and line to open first and explains how the program got there.

## When to use

- An exception trace, panic, segfault report, or "Uncaught" browser error.
- A crash report from a user machine or a production service.
- A trace through a framework that buries the relevant line.
- A user sent a crash report from their machine.
- A web app throws an error in the browser console with a minified trace.
- A build tool dies with a long chain of causes.

For a log with no single trace, use `use_skill` with `log-triage`. For a plain error text with no frames, use `error-message-decoder`.

## Steps

1. **Read the message first.** Find the error type and message at the top (or bottom for some languages such as Python). Note whether there is a chain of causes ("caused by", "during handling of").
2. **Find the order.** Check whether the newest frame is first or last in this language. Check the root cause in a chain, since the outer wrapper hides it.
3. **Mark the frames.** Split frames into the user's code and library or runtime code. The bug is usually in the nearest user frame to the throw, or in how user code called the library.
4. **Match the build.** Check that the trace comes from the same version as the files you have. Use `run_command` to check the version or commit if the report shows one. If code is minified or compiled, ask for source maps or symbols, or find them with `search_files`.
5. **Open the code.** `read_file` around the line of the nearest user frame, with 20 lines of context. Identify the value that was null, out of range, wrong type or missing.
6. **Walk up the stack.** Read each caller until you find where that bad value came from.
7. **Check the facts about the library.** If the cause is library behaviour, confirm with `search_web` or `read_url` on the library docs rather than recalling it.
8. **Conclude** with the trigger (input or state) and a fix or a guard, and a way to reproduce with `run_command` if possible.
9. Compare the version in the report to the version you read, and say if they differ.

## Gotchas

- The top frame is where it blew up, not where it went wrong. Often a caller passed bad data.
- Async traces lose the real caller. Look for an async stack option or add a label at the call site.
- Line numbers from a different build point at unrelated code. Confirm versions first.
- Native crashes need symbols. Raw addresses without a symbol file cannot be read; say so and ask for the file.
- Wrapped errors hide the original. Look at the innermost cause.

## Output

Short explanation in plain words, the key frame as file and line, the chain of events, the likely fix, and what to collect if the cause is still open.

Do not quote private paths or user names from the report back in public text.
