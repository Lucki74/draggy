---
name: reading-comprehension
description: Walks the user through a hard chapter, article or paper section by section, with a preview, vocabulary support, questions to answer before the explanation and a closing summary in the user's own words. Use when the user says they do not understand a text, asks for help reading a chapter, or wants to get more from a reading.
---

# Reading comprehension

## Goal

Help the user understand a difficult text and keep it. The agent coaches the reading and does not replace it: the user answers first, and the final summary is theirs.

## When to use

- The user pastes or points to a text that is dense, technical or old-fashioned.
- The user reads but cannot say afterwards what the text argued.
- The user wants a quick summary and nothing else: use `use_skill` with `summarizer`.
- The user wants to test recall afterwards: use `quiz-me`.

## Steps

1. **Load the text.** Use `read_file` or `read_url`. Note its length, type (argument, report, narrative, textbook) and where the user has trouble. Use `ask_user` if the trouble is unclear.
2. **Preview.** Show the structure only: headings, first and last paragraphs, any thesis sentence. Ask the user what they expect the text to argue.
3. **Cut into sections.** Divide into chunks the user can read in about five minutes, split at the author's own breaks.
4. **Prepare vocabulary.** Before each chunk, list at most five terms the chunk depends on and give a short plain meaning. Skip words the user knows.
5. **Set a question.** For each chunk, ask one question that the chunk answers, such as "what problem does the author raise here". Let the user read with it in mind.
6. **Read and respond.** The user reads the chunk and answers in their own words. Do not explain yet.
7. **Check against the text.** Compare the answer with what the text says. Point to the sentence where it differs. If the user is right, say so and move on.
8. **Explain only the knots.** Where the user is stuck, unpack the sentence: subject, claim, evidence, link to the previous paragraph. Use a simple example, then ask them to restate it.
9. **Connect the chunks.** After every two or three chunks, ask how the new part relates to the earlier ones.
10. **Final summary.** The user writes the main claim, the three supporting moves and one objection. Offer feedback on gaps against the text.
11. **Plan the reread.** Name the one section worth a second pass and why, so the user rereads with a purpose.

## Gotchas

- Explaining before the user tries turns the session into a lecture. Question first.
- Questions answerable by copying a sentence test locating, not understanding. Ask for a reason, a contrast or an example.
- Old or translated texts hide meaning in word senses that changed. Check the term in context before a modern dictionary.
- An author's thesis often sits at the end. Do not treat the opening as the claim without checking.
- Reading skill grows from repetition. Do not stay at a pace so slow that the user loses the thread.
- If the text is wrong or disputed, say so after the user has followed it. Understanding comes before critique.
- Figures, tables and footnotes carry argument too. Include them in the chunks instead of skipping to the prose.

## Output

Short turns. Each turn gives one chunk task and, after the answer, a brief check. The finish is the user's summary with a few notes on missing points. No unrequested long recap.
