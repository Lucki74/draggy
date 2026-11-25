---
name: forecast-basics
description: Builds a simple baseline forecast, tests it on held-out periods and reports a range with assumptions, for planning and not for financial advice. Use when the user asks to forecast next quarter, project a trend forward, or how accurate a forecast is.
---

# Forecast basics

## Goal

Give a forecast the user can plan with, together with a range and a record of how well the same method would have done in the past. A good result starts with a naive baseline, tests any fancier method against it, states assumptions and known events, and avoids a single exact number.

## When to use

- Planning demand, workload, headcount, traffic or sales for the next few periods.
- The user has a projection and wants to know how much to trust it.
- A spreadsheet trend line needs a sounder basis.
- For understanding the past pattern first, use `use_skill` with `time-series-trend`.
- For market, price or return predictions, this skill gives planning help only and no investment advice. Decisions on money should go to a licensed advisor.

## Steps

1. Ask what is being forecast, over what horizon, at what granularity and for what decision. Use `ask_user`. A forecast of weekly staffing needs different accuracy than a yearly budget.
2. Load the history with `run_command`. Build a complete time index, fix gaps, and note changes in definition or one-off events such as promotions, closures or outages. Decide whether to adjust them or mark them as known events.
3. Plot the history and describe it: level, trend, seasonality, and any regime change. If the history is short (under two full seasonal cycles), say that seasonal estimates are weak.
4. Build baselines first, because they are hard to beat:
   - Naive: the next value equals the last value.
   - Seasonal naive: the next value equals the value one season ago.
   - Moving average or average of the last season.
5. Try one or two sensible methods, such as exponential smoothing with trend and season, or a regression on trend and calendar variables. Prefer simple methods unless data is rich and the gain is demonstrated.
6. Backtest with a rolling origin: fit on data up to a date, forecast the horizon, move forward and repeat. Never score on the data used to fit. Measure error with MAE or a percentage error, and compare each method with the baseline.
7. Choose the method that beats the baseline on the backtest by a margin that matters. If none does, use the seasonal naive and say so.
8. Produce a range, not one line: use the spread of backtest errors at that horizon to give a band, for example the 80 percent interval. Explain that the band widens with horizon.
9. Layer in known future events, such as a planned launch, as explicit adjustments with their source, and show the forecast with and without them.
10. State assumptions and what would invalidate the forecast. Save the table and chart with `create_file`, and schedule a check against actuals when they arrive.

## Gotchas

- Scoring a model on the data it was fitted to rewards overfitting. Use a held-out period in time order, never a random split.
- A single number invites false precision. Give the range and the scenario assumptions.
- Smooth trends extended for years go through zero or infinity. Cap the horizon at what the history supports.
- A pandemic, a price change or a product change breaks the link to the past. Say when history no longer applies.
- Percentage errors blow up when actuals are near zero. Use absolute errors for small counts.

## Output

- The baseline and chosen method, with the backtest error table.
- The forecast with a range and the assumptions and events included.
- The conditions that would invalidate it and when to compare with actuals.
- The data window used, the horizon and the backtest dates.
- The code path so the forecast can be rerun when new actuals arrive.
