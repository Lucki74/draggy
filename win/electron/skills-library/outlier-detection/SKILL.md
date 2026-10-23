---
name: outlier-detection
description: Flags unusual values with more than one method and then judges each with context as an error, a rare real event or a different population, instead of deleting by rule. Use when the user asks to find outliers, whether values are abnormal, or why an average looks too high.
---

# Outlier detection

## Goal

Find the few values that do not fit and decide what each one is. A good result shows which method flagged what, the context for the top cases, a recommendation per case (keep, correct, exclude, model separately), and how much the headline numbers change with and without them.

## When to use

- An average, total or chart is dominated by a few extreme rows.
- A pipeline needs a rule for catching bad sensor, entry or transaction values.
- The user asks whether a value is normal for the group.
- For a full data check beyond outliers, use `use_skill` with `data-quality-audit`.
- For gaps rather than extremes, use `use_skill` with `missing-data-handling`.

## Steps

1. Ask what the column means, its units and what a plausible range is. Use `ask_user`. A weight of 400 is an error for a person and normal for a vehicle.
2. Look at the distribution first with `run_code`: a histogram or quantile table (min, 1st, 25th, median, 75th, 99th, max). Note skew, spikes at round numbers and sentinels such as 999.
3. Apply two or more methods and compare:
   - The interquartile rule: flag values outside 1.5 times the IQR beyond the quartiles. Robust to skew.
   - Median absolute deviation: a robust z-score based on the median.
   - Domain limits: hard bounds from the meaning of the field.
   - For grouped data, compute the rule inside each group, not over everyone.
4. For skewed positive data, apply the rule on a log scale, then map back. Plain z-scores on skewed data flag the tail of a normal distribution.
5. For several variables, look at combinations: a normal height and normal weight can be an odd pair. Use a scatter plot and, if needed, a distance or isolation-based method, and say it is a screening tool.
6. List the flagged rows with context columns (ID, date, group, related fields) and sort by how extreme they are. Look at the top 20 yourself.
7. Classify each flagged case with evidence:
   - Error: impossible, a unit mix-up (grams against kilograms), a duplicate or a typo of a digit.
   - Rare but real: valid and explainable, such as a big customer or a holiday spike.
   - Different population: a separate type of record that should be analysed on its own.
8. Test sensitivity. Recompute the headline statistic (mean, total, slope) with the flagged rows kept, corrected and removed, and report all three.
9. Recommend one action per class and ask the user to confirm before changing data. Keep a flag column rather than deleting rows.

## Gotchas

- Removing an outlier because it hurts the story is data fabrication. State the rule before looking at its effect.
- Z-scores use the mean and standard deviation, which the outliers themselves distort, so a big outlier can hide itself. Use robust measures.
- A threshold applied to the whole dataset flags a whole subgroup that is merely different. Compute within groups.
- Repeated measurements have a natural outlier for any entity measured often. Judge per entity over time.
- A spike that is real today, such as a sale day, will be called an error by a rule trained on quiet days.

## Output

- The method table: rule, threshold, count flagged.
- The top cases with context, class and recommendation.
- The sensitivity table for the headline number, and the flag column or file with the row IDs.
