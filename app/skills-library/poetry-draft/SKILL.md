---
name: poetry-draft
description: Drafts and revises a poem from a seed image, feeling or chosen form, with concrete language, controlled sound and line breaks that carry meaning. Use when the user says "write a poem about", "help me draft a poem" or "turn this into a sonnet".
---

# Poetry draft

## Goal

Produce a poem that has one clear centre and earns its lines. A good draft uses images the reader can see, sound that fits the mood, line breaks that mean something and an ending that opens instead of explains.

## When to use

- The user wants a poem for a subject, person or occasion.
- The user has a draft in free verse or a fixed form and wants it revised.
- The user wants to try a form such as haiku, sonnet, villanelle or ghazal.

For song text meant to be sung, use `song-lyrics`. For a toast or a spoken tribute, use `toast-writer`. For comic verse, use `joke-and-humor-writer`.

## Steps

1. **Find the seed.** Call `ask_user` for: the subject, one memory or image tied to it, the mood, who it is for and whether a form is wanted. If a draft exists, call `read_file`.
2. **Collect concrete material.** Ask for three specific nouns or moments, such as a coat on a hook or the sound of a kettle. Generic words (love, pain, time) come after the images, if at all.
3. **Choose the form.** Free verse by default. If the user names a form, check its rules: for a sonnet, count lines and the rhyme scheme; for a haiku, remember that English syllable counts are conventions and may be loosened. If unsure of a form's rules, use `search_web`.
4. **Draft the first version fast.** Write it from the images. Do not rhyme yet unless the form needs it.
5. **Shape the lines.** Break lines where a breath, a turn or an emphasis falls. Try ending lines on strong nouns and verbs. Avoid ending on "the", "and" or "of" unless deliberate.
6. **Tune the sound.** Read aloud. Look at repeated vowels and consonants, and cut accidental echoes. If rhyming, use slant rhyme where an exact one bends the sense.
7. **Cut.** Remove explaining lines, adjectives that duplicate the noun and any line that states the feeling the image already shows. Cut the last line if it only sums up.
8. **Find the turn.** A poem usually shifts: a new image, a reversal, a question. Make sure it exists and sits late, not at the start.
9. **Give a second option.** Offer a short alternative: another form, another title or another ending, in a separate block.
10. **Test the title.** Try two or three titles that add information to the poem. Choose the one that changes how the first line reads.
11. **Read the poem cold.** Leave it, then read it as a stranger. Mark any line a stranger would not follow and fix the clearest one.

## Gotchas

- Forcing a rhyme produces odd word order and filler. If the line sounds wrong spoken aloud, change the rhyme, not the sense.
- Abstract words tell the reader what to feel. Concrete images let them feel it.
- Titles can do work. Do not waste one by repeating the first line.
- Archaic diction ("thy", "o'er") reads as pastiche unless the form calls for it.
- A poem about a real person's death or illness needs care. Ask the user what is acceptable to include, and do not invent biographical facts.
- Copying phrases from famous poems is easy by memory. Avoid recognizable lines and check anything that sounds familiar.
- Using the same sentence pattern in every stanza makes the poem sing-song. Vary the length of at least one stanza.
- Ending on a big abstract claim (love is, time will) undoes the images. Stop on the last image.
- Asking the reader to cry through adjectives never works. Let the facts do it.

## Output

The poem with a title, no preamble. Then two or three lines naming the form used, the central image and one choice the user might change. Save with `create_file` on request only.

If a form was requested, state the rule it follows and where you bent it.
