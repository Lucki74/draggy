---
name: image-prompt-writer
description: Writes and refines prompts for image generation with a clear subject, setting, style, composition and exclusions, then generates drafts and adjusts from the results. Use when the user asks for an image prompt, wants a picture generated, or is unhappy with generated images.
---

# Image prompt writer

## Goal

Get an image close to what the user has in mind in few rounds. The prompt describes things a viewer could see, in an order that puts the important parts first.

## When to use

- The user wants a picture, illustration, texture, concept art or placeholder image generated.
- The user has a prompt that gives messy results and needs it fixed.
- For logo directions, brief first with `use_skill` and `logo-brief`. For a thumbnail, use `use_skill` with `thumbnail-brief`.

## Steps

1. Ask with `ask_user` what the image is for, where it will appear, the aspect ratio and whether people, text or brand elements are involved. Ask what it must not contain.
2. Write the core sentence: subject, action, setting. "A lighthouse keeper repairing a lantern at dusk, rough stone tower, rain on the glass."
3. Add the visual layer in this order: style or medium (photograph, watercolour, flat vector), camera or viewpoint (wide, close-up, overhead), lighting, color mood, and level of detail. Use plain words a person would use.
4. Add composition: where the subject sits, empty space for text if the image will carry a headline, background simplicity.
5. Add exclusions as a short list of things to avoid, phrased as the tool expects. Check the tool's own docs with `read_url` or `search_web` if the syntax is unclear, since tools differ.
6. Generate a draft with `generate_image` using the prompt. Look at the result, name two things that are wrong, and change only those parts of the prompt. Repeat up to three rounds, then report the best version and the prompt that made it.
7. Save the final prompt with `create_file` if the user wants to reuse it.
8. If the image must match a set (same character or style across several pictures), keep a fixed style sentence and reuse it word for word, changing only the scene part. Check whether the tool offers a reference-image or seed feature in its docs.
9. Before delivering, look for artifacts: extra fingers, garbled signs, odd reflections, logos that look like real brands. Regenerate or crop around them.

## Gotchas

- Long lists of adjectives dilute each other. One clear scene beats twelve styles.
- Generated lettering is unreliable. Add real text afterwards in a design tool.
- Naming a living artist or a brand to get their look raises ethical and legal issues. Describe the qualities instead (flat shapes, muted ochre palette).
- Hands, small objects and counts of things often fail. Change the framing so they matter less.
- Changing five parts between rounds hides which change helped. Change one or two.
- Check the terms of the tool for commercial use before the user publishes the result.
- Aspect ratio in the prompt text is often ignored. Set it in the tool's size option instead.

## Output

- The artifact check result in a line.
- The final prompt in a code block, with the exclusions line.
- A short note on what each round changed.
- The saved image path or file path, and any usage caveat.
