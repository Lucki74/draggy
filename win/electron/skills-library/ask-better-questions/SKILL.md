---
name: ask-better-questions
description: Decides which unknowns actually block progress, asks only those in a single batch with a proposed default for each, and proceeds on reasonable assumptions for the rest. Use when the user says ask me what you need, when a request is ambiguous, or before starting work with missing requirements.
---

# Ask better questions

## Goal

Get the information that changes the outcome with the fewest interruptions. The user answers one short batch, most questions have a default they can accept with a word, and everything answerable from the workspace is looked up and not asked.

## When to use

- The request is open to several readings that lead to different work.
- A choice is hard to undo, such as a naming scheme, a data format or a destructive action.
- The user invites questions.
- To turn the answers into a plan, use `use_skill` with `task-decomposer`.

## Steps

1. List everything you do not know about the task. Write it as raw questions first, without filtering.
2. Strike out the ones the workspace can answer. Use `search_files`, `read_file` and `explore` to look up conventions, existing patterns, config values and prior art. Questions the files answer should not reach the user.
3. Strike out the ones with an obvious safe default and low cost if wrong. Note them as assumptions to state later.
4. Of what is left, keep only the questions where the answer changes what you would build or where a wrong guess is expensive: goal and audience, scope boundaries, constraints, hard preferences, and anything irreversible.
5. Sharpen each question. Make it answerable in a few words: offer two or three concrete options, name the one you would pick and why, and avoid open prompts like "what do you want?".
6. Order them by importance and cap the batch at about three to five. If more matter, ask the top few and say you will follow up.
7. Send them together through `ask_user` in one message. Include the assumptions you are making for everything else, so the user can correct any in the same reply.
8. When the answers arrive, restate the decisions in one line each and begin. Do not ask again about things already settled.
9. If a new blocking unknown appears mid-task, ask it then, with the same format: options, default, and why it matters.

## Gotchas

- Asking what the codebase already says shows you did not look. Search first.
- Question after question over many turns frustrates people. Batch them.
- A question with no default forces the user to design the answer. Propose one.
- "Anything else?" at the end of a batch invites a long, vague reply. Skip it.
- Do not use questions to avoid deciding. Make the calls that are yours to make.
- For risky actions, ask even when the user seems impatient. The cost of a wrong guess is theirs.

## Output

- The questions asked, each with options and a default.
- The assumptions stated for everything not asked.
- The decisions recorded after the answers came back.
- Any question you held back for a later follow-up.
