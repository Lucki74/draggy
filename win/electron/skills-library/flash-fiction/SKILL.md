---
name: flash-fiction
description: Writes a complete story at a hard word limit, built on one moment, one change and an ending that lands without explanation. Use when the user says "write flash fiction", "a story in 500 words" or "a very short story".
---

# Flash fiction

## Goal

Deliver a whole story in very few words. A good piece picks one moment, implies the rest, ends on an image or a choice, and meets the stated word count exactly.

## When to use

- The user wants a story of a few hundred words or up to 1,000.
- A contest or magazine sets a strict word limit, such as 100 or 250 words.
- The user wants to compress a longer draft to its core.

For longer stories, use `use_skill` with `story-writer`. For prompts to start from, use `writing-prompt-generator`. For just the opening, use `opening-lines`.

## Steps

1. **Fix the limit.** Call `ask_user` for the exact word limit, whether a title counts, the genre, the tone and any required element. Contest rules override defaults, so ask for them or read them with `read_url`.
2. **Find the moment.** Choose one scene or turn: a decision at a door, a phone call, a last meal. Everything outside it is implied. Do not tell a life story.
3. **Pick a character with a want.** One person, one want, one obstacle. Two characters at most, three if one is a voice on a phone.
4. **Plan the change.** Write one sentence: "At the start she thinks X, at the end she knows Y." If the change is only a twist in the facts, give it an emotional cost too.
5. **Open in motion.** The first sentence should start in the middle of something. No weather, no waking up, no setting description alone.
6. **Draft long, then cut.** Write 20 to 30 percent over the limit. Cut explanations, adverbs, doubled adjectives, throat-clearing and any line that repeats an image.
7. **Choose detail with care.** Use two or three exact details that suggest the whole world. Names of things beat adjectives.
8. **Land the ending.** End on an image, an act or a line of speech that opens meaning. Do not explain the point. Check that the ending is set up earlier.
9. **Count the words.** Use `run_code` with a short script to count words in the final text, including or excluding the title as the rules say. Do not count by eye.
10. **Write the title last.** Let it add meaning the text does not give, rather than repeating a line.
11. **Read it as a stranger.** Check that the reader can tell who is speaking, where they are and what is at stake by the third sentence.
12. **Offer a trimmed version.** If the user may need a shorter limit later, provide a version with 20 percent fewer words.

## Gotchas

- Summarizing a long plot in 500 words reads as a synopsis. Choose one scene and let the rest sit offstage.
- A twist that depends on hiding a fact the narrator would know cheats. Plant a fair clue.
- Counting words by hand drifts. Hyphenated words and numbers differ between counters, so say which rule you used.
- Dialogue-heavy pieces run over quickly. Cut tags and greetings.
- Ending with a moral or a thought explaining the story weakens it. End one beat earlier.
- A piece that fits exactly but reads rushed is worse than a lean piece under the limit. Aim for the limit but do not stuff.
- Names for every minor person eat the count. Use one or two names and call the rest by role.
- Present tense and second person can add flavor but also fatigue. Use them only if the voice needs them.

## Output

The story with its title, then one line stating the final word count and how it was counted. If the user asked for options, give one alternative ending in a separate block. No commentary on technique.

If the story is for a contest, remind the user to check the entry rules on formatting and word count before sending.
