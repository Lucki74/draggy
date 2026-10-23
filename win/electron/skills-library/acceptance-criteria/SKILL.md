---
name: acceptance-criteria
description: Writes acceptance criteria for a story or ticket as concrete, testable checks that cover the main flow, edge cases and failures. Use when the user asks for acceptance criteria, a definition of done, or how to tell that a ticket is finished.
---

# Acceptance criteria

## Goal

A short list of statements about behaviour that a person or an automated test can pass or fail. When all hold, the story is done, and nobody argues about it afterwards.

## When to use

- A story or ticket has a title and a description but no way to check it.
- The user asks "how do we know this is done", "define done", "write acceptance criteria".
- Tests are about to be written and need a source of truth.
- A whole feature needs describing: use `spec-writing`.
- The criteria need turning into test code: use `write-tests` after.

## Steps

1. Read the story, linked spec and any related code with `read_file` and `search_files`. Find how the feature behaves today and how similar features are checked in existing tests.
2. Restate the user value in one line: who, what they can do, why. If two readers could interpret the story differently, ask the single clarifying question with `ask_user`.
3. Write the main flow as criteria in the form: given a starting state, when the user or system does something, then a specific observable result occurs. One behaviour per criterion.
4. Add one criterion for each alternative flow and each failure: invalid input, missing permission, empty data, duplicate action, service unavailable, interrupted operation. State what the user sees or what state the data ends in.
5. Cover state and data effects where they matter: what is saved, what is removed, what stays unchanged, what is logged, what happens to existing records created before this change.
6. Include non-functional criteria only when the user gave a requirement: a response time, supported platforms, accessibility needs. Use their numbers. If none exist, ask or leave them out.
7. Check each criterion with three questions: could a test fail it, does it say what happens and not how it is built, and is it independent of the others. Rewrite any that fail.
8. Remove vague words (fast, easy, intuitive, properly, works) and replace them with an observable result or a threshold the user approved.
9. Confirm the list with `ask_user`, flagging the ones you inferred. Then add it to the ticket text, or save it with `create_file` in the format the project uses (check for a template with `search_files`).
10. Mark which criteria suit automation and which need a manual check, so the test plan is clear.

## Gotchas

- "Works well" or "is user friendly" cannot fail, so it cannot pass. Every line needs a visible result.
- Happy path only. The failure and edge cases are where the bugs and disputes are, so give them their own lines.
- Criteria that dictate implementation ("uses a hash map", "calls the new endpoint") lock the builder in and break when the design changes. Describe behaviour.
- Bundling several behaviours in one criterion makes a partial pass unreadable. Split them.
- Forgetting existing data and old clients. State what happens to records created before the change.
- Copying the criteria from a similar ticket without re-reading the story. They drift from what this one actually needs.

## Output

A numbered list of given/when/then statements grouped as Main flow, Alternative flows, Failures and Data effects, with an optional Non-functional group. Keep every line to one or two sentences. Close with the inferred items needing confirmation.
