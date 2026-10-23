---
name: time-series-trend
description: Separates trend, seasonality and noise in a time series, compares periods fairly and says whether a change is real. Use when the user asks if a trend is real, to show seasonality, or to compare this month with last year.
---

# Time series trend

## Goal

Tell the user what the series is doing over time and whether a recent move is beyond normal variation. A good result puts the data on a clean time axis, shows the trend and the repeating pattern, compares like with like, and flags breaks and calendar effects.

## When to use

- A metric moved and the user wants to know if it matters.
- A report compares a month to the previous month or year and the user doubts that comparison.
- The user wants to see weekly or yearly patterns before planning.
- For projecting forward, use `use_skill` with `forecast-basics`.
- For judging single extreme points, use `use_skill` with `outlier-detection`.

## Steps

1. Ask for the metric, its unit, the period of interest and what happened around the change (launch, price, outage). Use `ask_user`. Get the data granularity: daily, weekly or monthly.
2. Load with `run_code` and build a complete time index. Reindex so missing dates show as missing, not as skipped rows. Check for duplicates per timestamp, mixed time zones and a change in how the metric is measured.
3. Plot the raw series at its native resolution and at one coarser level. Look for level shifts, gaps, spikes and changing variance before any modelling.
4. Find the seasonality. Check day-of-week and month-of-year averages. Use a decomposition into trend, seasonal and remainder (a classical or STL method) with the seasonal period set to match the data (7 for daily data with a weekly cycle, 12 for monthly).
5. Compare fairly. Use the same period a year earlier for yearly cycles, the same weekday for weekly ones, and equal length windows. Adjust for the number of trading or working days when counts depend on them.
6. Measure the trend with a simple rate: change per period from a fitted line on the deseasonalised series, or a percentage change of rolling 28-day or 12-month averages. Avoid reading a trend from two endpoints.
7. Judge whether a recent move is unusual by comparing it with the spread of the remainder or of past changes of the same size. Say how often moves of that size occurred before.
8. Look for a structural break: a step in level or slope on a known date. Fit the series before and after the date and compare, and be cautious about causes.
9. Summarise in a chart that shows the raw series, the trend line and shaded seasonal expectation, saved with `create_file`. Write the finding with the dates and numbers.

## Gotchas

- Comparing a partial current month with a complete previous month always shows a decline. Compare equal-length windows or wait.
- A moving average lags and smooths away exactly the break you want to see. Look at the raw series next to it.
- Calendar effects (leap years, Easter, month length, number of weekends) create fake changes in monthly data. Normalise per day or per working day.
- Trend measured over a window that starts at a spike or a dip is steered by that point. Test sensitivity to the start date.
- Autocorrelation makes ordinary significance tests too confident for time series. Do not run a plain t-test across days.
- Reading a trend from a window that starts at a peak or trough exaggerates it. Test two or three start dates.
- Year-over-year comparison needs the same calendar rules, such as the same number of weekdays.

## Output

- The cleaned series description: period, frequency, gaps and measurement changes.
- Trend rate, seasonal pattern and how the latest period compares, with dates and numbers.
- The chart path, breaks found and the caveats on causes.
- The period covered, the frequency and any gaps filled or dropped.
- The trend and seasonal components as a table or chart file with its path.
- The events or breaks that affect the reading, and the date each occurred.
- One sentence on what the series does and does not support saying.
