---
name: a-b-test-plan
description: Designs an A/B test with one hypothesis, one change, a primary metric, a sample size and duration worked out before launch, and a decision rule that prevents stopping early on a lead. Use when the user asks to plan an A/B test, test a headline or page change, or decide whether a variant really won.
---

# A/B test plan

## Goal

A test plan that can produce a trustworthy answer. It fixes the hypothesis, the single change, the metric, the sample needed and the stopping rule before any data arrives, so the result is not argued afterward.

## When to use

- The user wants to test a headline, button, email subject, price display or page layout.
- The user has a test running and is unsure whether a lead is real.
- For ad copy to test, use `use_skill` with `ad-copy-variants`.
- For the page being tested, use `use_skill` with `landing-page-copy`.
- For choosing between larger strategic options, use `use_skill` with `assumption-test-plan`.

## Steps

1. Ask with `ask_user` for the page or message, the goal, the current conversion numbers (visits and conversions over a recent period), traffic per week, the tool used and the smallest improvement worth acting on.
2. Write the hypothesis: "Changing X to Y will raise Z for audience A, because R". The reason matters, because it makes a result teach something.
3. Change one thing. If two things change, name them as one package and accept that the test cannot say which mattered.
4. Choose one primary metric tied to the business goal, plus guardrail metrics that must not get worse (refunds, unsubscribes, load time). Define exactly how each is counted.
5. Get the baseline rate from the user's data. Do not use industry averages as the baseline.
6. Work out sample size. Use the baseline, the minimum effect worth detecting, a significance level (commonly 5 percent) and power (commonly 80 percent). Compute with `run_code` and show the formula or tool used, and the inputs. If traffic is too small to detect the effect in a reasonable time, say so and suggest a bigger change, a higher-traffic step or a qualitative test instead.
7. Set the duration. Convert sample size into days at current traffic, and round up to whole weeks so each weekday appears equally. Avoid launch, sale and holiday periods that distort behavior.
8. Define the split: random assignment, equal shares, stable per visitor, and the same traffic sources for both arms. Plan a check that the split is balanced.
9. Write the decision rule before launch: run to the planned sample, then read the result once. State what happens if the variant wins, loses or is flat.
10. Plan the log: record the hypothesis, dates, result and what was learned, whatever the outcome.

## Gotchas

- Testing many changes at once leaves you unable to say what worked.
- Stopping the moment one arm looks ahead produces false winners. Peeking inflates error rates unless a sequential method is built in.
- Skipping the sample size plan means running until you like the number. Do the math first.
- Flat results are results. Do not hunt through segments until one looks good.
- Seasonal swings, ad bursts and tracking bugs can swamp small effects. Check the data quality.
- A statistically significant gain can still be too small to matter. Compare to the cost.
- Running several tests on the same audience at once can interfere. Stagger them or separate the traffic.

## Output

A plan sheet with hypothesis, change, metrics, baseline, sample size with inputs, duration, split, decision rule and log template. Flag any assumption to confirm.
