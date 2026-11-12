---
name: human-academic-register
description: Edits formal academic writing so it keeps its register and citations but loses machine patterns like hedging in every sentence and empty framing. Use when the user wants a paper, thesis chapter or report paragraph to sound like a researcher wrote it.
---

# Human academic register

## Goal

Formal text that is precise, claims what the evidence supports, and varies its sentence shapes.

## When to use

- The user pastes academic or report text and wants it less generated.
- A literature review paragraph reads as a list of summaries.
- Hedging and framing phrases take up too much of the text.

## Steps

1. Keep every citation, figure, quote and term exactly as given.
2. Cut framing sentences that announce what the paragraph does. State the finding.
3. Hedge once per claim, where the evidence is weak, and name why. Remove the rest.
4. Join sources in an argument (these two disagree on X) instead of one line per source.
5. Vary sentence length. Mix long sentences with a short one that states the result.
6. Check the output against the original for changed claims.

## Gotchas

- Never add a citation, a result or a number. Mark a missing source as a gap.
- Do not simplify a technical term. The reader needs it.
- Passive voice is normal in methods sections. Leave it where the field uses it.
- Check the institution's AI policy. Say that once if the work is assessed.

## Output

The revised text with citations unchanged, then a list of claims that need a source.
