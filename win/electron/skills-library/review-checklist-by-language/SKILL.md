---
name: review-checklist-by-language
description: Chooses the review checks that matter for the language, framework and runtime of a change and applies them to the diff, preferring the project's own conventions over generic lists. Use when the user asks what to look for when reviewing code in a given language, or wants a language-aware review of a diff.
---

# Review checklist by language

## Goal

Review with checks that fit the stack. The result is a short checklist for this language and project, applied to the diff, with each hit tied to a line and a reason.

## When to use

- The reviewer is unfamiliar with the language or framework of a change.
- The user asks for common mistakes in a given language.
- For a general bug-first review, use `use_skill` with `code-review`.
- For security-specific checks, use `use_skill` with `security-review`.
- The team adopts a new language or framework and reviews are slow because nobody knows its traps.

## Steps

1. Identify the stack from the diff and the repo: extensions, manifest files, framework imports, runtime version. Use `git_diff`, `list_directory` and `read_file`. Note the language version, since idioms and pitfalls change.
2. Read the project's own rules first with `search_files`: `AGENTS.md`, `CONTRIBUTING.md`, lint configs, style guides. These override any generic list.
3. Build the checklist from the language's known weak points. Examples to adapt, not to recite:
   - Dynamic languages: undefined or None access, mutable default arguments, truthiness traps, implicit type coercion.
   - Typed languages: unchecked casts, escape hatches such as `any`, `unsafe` or raw pointers, ignored error returns.
   - Memory-managed with ownership: lifetimes, clones in hot paths, unclosed handles.
   - Async code: missing await, unhandled rejections, blocking calls on the event loop.
   - SQL and ORMs: string-built queries, N+1 loads, missing transaction boundaries.
   - UI frameworks: effect or lifecycle cleanup, stale closures, keys on lists.
4. Verify details you are unsure about against the live docs with `read_url` or `search_web`, especially behaviour tied to a version. Do not rely on memory for library semantics.
5. Walk the diff against the checklist, file by file. For each hit, trace the path to confirm it is real, then record file, line and effect.
6. Run the project's linters and type checker with `run_command` so the machine catches what it can, and review what remains.
7. Cut the checklist to what applied. A ten-item list that was used beats a forty-item list that was not.
8. Save the trimmed checklist if the user wants to reuse it. Offer a file such as `docs/review-checklist.md` and create it with `create_file` only after they agree.
9. Note which of the checks can move into the linter or CI, so humans stop doing machine work next time.

## Gotchas

- Rules from one language misfire in another. Exceptions, equality, immutability and null mean different things.
- A rule that was best practice for an old version can be wrong now. Check the version.
- Framework conventions beat language conventions. A pattern odd in plain code may be required by the framework.
- Do not flag what the formatter or linter already enforces. It adds noise and the tool is more reliable.
- A checklist narrows attention. Leave time for reading the diff for plain logic errors too.
- Warn when you reviewed a language you know less well. Findings there are questions until verified.

## Output

- The checklist used, with the language and version assumed.
- Findings with file, line, rule and effect.
- Checks that found nothing, listed in one line, so the author knows they were covered.
- Suggested lint rules that would automate part of the list.
