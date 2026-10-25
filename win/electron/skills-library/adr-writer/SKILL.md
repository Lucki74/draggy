---
name: adr-writer
description: Writes an architecture decision record that captures context, the options considered, the decision and its consequences, and files it where the project keeps its decisions. Use when the user asks to document a technical decision, write an ADR, or record why a choice was made.
---

# Architecture decision records

## Goal

Capture one decision so a developer a year from now can see what was chosen, what else was on the table, and what the choice costs, without asking anyone. One record per decision, short, dated, and never silently rewritten.

## When to use

- A choice was just made (framework, storage, protocol, boundary) and the reasoning would be lost.
- The user says "write an ADR", "document why we chose", "record this decision".
- A past decision is being reversed: write a new record that supersedes the old one.
- A whole system needs describing: use `design-doc`.

## Steps

1. Find the project's convention. Use `list_directory` and `search_files` for folders like `docs/adr`, `docs/decisions` or `architecture`. Read the newest record with `read_file` and copy its template, numbering and tone. If none exists, create `docs/adr/0001-<slug>.md` with a plain Context, Decision, Consequences layout.
2. Take the next free number. List the folder and add one to the highest. Never reuse or renumber.
3. Get the facts. Ask with `ask_user` only for what you cannot find: what was decided, who decided, when, and what the alternatives were. Read the code or PR discussion for evidence of the current state.
4. Write Context: the forces at play, in a few sentences. Constraints, deadlines, what hurts today, what the team knows. Stay neutral and factual.
5. List the options considered. Give each at least two real sentences with its strongest argument and its main drawback. Include "do nothing" if it was a candidate. Check any claim about a tool's capability against its docs with `read_url` if it matters to the choice.
6. State the Decision in one active sentence: "We will use X for Y."
7. Write Consequences, both kinds: what gets easier and what gets harder or more expensive. Include follow-up work, migration steps and what would trigger revisiting the decision.
8. Set Status (proposed, accepted, superseded by NNNN) and date. If this replaces an earlier record, edit the old one's status line only with `edit_file` and link both ways.
9. Save with `create_file`. Re-read it as a newcomer: could they explain the decision to someone else from this page alone?

## Gotchas

- Recording only the winner makes the ADR useless later. The rejected options and why they lost are the value.
- Consequences that list only upsides signal that the author did not look. Every decision has a cost; name it.
- Editing an accepted ADR to match what happened later erases history. Write a new record that supersedes it and only change the status of the old one.
- Writing the record after the fact from memory invents reasons. Mark uncertain parts as "reconstructed" rather than inventing a rationale.
- ADRs that cover several decisions at once cannot be superseded cleanly. Split them.
- Do not paste meeting notes. Distil. One page is the target.

## Output

One markdown file in the project's decision folder with title, number, status, date, Context, Options considered, Decision and Consequences. In chat, give the path and a one-sentence statement of the decision.
