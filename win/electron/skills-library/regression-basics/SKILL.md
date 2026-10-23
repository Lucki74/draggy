---
name: regression-basics
description: Fits a linear or logistic regression, checks its assumptions and explains the coefficients in plain words, without claiming cause. Use when the user asks to run a regression, what drives an outcome, or to explain regression coefficients.
---

# Regression basics

## Goal

Quantify how an outcome varies with a few predictors and explain what the model does and does not say. A good result has a clear question, a fitted model with its fit statistics, diagnostics that were looked at, coefficients with intervals in the units of the data, and a limit on what can be inferred.

## When to use

- The user wants to know how much an outcome changes per unit of something else.
- The user has a model output and needs help reading it.
- A quick baseline model is needed before anything more complex.
- For a forward projection, use `use_skill` with `forecast-basics`.
- For explaining a statistical term in detail, use `use_skill` with `statistics-explainer`.

## Steps

1. State the question and the outcome. Use `ask_user` if unclear. A continuous outcome fits linear regression, a yes or no outcome fits logistic regression, and a count may need a count model.
2. Choose the predictors from reasoning about the problem, not from what correlates. Decide which are of interest and which are controls. Note any that are consequences of the outcome and must be left out.
3. Load and prepare the data with `run_code`: handle missing values with a stated rule, encode categories as dummies with a named reference level, and keep units readable (years not days if that helps). Log transform a positive, skewed outcome if the relationship is multiplicative.
4. Look before fitting: scatter plots of outcome against each predictor, and correlations among predictors. Two predictors correlated above about 0.8 make coefficients unstable.
5. Fit the model with a statistics library (statsmodels in Python gives intervals and tests). Save the formula and the sample size actually used after dropping rows.
6. Check diagnostics: residuals against fitted values for curvature and spread, a normal quantile plot for heavy tails, and influential points with Cook's distance or leverage. For logistic regression check calibration and separation.
7. Read the coefficients in words with units: "each additional year of tenure goes with 1.8 more orders per year, holding the other variables fixed (interval 1.2 to 2.4)". For logistic models convert to odds ratios and also to predicted probabilities at typical values.
8. Report fit honestly. R-squared or the area under the curve on training data is optimistic. Hold out a test set or cross-validate and report that figure.
9. Say what cannot be concluded: association is not cause, and effects hold within the range of the data.
10. Save the code and the output with `create_file`.

```python
import statsmodels.formula.api as smf
m = smf.ols("revenue ~ tenure + C(plan) + region_size", data=df).fit()
print(m.summary())
```

## Gotchas

- A coefficient is the effect of a predictor with the others held fixed. It is not the simple correlation, and it can change sign when a predictor is added.
- Leaving out a driver that relates to both predictor and outcome biases the estimate. This is the usual reason for "surprising" signs.
- Extrapolating a straight line beyond the observed range produces nonsense, such as negative counts.
- A significant tiny effect in a huge sample is not important. Judge the size of the effect.
- Dummy coding without naming the reference level makes coefficients unreadable. Always state what each is compared with.

## Output

- The model in one line, the sample size, and the fit measured out of sample.
- A coefficient table with plain-language meaning and intervals.
- The diagnostics seen, the limits on interpretation and the code path.
