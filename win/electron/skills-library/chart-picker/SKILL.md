---
name: chart-picker
description: Chooses the right chart type for a question and a data shape, and specifies axes, sort order, labels, colour and what to avoid. Use when the user asks what chart to use, how to show a comparison or trend, or says their chart is hard to read.
---

# Chart picker

## Goal

Pick the chart that makes the answer to one question easy to see, and specify it well enough that it can be built without further decisions. A good result names the question, the chart, the encodings and the title that states the finding, and warns against the usual traps.

## When to use

- The user has data and an unclear idea of how to display it.
- An existing chart is cluttered, misleading or confusing.
- A report or dashboard needs a consistent chart choice for a set of metrics.
- For laying out a dashboard sheet in a workbook, use `use_skill` with `dashboard-sheet`.
- For writing up the findings around a chart, use `use_skill` with `findings-writeup`.

## Steps

1. Write the question the chart answers as a sentence. If there are two questions, there are two charts. Use `ask_user` to settle it, along with the audience and the medium (screen, slide, print).
2. Describe the data: how many variables, which are categories, numbers or time, how many categories, how many points. Use `run_code` to count categories and range if a file is given.
3. Map the question type to a chart family:
   - Compare values across categories: horizontal bars sorted by value; vertical bars for few categories or time as categories.
   - Change over time: a line for continuous series, bars for discrete periods.
   - Part of a whole: a stacked bar or a single 100 percent bar; a pie only for two or three slices.
   - Relationship of two numbers: a scatter plot, with a trend line only if it helps.
   - Distribution: histogram, box plot, or dot plot per group.
   - Ranking and change between two points: a slope chart or a dumbbell chart.
4. Check the fit. More than about seven categories in a stack or a line set turns to spaghetti: highlight one series and grey the rest, or split into small multiples with shared axes.
5. Set the axes. Bars start at zero. Lines may not, but then say so. Use the same scale on small multiples. Log scales need a note for general readers.
6. Order and label: sort bars by value unless the categories have a natural order, put labels on the data instead of a distant legend, and keep text horizontal where it can be.
7. Colour with purpose: one colour for the data and one accent for the point, a sequential scale for ordered values, and no rainbow. Check that the chart works in grayscale and for colour-blind readers.
8. Write the title as the finding, such as "Returns doubled after the March change", and the subtitle as the measure, unit and period. Add the source line.
9. If asked to produce it, build with `run_code` and save the image with `create_file`, then look at it again for overlaps and clipped labels.

## Gotchas

- A pie chart with many slices cannot be read, as people compare angles poorly. Use bars.
- A bar chart with a truncated axis exaggerates differences. If the baseline cannot be zero, use dots or a line.
- Dual-axis charts make two unrelated series look correlated, because the scales are chosen freely. Prefer two stacked panels.
- 3D effects and shadows distort length and area. They add nothing.
- A chart with ten colours and a legend forces the reader to look back and forth. Label directly or cut series.

## Output

- The question, the chart type and a one-line reason.
- The spec: axes, order, labels, colours, title and subtitle text.
- Two things to avoid for this data, and the alternative if the first choice does not fit.
