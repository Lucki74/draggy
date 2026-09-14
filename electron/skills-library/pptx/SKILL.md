---
name: pptx
description: Creates PowerPoint slide decks (.pptx) with create_file, using headings and separators that become slides, with concise bullets and speaker-friendly structure. Use whenever the user asks for slides, a presentation, a deck or a .pptx file.
---

# PowerPoint decks (.pptx)

Draggy builds .pptx files with create_file from Markdown. How the Markdown becomes slides:

- Every heading line (`#`, `##`, any level) starts a new slide and becomes its title.
- A line containing only `---` also separates slides.
- Lines under a heading become the slide body. `- item` becomes a bullet (•).
- A slide holds at most 12 body lines. Beyond that the converter starts a continuation slide titled "(cont.)", which looks unplanned, so keep every slide well under 12 lines.
- Text only: no images, charts, tables, speaker notes or layouts. Bold and italic markers are not interpreted in slides, so do not use them.

## Designing the deck

1. Establish audience, purpose (inform, persuade, teach, report) and length. Default: 8 to 12 slides.
2. Plan the storyline before writing slides: title → the problem or context → key points (one per slide) → evidence → recommendation or summary → next steps.
3. One idea per slide, stated in the title as a full short sentence where possible ("Costs fell 18% after the switch" rather than "Costs").
4. Three to five bullets per slide, each under about 12 words. No paragraphs.
5. Put numbers on slides rather than adjectives.
6. End with a summary or a clear call to action, and optionally a "Questions" slide.

## Layout of the Markdown

See outline-example.md for a complete small deck (read it with use_skill, file "outline-example.md"). Title slide first: a `#` heading with the deck title and a single line below it with the subtitle, presenter or date.

## After creating

Give the file name, the number of slides, and the slide titles as a numbered list. Offer to add speaker notes as a separate document, since the .pptx cannot hold them.
