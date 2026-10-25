---
name: brand-guidelines-outline
description: Outlines a short brand guidelines document with voice, logo use, color, type, imagery and example rules, using only decisions the user has made. Use when the user asks for brand guidelines, a brand book, or to document how the brand should look and sound.
---

# Brand guidelines outline

## Goal

Produce a lean outline of brand rules that a new designer, writer or contractor can follow without asking. Every rule is either decided by the user or marked as open.

## When to use

- The user has a brand and wants the rules written down.
- A team keeps getting inconsistent logos, colors or tone and needs one reference.
- For the logo itself, use `use_skill` with `logo-brief`. For voice alone, use `use_skill` with `brand-voice-guide`.

## Steps

1. Collect what exists. Use `list_directory` and `search_files` for logos, fonts, CSS tokens and past decks if files are available, then `read_file` the key ones. Ask with `ask_user` for anything that lives elsewhere.
2. Sort findings into decided, used but undocumented, and missing. Only the first two go in as rules. The third becomes an "Open decisions" list.
3. Draft sections in this order: purpose and audience, personality in three words, voice and tone (with two before and after sentences), logo (versions, clear space, minimum size, misuse), color (roles and values), typography (families, sizes, usage), imagery (subject, crop, treatment), layout basics, and contact for questions.
4. For each rule write a do and a don't. A rule with no counter-example gets ignored. Describe the examples in text if images are not available, and name the file to add.
5. Keep length in check: aim for 4 to 8 pages of content. Move long tables to an appendix.
6. Save with `create_file` as `brand-guidelines.md`. Before saving, check that every color, font and size appears exactly as in the source files, using `search_files` to confirm.
7. End with a maintenance note: who owns the document and when it is reviewed. Leave the owner blank if unknown.
8. Add a one-page quick reference at the top: logo, two main colors, two fonts, three voice rules. Most readers stop there.
9. Ask the user to test the draft by giving it to someone unfamiliar with the brand, and list what that person got wrong.

## Gotchas

- Copying values from memory of the brand produces slightly wrong hex codes. Read them from the source.
- A section for "brand story" with invented history is fiction. Use only what the user told you.
- Rules that cannot be checked ("be bold") do not guide anyone. Pair them with a concrete test.
- Guidelines written for designers fail with sales staff. Put the three most used rules on the first page.
- Do not include trademark or licence claims. Leave those to the user.
- Digital and print values differ. Record which medium each color value is for.
- Imagery rules need real examples. A line like "authentic photos" fails without two sample images and one counter-example.
- Locked rules age. Date the document and name a place where changes are logged.

## Output

- The quick reference page as the first section.
- `brand-guidelines.md` with the sections above and an "Open decisions" list.
- A short note on which sections are thin and what input would fill them.
