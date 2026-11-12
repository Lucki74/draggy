---
name: content-repurpose
description: Turns one source piece such as an article, talk or video into a set of native pieces for other channels, each reshaped for its format, accurate to the source and scheduled apart. Use when the user asks to repurpose content, turn a post into social posts, an email and a script, or get more from one piece.
---

# Content repurpose

## Goal

A set of pieces drawn from one source, each written for its channel rather than pasted, each faithful to the source's facts and each with its own angle and timing. The source stays the reference for accuracy.

## When to use

- The user has a strong article, webinar, podcast, report or video and wants wider reach.
- The user is short on time and wants multiple outputs from one idea.
- For a single social post, use `use_skill` with `social-post`.
- For a short video from the material, use `use_skill` with `video-script-short`.
- For an email version, use `use_skill` with `newsletter`.

## Steps

1. Ask with `ask_user` for the source (file, text or link), the channels in use, the audience on each, the goal and any rules on tone or length. Read the source with `read_file` or `read_url`. For audio or video, ask for a transcript.
2. Summarize the source in three lines: the main point, the strongest supporting ideas and the best examples or data. Mark claims that need the source's context to stay true.
3. Pull the raw material: quotes, numbers, steps, stories, counterintuitive points, definitions, common questions. Note where each sits in the source.
4. Map material to channels. A thread suits steps and arguments, a short post suits one sharp idea, an email suits a story with a link, a carousel suits a list, a script suits a demonstration, a Q&A suits questions the source answers.
5. Choose the number of pieces by value. Three strong pieces beat ten thin ones. Each piece gets a distinct angle, not a shorter copy of the same text.
6. Write each piece natively: the opening line, length, tone and call to action all suit the channel. Link back to the source where it helps the reader.
7. Check accuracy against the source. Numbers, quotes and conclusions must match, and context removed by cutting must not change the meaning. Cite the source in each piece when the claim needs it.
8. Check for rights: images, quotes from others and guest contributions may need permission for reuse.
9. Spread the release across days or weeks, with the first piece on the source's publish day if timely. Suggest gaps so audiences who follow several channels do not see all of it at once.
10. Plan a review: which pieces drew replies or clicks, and which formats to repeat.

## Gotchas

- Copy-pasting the same text across channels reads lazily and performs poorly. Reshape each piece.
- Cutting a claim for length can turn it false. Recheck against the source.
- Posting everything at once burns the topic. Stagger it.
- Old pieces may contain outdated facts. Verify before repurposing, using `search_web` where facts change.
- Repurposed material still needs a reason to exist. Skip channels where the audience does not care.
- Credit guests and sources.
- Hosts of a talk or podcast may own the recording. Check who can approve reuse.

## Output

A plan table (piece, channel, angle, source section, publish date), followed by the drafted pieces and a list of items to verify.
