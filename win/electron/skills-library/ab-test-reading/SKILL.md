---
name: ab-test-reading
description: Reads the results of an A/B test by checking the design first, then lift, uncertainty and guardrail metrics, and states a decision with caveats. Use when the user asks whether an A/B test won, to interpret experiment results, or whether a difference is significant.
---

# A/B test reading

## Goal

Say what the experiment shows and how sure we can be, in terms a decision-maker can act on. A good reading first checks that the test was run properly, then reports the effect with an interval, looks at side effects, and ends with a recommendation that includes what would change it.

## When to use

- A test has finished and the user has counts per variant.
- The user wants to know whether an observed difference is real.
- A test was stopped early or looked at many times and the user is unsure what that means.
- For explaining the statistics in plain words, use `use_skill` with `statistics-explainer`.
- For planning how many users a test needs, use `use_skill` with `sampling-plan`.

## Steps

1. Collect the facts with `ask_user`: the hypothesis, the primary metric, the planned duration and sample size, the allocation split, the dates, and any peeking or early stopping. Get the raw counts: users and conversions (or sums and variances) per variant.
2. Check the design before the result. Is the split close to the planned ratio? Compute a sample ratio check with a chi-square test in `run_command`. A mismatch means assignment or logging is broken and the result cannot be trusted.
3. Check exposure: users counted once, no overlap between variants, the experiment ran for whole weeks if there is a weekly cycle, and no big outside event during the run.
4. Compute the effect on the primary metric: the absolute difference, the relative lift, and a confidence interval. For rates use a two-proportion test, for means a t-test or bootstrap if the data is skewed.
   - Report the interval together with the p-value.
   - State if the interval includes effects too small to matter.
5. Compare with the pre-agreed threshold of practical importance. A statistically significant 0.1 percent change may not be worth shipping.
6. Look at guardrail metrics (error rate, latency, refunds, unsubscribe) and at the key segments only if they were planned. Treat unplanned segment cuts as leads.
7. Adjust for multiple comparisons if several metrics or variants are tested, for example with a Bonferroni or false discovery rate correction, and say which.
8. If the test was peeked at or stopped when it looked good, say that the standard p-value is no longer valid, and state what a sequential method would give if the user used one.
9. Write the verdict: ship, do not ship, extend, or rerun with a fix. Add the main risk and the next test to run.

```python
from statsmodels.stats.proportion import proportions_ztest, proportion_confint
z, p = proportions_ztest([conv_b, conv_a], [n_b, n_a])
```

## Gotchas

- Stopping the moment the p-value drops below 0.05 inflates false positives badly. Use the planned sample size or a sequential design.
- A sample ratio mismatch is a bug signal, not a statistical nuisance. Find the cause before reading any metric.
- Averaging conversion rates across days weights small days as much as large ones. Pool the counts.
- A non-significant result is not proof of no effect. The interval shows what effects remain possible.
- Novelty and primacy effects fade or grow over weeks. A two-day result may not hold.

## Output

- The design checks and their result in two or three lines.
- Effect, interval and p-value for the primary metric, plus guardrails in a small table.
- The recommendation with its confidence and the caveats that would change it.
