---
name: slide-design-review
description: Reviews the visual design of a slide deck for one idea per slide, hierarchy, legibility, consistency and chart quality, with deck-level patterns and slide-level fixes. Use when the user asks to review slide design, says their slides look bad, or wants a deck critiqued before presenting.
---

# Slide design review

## Goal

Find the design problems that make a deck hard to follow in a room, and give fixes the user can make quickly. The review is about how slides look and read, not whether the argument is right.

## When to use

- The user shares a deck file, a folder of slide images, or an exported PDF and wants design feedback.
- The user is about to present and wants a last pass.
- For general design feedback outside slides, use `use_skill` with `design-critique`. For the story, use `use_skill` with `slide-outline`. For speaker notes, use `use_skill` with `presentation-speaker-notes`.

## Steps

1. Get the slides. Use `list_directory` and `read_file` for exported images or text. For a pptx or pdf, use `run_command` to export pages as images if a converter is installed, otherwise ask the user for exports. Say which slides you could not see.
2. Ask with `ask_user` for the room, the audience and the time: a screen across a hall needs larger type than a document read on a laptop.
3. Take the deck-level pass first. Check for one template, consistent title position, consistent type sizes, a limited palette, and the same style of image and icon throughout.
4. Then the slide pass. For each slide ask: what is the one idea, can it be read in five seconds, what is the largest element and is it the right one. Check body text size (nothing below about 24pt for a live room), line count, contrast against the background, and whether an image sits behind text.
5. Check charts: labelled directly, axes start sensibly, color is not the only differentiator, and the title states the finding.
6. Check practicalities with `search_files` or `read_file`: missing alt text, fonts that may not exist on the presenting machine, low-resolution images.
7. Rank findings: fix first, then fix if time, then taste. Group repeats ("seven slides use paragraphs") into one finding with the slide numbers.
8. Check the opening and closing slides on their own: the title slide should state the topic and speaker, and the last slide should hold the one thing the audience should do or remember, not a bare "Thank you".
9. Suggest one master-slide change that fixes the most slides at once, such as larger body size or a fixed title position.

## Gotchas

- Reviewing only what you can see in text misses layout. Say so if you had no images.
- Decks designed to be read afterwards need more text than a live deck. Ask which it is before calling text-heavy slides wrong.
- Animations and transitions cannot be judged from a static export. Mark them unreviewed.
- Advising a full redesign three hours before a talk helps nobody. Prefer template-level fixes.
- Do not rewrite the content unless the user asks.
- Stock photos with a visible watermark or odd crop undercut trust. Flag them.
- Pasted screenshots of tables are unreadable from the back. Suggest the three numbers that matter instead.

## Output

- The single master-slide change that helps most.
- Three deck-level findings with the single most valuable fix first.
- A slide-by-slide list with number, problem and fix, only for slides that need it.
- A line on what was not reviewed.
