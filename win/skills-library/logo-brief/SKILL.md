---
name: logo-brief
description: Writes a one-page logo design brief covering the business, audience, tone, usage places, constraints and deliverables, ready for a designer or an image tool. Use when the user asks for a logo brief, needs a logo, or wants to brief a designer.
---

# Logo brief

## Goal

Replace "I need a logo" with a short brief that lets someone else make good choices. The brief states the problem and the limits. It does not draw the answer.

## When to use

- The user is starting a logo for a business, project, product or event.
- The user is about to contact a designer or a freelancer and has nothing written.
- For the full identity rules after the logo exists, use `use_skill` with `brand-guidelines-outline`.
- For references to collect first, use `use_skill` with `moodboard-brief`.

## Steps

1. Run `ask_user` with a compact set of questions: what the organisation does in one sentence, who it serves, three words for the personality, three words it must not feel like, the name exactly as spelled, and any tagline.
2. Ask where the logo will appear: favicon, app icon, social avatar, invoice header, signage, merchandise, one-color print. This list drives the technical limits.
3. Ask for what already exists: old logo, colors, fonts, names of brands the user admires and the reason for each. Reasons matter more than the names.
4. Ask about competitors in the same space and what the user wants to look different from. Use `search_web` for a quick look only if the user does not know them.
5. Write the constraints: must work in one color, must read at 16px, needs a horizontal and a stacked version, no use of certain symbols, cultural meanings to avoid.
6. Draft the brief with `create_file` as `logo-brief.md`: background, audience, personality, do and don't, usage list, deliverables (vector master, light and dark versions, icon-only version, clear space note), timeline and budget placeholders.
7. Offer a next step: pass it to a designer, or turn it into image prompts with `use_skill` and `image-prompt-writer` for rough exploration.
8. Add an evaluation list the user can score proposals against: reads at small size, works in one color, fits the personality words, differs from the competitors named, can be reproduced cheaply.
9. Check the name for trademark conflicts only by pointing the user to the official trademark search of their country. Do not claim a name is clear.

## Gotchas

- Briefs that say "modern, clean, professional" say nothing. Ask for the opposite pair to force a real position.
- Asking for a logo that looks like a named brand invites a copy and legal trouble. Capture the quality admired, not the mark.
- Skipping the smallest use case leads to a detailed mark that turns to mush as a favicon.
- Image generators do not produce reliable text. Treat generated marks as sketches and have the wordmark set in a real font.
- Do not fill in budget or dates. Leave visible blanks for the user.
- Asking for "something timeless" tells a designer nothing. Ask which existing marks feel dated and why.
- Rights matter. The brief should say who owns the final files and that source files are part of the delivery.

## Output

- The evaluation list at the end of the brief.
- `logo-brief.md` of about one page, with the sections above.
- A short list of open questions the user still owns.
- Nothing about colors or shapes beyond the user's own stated preferences.
