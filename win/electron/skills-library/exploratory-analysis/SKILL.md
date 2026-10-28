---
name: exploratory-analysis
description: Profiles a new dataset to learn its shape, distributions, relationships and oddities, then lists the questions worth asking next, without claiming conclusions. Use when the user asks to explore a dataset, wants to know what is in a file, or asks for a first look at some data.
---

# Exploratory analysis

## Goal

Understand an unfamiliar dataset well enough to ask good questions of it. A good exploration states what each row is, how big and how clean the data is, what the main variables look like, which relationships stand out, and which findings are leads to test and not results.

## When to use

- The user hands over a file and says "what is in here".
- Before a formal analysis, to decide which questions the data can answer.
- After a data pull, to check it looks like what was requested.
- For a formal quality score, use `use_skill` with `data-quality-audit`.
- For fixing messy values first, use `use_skill` with `csv-cleaner`.

## Steps

1. Ask with `ask_user` what the data is for, where it came from, and the period it covers, unless the user already said. Knowing the source tells you what a row means and what bias to expect.
2. Load it with `run_command` (Python with pandas if available, otherwise JavaScript). Report the shape, column names, types, and memory size. State the grain: one row per what?
3. Check the basics for each column: count of missing values, number of distinct values, and examples. Flag columns that are constant, that look like IDs, or that mix types.
4. Summarise the numeric columns: min, quartiles, max, mean and median side by side. A mean far from the median means skew. Summarise categorical columns with the top values and their shares.
5. Look at dates: range, gaps, rows per period. A missing week or a change in volume often marks a collection change.
6. Look at relationships: correlations among numeric columns, and group averages by the main categories. Keep to pairs that make sense for the question.
   - Use rank correlation if the data is skewed.
   - List the five strongest relationships and say that they are descriptive.
7. Make three to five plots with `run_command` and save them: distribution of the main measure, a time trend, and one comparison across groups. Use `create_file` for the images or a short notebook.
8. Inspect the extremes: the ten largest and smallest values of the main measure, with their rows. Decide if they are plausible.
9. Write down what you did not check and the open questions, such as definitions you had to guess.
10. Propose next steps: the three questions the data seems able to answer, and what extra data would help.

```python
import csv
import pandas as pd
df = pd.DataFrame(csv.DictReader(open(path, newline="")))
# columns load as text: convert numeric ones with pd.to_numeric(df[col], errors="coerce")
print(df.shape); print(df.dtypes)
print(df.isna().mean().sort_values(ascending=False).head(10))
print(df.describe(include="all").T)
```

## Gotchas

- The first striking pattern is often an artefact of how the data was collected or filtered. Ask how rows got into the file before trusting it.
- A summary over everyone hides subgroups that move in opposite directions. Split by the main categories before saying a trend exists.
- Many comparisons will produce something that looks significant by chance. Treat explorations as hypotheses for a proper test.
- Sampling the first rows of a sorted file shows one corner of the data. Sample at random or check the tail too.
- Do not drop or fix rows while exploring without logging it. The next person must be able to reproduce the exact table you looked at.

## Output

- A short profile: grain, size, period, quality notes and the main variables with their typical values.
- The three to five charts or tables that carry the story.
- Leads, labelled as hypotheses, and the questions you would ask next.
- What you assumed or could not check.
