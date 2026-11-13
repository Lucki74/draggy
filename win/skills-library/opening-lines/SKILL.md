---
name: opening-lines
description: Generates and compares first lines and opening paragraphs for a story, then picks the one that raises a question the story can answer. Use when the user says "write a first line", "my opening is weak" or "give me opening paragraph options".
---

# Opening lines

## Goal

Give a story an opening that makes the reader ask a question and trust the voice. A good opening starts at the point where something is already at stake, sets viewpoint and tone in one move, and promises something the rest of the story delivers.

## When to use

- The user has a story, chapter or scene and the start feels flat.
- The user wants several first-line options to choose from.
- The user wants an opening checked against the rest of the draft.

For whole scenes, use `scene-writer`. For very short fiction, use `flash-fiction`. For a plot map, use `plot-outline`.

## Steps

1. **Read the story or the plan.** Call `read_file` on the draft, or ask with `ask_user` for the premise, the ending and the voice. An opening cannot be judged without knowing what it opens.
2. **Find the promise.** State in one line what the story promises the reader: a mystery, a voice, a relationship, a danger. The opening must start that promise.
3. **List the current opening's job.** Mark what the existing text does: sets weather, introduces a character, gives backstory, makes a joke, poses a problem. Mark what it fails to do.
4. **Write six options with different engines.**
   - A strange or specific claim.
   - A line of speech.
   - A character in action mid-problem.
   - A voice with attitude.
   - A quiet image that hides a wrong note.
   - A statement of fact that reverses on the second sentence.
5. **Extend the best three.** Write a short opening paragraph for each, up to four sentences, with the same story facts.
6. **Test each option.** Ask: what question does it raise? Does the story answer it? Is the tone the same as the ending's? Does it avoid clichés such as waking up, weather, mirrors or "Little did she know"?
7. **Test for honesty.** A shocking hook that the story does not honor feels like a trick. Drop options that overpromise.
8. **Pick one and say why.** Choose the option that best fits promise, voice and ending. Give the reason in two sentences.
9. **Check the second sentence.** The first line gets the reader in. The second must keep them. Make sure it follows from the first.
10. **Offer a swap test.** Suggest the user try starting a paragraph or a scene later than the current start, and delete the original opening, to see if it reads better.

## Gotchas

- A clever first line cannot carry a weak first page. Show the next three sentences before deciding.
- Opening with backstory delays the story. Put it later.
- Starting with a line of dialogue with no context can confuse. Make sure the reader can tell who speaks or why it matters within a few lines.
- Overworked first sentences become showy. Plain and sharp beats ornate.
- Do not borrow the shape of a famous opening and swap nouns. Readers recognize it.
- The best opening for a story may change after the ending changes. Revisit it last.

## Output

The six first lines, the three extended openings, the pick with the reason, and one line on what to check in the draft. Keep it under 450 words unless asked for more.
