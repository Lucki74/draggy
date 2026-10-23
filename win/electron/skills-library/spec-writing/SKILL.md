---
name: spec-writing
description: Writes a spec for a feature or change that states the problem, scope, behaviour, edge cases, constraints and open questions so a builder needs no guesses. Use when the user asks to write a spec, requirements document, PRD or feature definition before coding.
---

# Writing a spec

## Goal

A document short enough to read in five minutes and precise enough that two developers would build the same thing. It describes what the system does and why, not how the code is arranged. For internal structure use `design-doc`.

## When to use

- A feature idea needs to become something buildable.
- Several people or sessions will work from one shared description.
- The user says "spec this", "write requirements", "define this feature".
- Intent is still unclear: run `brainstorming` first.
- Only the pass/fail checks for one story are needed: use `acceptance-criteria`.

## Steps

1. Collect the input: the user's description, linked tickets, related code and existing docs. Use `read_file` and `search_files` to find current behaviour that the spec must fit or change. Quote what you find rather than describing it from memory.
2. Write the problem in two to four sentences: who has it, what they do today, why that hurts. If you cannot, call `ask_user` for the missing piece.
3. List goals and non-goals. Non-goals are things a reasonable reader might expect that are deliberately out. They stop scope creep later.
4. Describe behaviour as scenarios in plain sentences: who does what, what the system does in response. Cover the main flow first, then each alternative flow.
5. Enumerate edge and failure cases explicitly: empty input, very large input, duplicates, concurrent edits, permission denied, network failure, partial failure, data that already exists in an old shape. Give the expected result for each, since "handle gracefully" is not a result.
6. State constraints that bind the solution: platforms, performance targets that the user actually gave, compatibility, privacy, existing APIs. Do not invent numbers. Ask or mark them as open.
7. Add an interface sketch only where behaviour depends on it: API shape, UI states, file format. Keep it to the minimum a reader needs.
8. List open questions as a separate section, each with the person who can answer. Give your default answer for each so work is not blocked.
9. Re-read as the implementer. Mark every sentence a builder would need to guess at, then fix it or move it to open questions.
10. Save with `create_file` at the project's docs location (look with `list_directory` for `docs`, `specs` or `rfcs`) and match existing naming. Summarise the three biggest decisions in chat.

## Gotchas

- A spec that describes the solution ("add a Redis cache") before the problem locks in a choice nobody examined.
- "The system handles errors" says nothing about behaviour. Each failure needs a visible result: message, retry, rollback, or log.
- Terms drift. If a spec says "account" in one place and "user" in another, readers will assume two things. Define terms once and reuse them.
- Open questions hidden in the middle of paragraphs never get answered. Collect them in one place.
- Over-specifying pixel details or code structure makes the spec expensive to change and pointless to read. Specify behaviour and leave the rest to the builder.
- Specs written from the idea alone miss existing behaviour. Check the current code for what is already there before saying "new".

## Output

A markdown file with sections: Problem, Goals, Non-goals, Behaviour (scenarios), Edge cases, Constraints, Interfaces (if needed), Open questions. Typically one to three pages. In chat, give the path and the open questions that block work.
