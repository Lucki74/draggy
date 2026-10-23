---
name: stats-claim-check
description: Tests a quoted statistic by finding its source, checking the denominator, sample, time frame and definition, recomputing what can be recomputed and judging whether it supports the claim built on it. Use when the user asks if a number is right, whether a statistic proves a point, or how to read a percentage in a headline.
---

# Stats claim check

## Goal

Tell the user whether a number is accurate and whether it means what the claim says. Many wrong-sounding statistics are real numbers used for the wrong point, so both parts are checked.

## When to use

- A headline, post or speech quotes a percentage, rate, ranking or "X times more".
- The user wants to know if a figure supports the conclusion drawn from it.
- For where a statement began, use `use_skill` with `claim-tracing`. For a general factual claim, use `fact-check`.

## Steps

1. **Write the claim in two parts.** The number as stated, and the conclusion drawn from it. Keep exact wording and unit.
2. **Find the source data.** Use `search_web` and `read_url` to reach the statistic's origin: release table, paper, survey report. Locate the exact figure.
3. **Check the match.** Compare the quoted number with the source: value, unit, year, group, place. Record every mismatch.
4. **Find the denominator.** Ask what the number is a share of. "Up 50%" from what, to what? Convert to absolute counts where the source allows.
5. **Check the sample.** For surveys: sample size, who was asked, how they were chosen, margin of error, question wording. For counts: what was counted, and who is excluded.
6. **Check the definition and time frame.** Compare the term in the source with the common meaning, and check start and end dates. Note any change of method.
7. **Recompute.** Use `run_code` for ratios, percentage changes and per-capita rates. Show the arithmetic. Keep percent change and percentage points separate.
8. **Test the inference.** Ask whether other explanations fit the same number: mix of groups, base effects, chance in small samples, reverse direction.
9. **Verdict.** Accurate and supports the claim; accurate but misleading; inaccurate; or cannot verify. Explain in two sentences.
10. **Look for the omitted comparison.** Find the figure for the comparison group, earlier period or other region that the claim leaves out.
11. **Rephrase fairly.** Offer a version of the claim that the data does support.

## Gotchas

- A change from 1% to 2% is "double" and also one percentage point. Both are true, and the headline picks the dramatic one.
- Averages hide spread. Check whether median or mean is reported and whether outliers drive it.
- Small samples swing wildly. A rate from 12 events needs an interval before it means anything.
- Rankings depend on what is ranked. Check the number of items and whether ties or missing entries are handled.
- Totals against per-person rates tell opposite stories for large and small places.
- Do not call an old number false for being old. Say what year it describes.
- Charts with truncated axes make small gaps look large. Read the axis before the shape.
- Adjusted and unadjusted figures (for inflation, age, season) tell different stories. Say which one is quoted.

## Output

Verdict line, then a short table: quoted value, source value, base, sample, definition. Then the recalculation and a two-sentence reading of what the figure does and does not show.
