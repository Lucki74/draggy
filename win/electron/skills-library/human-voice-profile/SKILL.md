---
name: human-voice-profile
description: Builds a short written profile of how the user writes, from samples they wrote themselves, and saves it for later rewrites. Use when the user wants Draggy to learn their voice, or before using the human skills on a long text.
---

# Human voice profile

## Goal

Capture how one person writes in a file the other human skills can read, so each rewrite starts from their voice and not from a default.

## When to use

- The user wants their writing style remembered or described.
- A sample of their own writing is available (300 words or more, 1,000 is better).
- Another human skill needs a profile and none exists.

## Steps

1. Ask for samples the user wrote with no AI help. Different genres give a better profile: an email, a post, a longer piece.
2. Read `metrics.cjs` in the `human` skill and run it on each sample with `run_command`. Note the sentence length spread, the share of sentences near the mean, and the paragraph shapes.
3. Read the samples for habits the numbers miss: favorite plain verbs, how paragraphs open and end, punctuation (dashes, semicolons, parentheses), contractions, person (I, we, you), humor, and what the writer never does.
4. Write the profile as plain markdown with these headings: Rhythm, Vocabulary, Punctuation, Openings and endings, Never does, Measured numbers. Quote at most one short phrase per heading from the samples.
5. Show the profile and ask what is wrong. Save it with `create_file` as `voice-profile.md` in the folder the user picks.

## Gotchas

- One genre gives a profile that fits only that genre. Say which genres the samples came from.
- Do not save the samples themselves unless the user asks. The profile is a summary.
- A profile built from text the user edited heavily with AI describes the AI. Ask how much of it was theirs.

## Output

A voice profile file, and a two-line summary of what makes the voice distinctive.
