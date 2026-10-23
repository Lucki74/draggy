---
name: infographic-outline
description: Plans an infographic from data and a single message, choosing the headline, chart types, reading order, sources and a section-by-section layout outline. Use when the user asks to plan an infographic or turn data into one visual story.
---

# Infographic outline

## Goal

Decide what the infographic says and how it reads before anyone draws. The result is an outline with one main message, three to six sections, the right chart for each number, and a sourced footer.

## When to use

- The user has data, a report or an article and wants a visual summary.
- The user has a graphic already but it feels cluttered and wants a plan.
- For a chart-only task with data in a spreadsheet, use `use_skill` with `chart-picker`.
- For laying it out as a poster format, use `use_skill` with `poster-layout`.

## Steps

1. Read the source. Use `read_file` for CSV, text or notes, or `read_url` for an article. List the numbers with their units, dates and sources. Anything without a source is flagged.
2. Ask with `ask_user` who will see it, where (social, print, slide, web), and what one thing the viewer should remember. If they list three, pick the strongest and move the others to a second graphic.
3. Write the headline as a claim, not a topic: "Most of the budget goes to X" over "Budget breakdown". Check that the data supports it by computing the figures with `run_code`.
4. Choose a form per number. Comparison across categories: bars. Change over time: line. Parts of a whole with few parts: a single stacked bar or a labelled share. A single big number: just the number with context. Avoid pie charts with many slices and any 3D effect.
5. Order sections as a path: hook, context, main finding, supporting evidence, what to do or what comes next. Give each section a heading, its chart or number and a one-sentence caption.
6. Define the visual system briefly: one accent color for the key finding, neutrals for the rest, one or two fonts. Pull from `use_skill` with `color-palette-builder` if no palette exists.
7. Add a footer with sources, dates and the author. Save the outline with `create_file`.
8. Do a five-second test on the outline: could someone who sees only the headline and the biggest number state the message? If not, cut sections until they could.
9. Note the delivery format and size, and use `use_skill` with `social-graphic-spec` if it is going to social platforms.

## Gotchas

- Truncated axes on bar charts exaggerate differences. Start bars at zero.
- Icons scaled by area, not height, mislead. Prefer plain bars when accuracy matters.
- Too many callouts mean no callout. Highlight one thing per section.
- Percentages from different bases cannot be compared. Check each denominator.
- Long infographics get skimmed on phones. Keep text blocks under two lines.
- A striking number from a single survey or small sample should say how many people it covers.
- Rankings imply order that may not exist. If categories are unordered, sort by value and say so.

## Output

- The five-second test result in a line.
- Headline, audience and the single takeaway.
- A section list: heading, chart type, data and caption.
- A source list and any figure that could not be verified.
