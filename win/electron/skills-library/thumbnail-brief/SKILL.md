---
name: thumbnail-brief
description: Writes a brief for a video or article thumbnail with one focal subject, short overlay text, contrast and small-size tests, plus three distinct concept options. Use when the user asks to design a thumbnail, wants a brief for a cover image, or wants a thumbnail to be more clickable.
---

# Thumbnail brief

## Goal

Produce a thumbnail plan that reads at a glance on a phone and honestly represents the content. The user gets three concepts, exact text, and a way to test them.

## When to use

- The user is publishing a video, podcast episode, article or course and needs a cover.
- An existing thumbnail underperforms and the user wants a rethink.
- For channel-wide sizes, use `use_skill` with `social-graphic-spec`.

## Steps

1. Ask with `ask_user` for the title, the one-sentence promise of the content, the audience, the platform and its current thumbnail size, and any brand colors or recurring style. Ask for existing thumbnails that worked or failed.
2. Pick the single emotion or question the thumbnail raises: curiosity, result, contrast, surprise. State it in one line. It must match something that really happens in the content.
3. Define the focal subject. One face, one object or one before and after pair. Describe its position, crop and expression or action.
4. Write the overlay text: three words or fewer, adding to the title rather than repeating it. Specify weight, size relative to the frame and placement away from the corner where the platform places a duration badge or menu. Check the platform's size and safe area live with `search_web` and `read_url`.
5. Set contrast: subject against background, text against both. Choose a limited palette, and use `use_skill` with `contrast-check` if the pairs are unclear.
6. Write three concepts that differ in idea, not in color. For each, a short description and a prompt for `generate_image` if the user wants rough drafts. Generate drafts only when asked, and leave text off the generated image.
7. Add a test plan: shrink to about the size of a small feed tile and check it still reads, view it next to competing thumbnails, and if the platform offers thumbnail testing, use it.
8. Save as `thumbnail-brief.md` with `create_file`.
9. Plan variants: keep the same layout and swap only one element (text or subject) so a comparison tells you what made the difference.
10. Keep the source layers or a clean version without text, so the thumbnail can be translated or adjusted later.

## Gotchas

- Text that reads on a laptop vanishes on a phone. Test at small size before approving.
- Misleading thumbnails raise clicks and lower trust and watch time. Keep the promise true.
- A busy collage of arrows, faces and badges competes with itself. One focal point.
- Faces of other people need their consent and the right to use the image.
- Do not copy a competitor's thumbnail layout wholesale. Take the principle.
- Comparing results needs enough views to mean anything. Do not call a winner after a few dozen impressions.
- Stock-photo faces with fake emotion read as spam. Use a real frame from the content when possible.

## Output

- A list of the variants to compare and what each changes.
- Three concepts with subject, text, palette and the emotion each aims at.
- The chosen specs: size, safe area, file format.
- A small-size test checklist.
