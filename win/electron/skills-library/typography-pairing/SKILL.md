---
name: typography-pairing
description: Chooses a heading and body font pair with a type scale, line height and loading plan for a stated use, after checking licences and weights live. Use when the user asks which fonts go together, what font to use, or for a type scale.
---

# Typography pairing

## Goal

Give a pairing that suits the content and medium, with sizes and spacing the user can apply today. A good result names the fonts, the weights, where each is used, and how they load or embed.

## When to use

- The user is choosing fonts for a site, app, deck, document or print piece.
- The user has a font and needs a partner or a size scale.
- For the colors that go with it, use `use_skill` with `color-palette-builder`.
- For the whole rules document, use `use_skill` with `style-guide-builder`.

## Steps

1. Ask with `ask_user` what the text is (long reading, UI labels, headlines), the medium, the tone in two words, the languages and scripts needed, and any font already fixed by a brand.
2. If the project exists, run `search_files` for `font-family` and `@font-face` to see what is already loaded. Reuse before adding.
3. Pick the body font first. It needs readable shapes at small sizes, a regular and a bold at least, and the character coverage the languages need. Then pick a heading font that contrasts in one way only: structure (serif with sans), width, or weight. Two display faces together fight.
4. Check live with `search_web` and `read_url` that each font exists in the weights chosen, what its licence allows (web embedding, app embedding, print), and whether it is free. Do not quote licences from memory.
5. Set a scale with `run_command` or by hand: a base size, a ratio such as 1.2 or 1.25, rounded to whole pixels. Give line height for body (about 1.4 to 1.6) and tighter for headings, plus a line length target near 45 to 75 characters.
6. Add a system fallback stack that matches the metrics, and a loading note: preload the body font, use `font-display` swap or optional, and subset if only some scripts are needed.
7. Write the CSS with `create_file` or `edit_file` if the user asks.
8. Build a one-file HTML specimen with `create_file`: a heading, two paragraphs, a list, a button and a small caption in the chosen pair, and view it with `browser_navigate` and `browser_screenshot` at desktop and phone widths.
9. Adjust once from what the specimen shows, usually line height or heading size, and record the final numbers.

## Gotchas

- A font listed without its weights often forces faux bold, which looks smeared. Name the exact weights.
- Pairing by "looks nice" misses coverage. Missing accents or symbols fall back to another face mid-word.
- Free on a font site is not always free for apps, PDFs or commercial use. Read the licence page.
- Tight heading letter spacing that works at 48px hurts at 16px. Set it per size.
- Too many weights slow the page. Two or three are enough for most work.
- Numerals matter in tables and prices. Check that the font has tabular figures if columns of numbers appear.
- Long headings in a wide display face wrap badly on phones. Test the longest real heading, not a placeholder.

## Output

- The specimen file path, so the user can see the pair in a browser.
- Heading and body fonts with weights, source and licence note.
- A size table (name, size, line height, use).
- The fallback stack and loading advice, in a few lines.
- A short reason the pair fits the tone.
