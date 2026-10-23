---
name: moodboard-brief
description: Defines the feeling, keywords, reference types and board structure for a moodboard before any images are gathered, and annotates what each reference is for. Use when the user asks for a moodboard, visual references, or help finding a direction.
---

# Moodboard brief

## Goal

Turn a vague feeling into a board with a point of view. The user ends with a list of keywords, what to look for, how to group it, and a way to say what each reference contributes.

## When to use

- The user is starting a visual project and cannot yet explain the look.
- A client or teammate needs to agree on direction before design starts.
- For writing the logo or identity brief afterwards, use `use_skill` with `logo-brief`.
- For critiquing finished work, use `use_skill` with `design-critique`.

## Steps

1. Ask with `ask_user` for the project, the audience, what it should make people feel, and three things it must not look like. Ask for any image the user already loves or hates.
2. Turn feelings into eight to twelve concrete keywords: materials, light, era, texture, subject, motion. "Warm" becomes "late afternoon light, linen, brass".
3. Pick four to six board panels: color, texture and material, type and lettering, photography or illustration style, layout and composition, and one for things to avoid.
4. For each panel list what to search for and in which places (stock sites, museum archives, design galleries, the user's own photos). Use `search_web` to check that the sources exist and note their reuse terms; do not assume a free image is free for commercial use.
5. If the user supplies images in a folder, run `list_directory` and `read_file` to view them, then group them into panels and flag outliers.
6. Add a one-line note per reference: "borrow the spacing, not the color". Without that note the board is only decoration.
7. Write the brief with `create_file` as `moodboard-brief.md`. If the user wants generated images as stand-ins, use `use_skill` with `image-prompt-writer` and mark them as placeholders.
8. Run a cull pass: for each panel keep the strongest four to six items and remove anything that repeats another. Ask the user which three items feel most right and which feel wrong, and update the keywords from the answer.
9. Summarise the direction in one paragraph the user could read aloud to a client or designer.

## Gotchas

- Boards built from the first thirty search hits look like everyone else's. Add one unexpected source on purpose.
- Mixing eras or cultures by accident sends a wrong signal. Name the era for each panel.
- A board of twenty strong, unrelated images has no direction. Cut until each panel has a single clear idea.
- Screenshots of other designers' finished work are for learning, not for copying. Say so when the output will be shown to a client.
- Keep a source list. Images without a source cannot be cleared later.
- Reference photos carry their own color grade. Say whether the color is meant to be borrowed or only the composition.
- A board shared with a client is read as a promise. Label it as direction, not final design.

## Output

- The one-paragraph direction statement at the top.
- Keywords, panels, search leads and per-reference notes in `moodboard-brief.md`.
- A source and reuse-terms list with gaps marked.
- Three questions the user should answer once the board exists.
