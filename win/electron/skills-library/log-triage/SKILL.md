---
name: log-triage
description: Reduces a large log or command output to the first real failure, the lines around it and a short timeline of what led there. Use when the user pastes or points to logs and asks what went wrong, to find the error, or to read through the output.
---

# Log triage

## Goal

Tell the user what happened, in order, from a log too large to read. A good result names the first failure, the evidence lines with their positions, what changed just before it, and what is only noise.

## When to use

- A build, deploy, test run or service log has thousands of lines.
- A failure was reported without a clear message.
- Several logs from different parts of a system need lining up.
- A service stopped responding and the user has its log folder.
- A CI job failed with a huge console output.
- The user needs a timeline for an incident note.

For one stack trace, use `use_skill` with `crash-dump-reading`. For a single error line, use `error-message-decoder`.

## Steps

1. **Size it.** Use `run_command` to count lines and find the time range. For a pasted log, work from the text; for a file, never `read_file` the whole thing if it is huge. Read the first and last 50 lines, then search.
2. **Learn the format.** Find the timestamp, level and source fields. Note the time zone and whether several sources use different clocks.
3. **Count by level.** Use `search_files` or `run_command` to count ERROR, WARN, FATAL, exception and failed patterns. Group identical messages and rank by count.
4. **Find the first failure.** Search for the earliest error-level line by timestamp. The last error is usually fallout. Read 30 lines before and after it with `read_file` using a line range.
5. **Check the noise.** Warnings that appear in healthy runs too (compare with a good log if there is one) are not the cause. Mark them out.
6. **Build the timeline.** Write 5 to 10 entries: time, source, event, and line number. Include the last healthy sign before the fault.
7. **Follow the thread.** Use a request id, session id or thread name to pull all related lines. For many files, hand the sweep to `explore`.
8. **State the cause** as a hypothesis with its evidence, and say what log or setting would settle it.
9. Check your conclusion against one line you have not yet read that should exist if it is true, and look for it.

## Gotchas

- Frequent errors are not always first or important; a single line early on may start the whole chain.
- Buffered output from different streams can arrive out of order. Trust timestamps over file position.
- Truncated logs lose the beginning. Say so before drawing conclusions.
- Secrets and personal data often sit in logs. Do not repeat tokens, keys or emails in the answer.
- Retry loops repeat the same line hundreds of times. Count them once and show one.

## Output

Headline cause in one sentence, then the timeline with line references, then noise ignored, then next step. Keep quotes to the few lines that prove the point.

Say clearly what the log cannot tell you.
