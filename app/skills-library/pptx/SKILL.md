---
name: pptx
description: Creates PowerPoint slide decks (.pptx) with create_file from styled HTML (background colors, tables, custom fonts) or from a Markdown outline. Use when the user asks for slides, a presentation, a deck, a pitch or a .pptx file.
---

# PowerPoint decks (.pptx)

## Goal

Produce a .pptx file whose slides each carry one idea, read cleanly and need no repair. Draggy builds the file with `create_file` from either HTML (styled decks, colors, fonts, tables) or Markdown (plain text outlines).

## When to use

- The user wants slides, a presentation, a deck or a .pptx file.
- For a written document instead of slides, use `use_skill` with `docx` or `report`.
- For a spoken talk script, use `use_skill` with `speech-writer`.

## Steps

1. Establish audience, purpose (inform, persuade, teach, report) and length. Default to 8 to 12 slides.
2. Plan the storyline before writing slides: title, problem or context, key points (one per slide), evidence, recommendation or summary, next steps.
3. State each slide's idea in its title, as a short sentence where possible ("Costs fell 18% after the switch"). Give each slide three to five bullets of about 12 words or fewer.
4. Choose the format. Use HTML when a slide needs a table, colored accents or a dark title slide. Use Markdown for a simple text outline.
5. For HTML, put each slide in a `<section>` or `<div class="slide">`:
   - Background: `<section style="background-color: #0f172a">`.
   - Titles: `<h1>` or `<h2>`, styled for example `<h1 style="color: #38bdf8; font-size: 28pt">`.
   - Bullets: `<ul><li>`.
   - Text styling: `color`, `font-size`, `font-weight`, `font-style` and `text-align` are honored.
   - Tables: a `<table>` inside a slide becomes a native PowerPoint table with headers and styled rows.
6. For Markdown, follow the outline rules:
   - Every heading line, at any level, starts a new slide and becomes its title.
   - A line holding only `---` also separates slides.
   - Lines under a heading are the body, and `- item` becomes a bullet.
   - Make the first slide a `#` heading with the deck title and one line below it for subtitle, presenter or date.
   - Read the [outline example](outline-example.md) with `use_skill` and file "outline-example.md" for a complete small deck.
7. Close with a summary or a clear call to action, and optionally a "Questions" slide.
8. Save with `create_file` as a .pptx.

## Gotchas

- A Markdown slide holds at most 12 body lines. Past that the converter adds a slide titled "(cont.)", which looks unplanned, so keep every slide well under 12 lines.
- Markdown slides are text only. Bold and italic markers are not interpreted, so use HTML when emphasis matters.
- Dense paragraphs on a slide are the usual failure. Split the idea across slides instead.
- The .pptx cannot hold speaker notes through this route, so do not promise them inside the file.
- A heading used for anything other than a slide title, such as a section label in the body, creates an unwanted slide in Markdown.

## Output

Give the file name, the slide count and the slide titles as a numbered list. Offer to write speaker notes as a separate document.
