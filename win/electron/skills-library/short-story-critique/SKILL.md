---
name: short-story-critique
description: Gives a structured critique of a short story that names what works, what blocks the reader, and the three changes with the most effect, in order of importance. Use when the user says "critique my short story", "give me feedback on my story" or "what is wrong with this draft".
---

# Short story critique

## Goal

Tell the author what the story does now and what to change first. A good critique is specific, ranks its notes, keeps to the author's intent and avoids rewriting the story in the critic's voice.

## When to use

- The user shares a finished or near-finished short story and wants feedback.
- The user is about to submit and wants a last read.
- The user wants a second opinion on a particular worry (ending, pacing, voice).

For line-level proofreading, use `use_skill` with `proofreader`. For rewriting dialogue, use `dialogue-polish`. For restructuring from scratch, use `plot-outline`.

## Steps

1. **Read the whole story first.** Call `read_file` or read the paste once without making notes. Then ask with `ask_user` what the author intended, who the readers are and any specific concerns. If they have none, skip it.
2. **Write the story back in two sentences.** Say what happens and what changes for the protagonist. If you cannot, that is the first note: the story's centre is unclear.
3. **Name what works.** Two or three specific strengths with a line or scene as evidence. Praise must point to something the author can repeat.
4. **Check structure.** Does the opening raise a question? Does each scene raise stakes or change something? Does the ending answer the question the story asked? Mark the scene where the story begins in earnest, which is sometimes later than page one.
5. **Check character and want.** Does the protagonist want something on the page? Do choices, not events, drive the story?
6. **Check voice and viewpoint.** Is the point of view stable? Does the language fit the narrator? Note any slips with a quote.
7. **Check pace and detail.** Find places where the story summarizes what should be a scene, or lingers on what is not needed.
8. **Check the ending.** Does it land through an image or a choice? Is it earned by setup? Does it explain more than it needs to?
9. **Rank the findings.** Choose the three changes that would improve the story most. Order them from large (structure, stakes) to small (wording).
10. **Add a few line notes.** Give up to five line-level examples, only as illustrations of a pattern, each with a suggested approach, not a rewrite.
11. **Offer one reread test.** Suggest the author read the first and last paragraphs together. If they do not answer each other, the opening and ending need to talk.
12. **Check your own notes.** Remove any suggestion that pushes the story toward your taste instead of the author's aim.

## Gotchas

- Fixing sentences when the problem is the shape of the story wastes the author's time. Say structure first.
- Criticizing a choice the author made on purpose (a cold narrator, an open ending) is unhelpful. Judge whether it works, not whether you would have chosen it.
- A list of twenty notes buries the one that matters. Keep to three major notes and a few examples.
- Praise with no evidence reads as filler. Quote the line.
- Do not compare the story to famous works as a verdict. Use comparisons only to explain a technique.
- Genre conventions differ. A romance and a horror story are judged against different promises. Ask the genre.
- A story may be technically fine and still flat. Ask where the reader should feel something and check it happens.
- Reading only for errors misses the pleasures. Note what you enjoyed, too.

## Output

Sections: Summary in two sentences, What works, The three changes (ranked, each with where, why and a way to try), A few line notes, One question for the author. About 400 to 600 words. Tone is direct and kind. No grade out of ten.

If the author asked about one thing only, answer that first and keep the rest short.
