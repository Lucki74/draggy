---
name: pptx
description: Creates PowerPoint slide decks (.pptx) with create_file from styled HTML (with background colors, tables, and custom fonts) or Markdown. Use whenever the user asks for slides, a presentation, a deck or a .pptx file.
---

# PowerPoint decks (.pptx)

Draggy builds .pptx files with create_file from either **HTML** (recommended for styled decks, background colors, custom fonts, and tables) or **Markdown** (for simple text outlines).

## Styled HTML slide decks (Recommended)

Pass HTML with slides separated into `<section>` or `<div class="slide">` blocks:

- **Slide separation:** Each `<section>` or `<div class="slide">` becomes one slide.
- **Slide backgrounds:** Add background color directly: `<section style="background-color: #0f172a">`.
- **Slide titles:** Use `<h1>` or `<h2>` for slide headings. Style with color and size: `<h1 style="color: #38bdf8; font-size: 28pt">`.
- **Bullets:** Use `<ul><li>` for clear, readable bullet points.
- **Text styling:** Support for `color`, `font-size`, `font-weight`, `font-style`, and text alignment (`text-align: center`).
- **Tables on slides:** Include a `<table>` inside any slide section to render native PowerPoint tables with headers and styled rows.

## Markdown slide decks

Pass Markdown text:

- Every heading line (`#`, `##`, any level) starts a new slide and becomes its title.
- A line containing only `---` also separates slides.
- Lines under a heading become the slide body. `- item` becomes a bullet (•).
- A slide holds at most 12 body lines. Beyond that the converter starts a continuation slide titled "(cont.)", which looks unplanned, so keep every slide well under 12 lines.
- Text only: bold and italic markers are not interpreted in Markdown slides.

## Designing the deck

1. Establish audience, purpose (inform, persuade, teach, report) and length. Default: 8 to 12 slides.
2. Plan the storyline before writing slides: title → problem or context → key points (one per slide) → evidence → recommendation or summary → next steps.
3. One idea per slide, stated in the title as a full short sentence where possible ("Costs fell 18% after the switch").
4. Three to five bullets per slide, each under about 12 words. No dense paragraphs.
5. Use HTML when a slide needs a table, colored accents, or a dark background title slide.
6. End with a summary or a clear call to action, and optionally a "Questions" slide.

## Layout of the Markdown

See outline-example.md for a complete small deck in Markdown (read it with use_skill, file "outline-example.md"). Title slide first: a `#` heading with the deck title and a single line below it with the subtitle, presenter or date.

## After creating

Give the file name, the number of slides, and the slide titles as a numbered list. Offer to add speaker notes as a separate document, since the .pptx cannot hold them.
