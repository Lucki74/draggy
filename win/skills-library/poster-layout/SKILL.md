---
name: poster-layout
description: Lays out a poster or flyer with size, grid, focal point, text blocks, hierarchy and print specs such as bleed and resolution. Use when the user asks to design a poster layout, lay out an event flyer, or decide where text and images go on a printed page.
---

# Poster layout

## Goal

Decide the structure of a poster so it reads from across a room and prints without surprises. The user gets a grid, a hierarchy of text, placement for each element and a short print checklist.

## When to use

- The user is making a poster, flyer, notice or event card.
- The user has a draft that feels crowded and wants it reorganised.
- For choosing colors or fonts first, use `use_skill` with `color-palette-builder` or `typography-pairing`.
- For social media sizes, use `use_skill` with `social-graphic-spec`.

## Steps

1. Ask with `ask_user` for the purpose (inform, sell, invite), the exact words that must appear, the final size, where it will hang, and how it will be printed (home printer, copy shop, professional). Get the must-have list: date, place, call to action, logo, link or QR code.
2. Rank the text in three levels: the one thing seen from far away, the supporting details seen up close, and the fine print. If three things claim to be first, ask the user to pick.
3. Choose a grid: a single column for simple notices, two or three columns or a modular grid for more content. Set margins at least 5 percent of the shortest side and keep text inside them.
4. Place the focal point (image or headline) using the grid, then add the reading path: top to bottom, with the call to action last and large enough to find. Leave generous empty space around the headline.
5. Write size guidance: headline readable at the intended distance, details at a comfortable close-reading size, minimum body size for print around 9 to 10 points. Check the paper size conventions and bleed requirements of the chosen printer with `search_web` or `read_url`; do not guess.
6. If a QR code is used, give it a quiet zone and a size the user can scan-test. Suggest testing it from printed proof.
7. Provide the layout as an ASCII block sketch or a simple SVG made with `create_file`, with labelled regions and approximate sizes.
8. Do the squint test on the sketch: blur your eyes mentally and check that the headline, image and call to action are still the three things that stand out, in that order.
9. Ask the user to print a draft at actual size on any printer and read it from the distance the poster will be viewed.

## Gotchas

- Screen mockups at 72 dpi look sharp but print soft. Ask for image resolution at final size.
- Text near the trim edge gets cut. Keep it inside the safe area, and extend backgrounds into bleed.
- Dark backgrounds with thin light text fill in when printed. Use heavier weights.
- Centered everything looks tidy and reads slowly. Align to the grid edge.
- Every extra font size dilutes the headline. Limit to three.
- Dates need the year and time zone when the poster travels. Check the exact words with the user.
- Rotated or curved text looks lively and reads slowly. Keep only the logo or decoration that way.

## Output

- A one-line squint test result.
- A labelled layout sketch with sizes in the chosen unit.
- A text hierarchy list: level, content, size.
- A print checklist: size, bleed, margins, resolution, color mode, proof.
