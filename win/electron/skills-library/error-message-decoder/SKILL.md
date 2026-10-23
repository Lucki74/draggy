---
name: error-message-decoder
description: Explains an error message in plain words, finds which line or setting really caused it, and gives the smallest fix with a way to confirm it. Use when the user pastes an error, asks what an error means, or gets a message when running a command.
---

# Error message decoder

## Goal

Make an error understandable and fixable. A good result says what the message means, what actually caused it in this project, the smallest change that fixes it, and the command that proves the fix.

## When to use

- A compiler, installer, runtime or tool prints an error the user cannot read.
- A message is vague ("something went wrong", "exit code 1").
- The user pasted only part of the output.
- An install, build or deploy command fails with an unfamiliar code.
- A browser shows an error page or a console message the user cannot read.
- A teammate pastes only the last line of the output.

For a full stack trace use `use_skill` with `crash-dump-reading`; for large logs, `log-triage`; for type checker output, `type-errors`.

## Steps

1. **Get the whole picture.** Ask with `ask_user` for the command, the full output, the tool and OS versions, and what changed recently, unless they are already given. Rerun the command with `run_command` when possible to see the real output.
2. **Find the first error.** Scroll to the earliest error line. Later ones are often caused by it. Ignore warnings unless they appear right before.
3. **Split the message** into parts: tool, error code or class, subject (file, package, symbol, port), and the condition ("not found", "denied", "already in use", "unexpected token").
4. **Say it plainly** in one or two sentences, without repeating the jargon.
5. **Find the real source.** Use `read_file` and `search_files` on the named file, config or import. Check the common causes for that condition: wrong path or case, missing install, version mismatch, wrong working directory, permissions, port taken, bad syntax just before the reported line.
6. **Check documentation for that exact version.** For an error code, use `search_web` or `read_url` on the tool's own docs. Do not trust a remembered fix for a different version.
7. **Give the smallest fix.** Prefer a config or code change over a workaround. Apply it with `edit_file` if the user wants.
8. **Verify.** Run the original command again and confirm the error is gone and no new one replaced it.
9. If more than one fix is plausible, rank them and say how to tell which applies.

## Gotchas

- The line number shown can be one past the real problem (a missing bracket or quote earlier).
- Search results for the message often cover another version or another tool. Include both in the search.
- Running a suggested command with admin rights, or deleting caches and lock files, can make things worse. Explain the effect first.
- An error that moves after a fix usually means the first fix worked and the next problem was hidden behind it.
- Suppressing the message (ignore flags, empty catch) is not a fix.

## Output

Three short parts: what it means, why it happened here, the fix and the check command. Add one line on how to avoid it if there is a clear habit or setting.

Note what you could not verify, such as an unknown environment.
