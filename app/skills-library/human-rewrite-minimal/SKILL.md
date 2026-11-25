---
name: human-rewrite-minimal
description: Edits a draft lightly: removes clear machine patterns and leaves the author's wording, length and structure alone. Use when the user says to keep their text mostly as it is, or only fix what sounds like AI.
---

# Human rewrite minimal

## Goal

Change as little as possible. The draft is mostly the user's, and the job is to take out the parts that are not.

## When to use

- The user has a draft that is mostly theirs with some machine-sounding parts.
- The text must keep its length and structure within 10 percent.
- The user asks for a light touch.

## Steps

1. Read the draft and mark only unambiguous patterns from `tells.md` in the `human` skill: stock phrases, a summary closer, an aphorism on every paragraph, pairs like not-just-X-but-Y.
2. Fix each by deleting or restating it plainly. Do not reword sentences that have no marked pattern.
3. Keep facts, numbers, names, quotes and formatting exactly.
4. Return the edited text, then list each change in one line: what was removed and why.

## Gotchas

- Changing more than 10 percent of the words means the edit is no longer minimal. Stop and say so.
- Do not even out the rhythm of a draft that is uneven already. Uneven is the goal.
- A phrase can be the author's own habit. If it appears three times or more, ask before cutting it.

## Output

The edited text, then a list of changes, one line each.
