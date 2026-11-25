---
name: clarity-edit
description: Edits a draft so each sentence and paragraph says one thing plainly, fixing structure first and wording second while keeping the author's voice and meaning. Use when the user asks to make writing clearer, says a paragraph is confusing, or wants an edit for clarity.
---

# Clarity edit

## Goal

A reader gets the point on the first pass. A good result keeps what the author meant and how they sound, and changes only what blocks understanding: buried points, tangled sentences, vague nouns and missing links between ideas.

## When to use

- The user says a passage is confusing, dense or hard to follow.
- A draft needs a clarity pass before it goes to readers.
- For typos and grammar only, use `use_skill` with `proofreader`.
- For a different register, use `use_skill` with `tone-rewriter`.
- For cutting length, use `use_skill` with `shorten-text`.

## Steps

1. Read the whole text with `read_file` (or from the message) before changing anything. Ask who reads it and what they should do afterwards. If the user cannot say, `ask_user` once.
2. State the point of the piece in one sentence, in your notes. If you cannot, the problem is structure, and the fix is a reorder, not a rewrite of sentences.
3. Check structure first. Does each paragraph carry one idea, and does its first or second sentence say it? Move the point forward when it sits at the end. Split paragraphs that hold two ideas.
4. Then the sentences. Find the subject and the verb of each long sentence. If the real action hides in a noun ("make a determination of"), put it back into a verb ("determine"). Split a sentence when it has more than one main claim.
5. Replace vague words with the thing meant: "this", "it", "the process", "various issues". Where the antecedent is more than a sentence away, name it again.
6. Check the links between sentences. Each should follow from the one before, using the old fact first and the new fact last. Add a connector only when the logic needs one.
7. Keep the author's habits that are not errors: sentence length range, contractions, first person, humor. Do not impose a house style they did not ask for.
8. Edit in place with `edit_file` when the text is a file, keeping a copy of the original in the reply or a `.orig` file only if asked. In chat, return the revised text.
9. Compare against the original for meaning. For each changed sentence ask whether a claim was added, dropped or strengthened. Revert those changes.
10. Read the result aloud in your head from the top. A sentence you stumble on is still unclear; fix it again.
11. For text over a few pages, work in sections and re-check the links between sections last.

## Gotchas

- Smoothing can change meaning. "May reduce" turned into "reduces" is a content edit. Keep every hedge, number and condition the author wrote.
- Clarity problems are usually structural. Rewording a paragraph whose point is missing produces a smoother paragraph that still has no point.
- Shortening is a side effect, not the aim. If a sentence needs the extra words to be understood, keep them.
- Terms of art are not jargon to the right reader. Check the audience before swapping a precise term for a vaguer common one.
- Do not apply a rule of thumb blindly, such as no passive voice. Passive is right when the actor is unknown or unimportant.
- Editing the author into a generic voice is the commonest complaint. If every paragraph now sounds the same, undo some of it.
- Acronyms and shorthand the author knows by heart are the commonest hidden obstacle. Expand them once if the reader may not share them.
- A list of questions the draft raises but does not answer is feedback for the author. Report it; do not fill it with guesses.
- Edits that make each sentence shorter can make the paragraph worse by removing the links. Judge at paragraph level.
- If the author wrote in a regional spelling or dialect, keep it unless asked.
- Readers differ. Clear for an expert may be dense for a newcomer; settle the audience before the first edit.

## Output

- The revised text, with no preface.
- Then a short list of the structural moves made (point moved up, paragraph split) and any sentence where you were unsure of the meaning, with the question for the author.
- Sentence-level tweaks are not itemised. Show them only when the user asks for a tracked-change style comparison.
