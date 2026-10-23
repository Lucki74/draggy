---
name: findings-writeup
description: Turns analysis results into a short report with the answer first, then evidence, caveats and a recommendation, written for the person who must decide. Use when the user asks to write up results, summarise an analysis for a manager, or turn numbers into a report.
---

# Findings write-up

## Goal

Get the reader to the answer, the confidence in it and the action in under a minute, and give them the evidence if they want it. A good write-up leads with the finding, uses numbers with their bases, shows no more charts than the argument needs, and is honest about what the analysis could not show.

## When to use

- An analysis is finished and its results must be communicated.
- The user has tables, charts or notebook output and needs a readable summary.
- A report exists but is long, flat and hides the point.
- For choosing the chart for each point, use `use_skill` with `chart-picker`.
- For explaining a single statistical term in the report, use `use_skill` with `statistics-explainer`.

## Steps

1. Establish the reader and the decision with `ask_user`: who reads it, what they must decide, how much time they have, and how technical they are. Ask for the original question if it is not stated in the material.
2. Read the material with `read_file` or `run_code`, and list every number you may use. Recompute any figure you are unsure about. Do not use a number that cannot be traced to the analysis output.
3. Write the answer in one or two sentences: the finding with its size and the recommended action. If the data does not answer the question, the finding is that, and what would answer it.
4. Choose the three to five supporting points that carry the argument, in order of importance. Each point is a full sentence with its number, its comparison and its base: "Repeat orders fell from 31 percent to 24 percent among 4,200 customers acquired in March (down from 5,100 in February)". Cut the rest to an appendix.
5. Add one chart or table per point only if it shows something the sentence cannot. Title each chart with its finding. Save visuals with `create_file` and refer to them in the text.
6. State the confidence and the caveats: sample size, data gaps, period covered, definitions used, what was not checked. Keep to the ones that could change the decision, and state how.
7. Write the recommendation as an action with an owner and a time if possible, and the cost of waiting. If there are options, show two or three with trade-offs and name your preferred one.
8. Add a short method note at the end: data source and date, filters, tests used, and where the code and the data live, so another analyst can reproduce it.
9. Edit for length. The summary fits on one screen. Remove hedges that do not carry information and jargon the reader does not use. Apply the `unslop` skill if you have it. Read it once as the busy reader.
10. Check every number in the text against the source output one last time, and the sums and percentages against each other.

## Gotchas

- Writing in the order the analysis was done (data, method, results, finding) buries the answer. Reverse it.
- A percentage without the number behind it, or a change without the starting value, cannot be judged.
- Caveats listed as a long block make everything sound uncertain. Rank them and keep what matters.
- Stating a cause the analysis only suggests invites a wrong decision. Use "is associated with" unless a test showed more.
- Colourful charts of every cut hide the one that matters. Show the cut that the argument rests on.
- A recommendation the reader cannot act on, such as one with no owner, is read as an observation. Name who does what.
- Numbers in the text must match the charts exactly. Rounding differences erode trust.

## Output

- A one-page report: answer, supporting points, caveats, recommendation and method note.
- The list of figures and tables with their file paths.
- Open questions the analysis could not settle.
- The audience named at the top of the report.
- The date of the data and of the report.
- The reviewer, if one is assigned, and the check they did.
