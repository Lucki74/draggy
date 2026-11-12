---
name: essay-feedback
description: Reviews a student's essay for argument, structure, evidence and style against the assignment brief, and gives feedback in priority order with short examples from the text, teaching the writer instead of rewriting for them. Use when the user asks for feedback on an essay, asks how to improve a paper, or wants a check before submitting.
---

# Essay feedback

## Goal

Tell the writer what is working, what limits the essay most, and how to fix it, so the next draft is theirs and better. Feedback is ranked: big issues first, sentence issues last.

## When to use

- The user shares a draft essay, report or paper and wants an honest reading.
- The user has an assignment brief or marking criteria and wants the draft judged against it.
- The user wants prose polished for clarity only: use `use_skill` with `clarity-edit`.
- The user wants a strengthened argument in any text: use `argument-strengthener`.

## Steps

1. **Get the brief.** Use `ask_user` for the assignment question, word limit, level, marking criteria and what feedback they want. Read the draft with `read_file`.
2. **Read once for the whole.** Without marking, write the thesis in one sentence as you understand it. If you cannot, that is the first finding.
3. **Check the answer to the question.** Compare the draft with the brief. Does it answer what was asked, or a nearby question?
4. **Map the structure.** Write one line per paragraph saying what it does. Look for paragraphs that repeat, drift or sit in the wrong order.
5. **Test the argument.** For each main claim, check that reasons and evidence support it, and that counterarguments are met. Mark claims with no support.
6. **Check the evidence.** Are sources named, relevant and used rather than just quoted? Check that quotes are explained. For facts you doubt, verify with `search_web` and tell the writer.
7. **Read the prose.** Note patterns, not every slip: long sentences, unclear pronouns, repeated openers, informal register. Cite two or three examples for each pattern.
8. **Rank the findings.** Sort into must fix (answers the question, thesis, structure, evidence), should fix (transitions, depth) and polish (style, grammar).
9. **Write the feedback.** Start with one real strength. Then give the top three issues, each with a quote from the draft, why it matters and one way to fix it. Close with a short list of polish points.
10. **Offer the next step.** Invite a revised draft or ask the writer to rewrite one paragraph using the advice.
11. **Check the word limit.** Report the count against the limit and point to the paragraph that can lose the most.

## Gotchas

- Rewriting paragraphs for the writer fixes the essay and teaches nothing. Show one example and let them do the rest.
- Starting with typos buries the argument problems that cost more marks. Keep polish for last.
- Marking against your taste instead of the criteria misleads. Use the brief's own terms.
- Academic integrity: improve the writer's own work. If asked to write the essay, say you will help plan and review instead.
- Praise must be specific and true. Empty praise lowers trust in the rest.
- Citation styles differ by course. Ask which one applies before correcting references.
- Non-native writers need feedback on argument first too. Keep language notes to patterns, and keep the tone respectful.

## Output

A short summary line of the overall judgement, then Strengths, Top issues (each with quote, reason, fix) and Polish points. Use headings in a file and plain paragraphs in chat. Keep it under 500 words unless the draft is long.
