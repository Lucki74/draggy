---
name: logging-review
description: Reviews log statements for usefulness when something fails, correct levels, enough context to find the case, and absence of secrets or personal data. Use when the user asks to review logging in a change, whether the right things are logged, or to check logs for sensitive data.
---

# Logging review

## Goal

When this code fails at night, the person on call can find the failing case from the logs alone, and the logs hold nothing that should not be stored. The review lists missing, noisy and unsafe log statements with a fix for each.

## When to use

- A diff adds or changes log calls, or an incident exposed a log gap.
- The user worries that logs leak tokens, emails or other personal data.
- To read logs from a failure, use `use_skill` with `log-triage`.
- For the failure paths themselves, use `use_skill` with `error-handling-review`.
- A new integration with an outside service goes live and its failures must be diagnosable.
- Log storage cost or search noise has become a complaint.

## Steps

1. Find the log calls with `search_files` (`logger.`, `console.`, `log.`, `print(`, `slog`). For a diff, restrict to changed files with `git_diff`. Read the project's logging helper and levels with `read_file`.
2. For each call, answer: who reads this, in which situation, and what do they do with it? A line nobody can act on is noise.
3. Check levels. Errors mean something failed and needs attention. Warnings mean degraded but working. Info marks lifecycle events, kept sparse. Debug is for developers and off by default.
4. Check context on each failure log: operation name, identifier of the record or request, the error with its cause chain, and relevant inputs by id rather than by content.
5. Scan for sensitive data. Look at what is interpolated: request bodies, headers, tokens, passwords, emails, addresses, full file paths, raw user text. Log identifiers or masked values instead.
6. Check volume: logs inside tight loops, per-item logs on large batches, and the same failure logged at every layer it passes through. Keep one log at the layer that handles it.
7. Check format: structured fields where the project uses them, consistent keys, no multi-line text that breaks parsers, timestamps and correlation ids present.
8. Propose edits as exact before and after lines. Apply with `edit_file` only when the user asks.
9. Run the code path once with `run_command` or `run_code`, using a failing input, and read the actual log output. Reading the statement is different from reading what it prints.
10. Check how logs are shipped and retained by reading the deployment config with `read_file`, since retention and access decide how sensitive a field can be.

## Gotchas

- Logging an error object may dump request headers or config that contain secrets. Check what the object holds.
- A log line built with string formatting runs its arguments even when the level is off. Use lazy forms in hot paths.
- Logging and rethrowing at every layer yields five copies of one failure and hides the root.
- Success logs on every request fill disks and drown the failures. Count per-second volume at realistic traffic.
- Log messages that say "error occurred" without the operation are useless at 3 a.m.
- Logs are often retained far longer than the data they describe. Treat them as storage with the same rules.
- Metrics and traces often answer the question better than a log line. Suggest a counter when the real need is a rate.
- A fix that adds more logging is not always right. Removing a noisy line is a valid result of this review.

## Output

- Findings grouped as unsafe, missing context, wrong level and noise, each with file, line, the issue and the replacement line.
- The list of failure scenarios that still have no log.
- Anything that needs a decision from the team, such as retention or what counts as sensitive.
- Sample of real log output from the failing run.
- Any log line you recommend deleting, with the reason.
