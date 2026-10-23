---
name: market-sizing-sources
description: Finds and grades the published figures needed to estimate a market's size, then lays out a top-down and a bottom-up calculation with every assumption visible. Use when the user asks how big a market is, where to find market size data, or wants a TAM, SAM or SOM estimate they can defend.
---

# Market sizing sources

## Goal

Produce a size estimate whose inputs can each be traced to a source and whose assumptions are written down. A range with its reasoning beats one confident number.

## When to use

- A pitch, plan or decision needs a market size and the user has no figure.
- The user holds a vendor report number and wants it checked.
- For competitor detail, use `use_skill` with `competitor-scan`. For checking a single quoted statistic, use `stats-claim-check`.

## Steps

1. **Define the market.** Fix product category, customer type, geography, currency and year. Ask with `ask_user` for any that is missing. Write the definition in one sentence.
2. **Find top-down inputs.** Use `search_web` for statistics-office, trade-body, regulator and public-company figures for the wider category. Open each with `read_url` and note the year, unit and definition.
3. **Find bottom-up inputs.** Gather the count of potential customers (businesses by size, households, users) from census or registry data, and an observed price or spend per customer from public pricing or surveys.
4. **Grade every input.** Mark each as official statistic, company filing, industry body, analyst report or blog. Prefer the first three.
5. **Check units.** Convert to one currency and one year. Write the conversion source and date next to it.
6. **Calculate both ways.** Use `run_code` for the arithmetic: top-down is wider market times the share that fits your definition, bottom-up is customers times spend times adoption. Keep each factor on its own line.
7. **Compare the two results.** If they differ by more than about a factor of two, find which assumption drives the gap and say so.
8. **Report a range.** Give low, base and high, naming the assumption that moves each.
9. **Run a sensitivity check.** Change each assumption by a quarter up and down with `run_code` and list which one moves the result most.
10. **Check against a known case.** Compare the method with a public company's reported revenue in the same segment, as a sanity test.

## Gotchas

- Paid analyst reports quote a headline figure and sell the method. Treat the headline as an unchecked claim and find an input you can open.
- Total market is not serviceable market. Remove segments the product cannot serve, and say what you removed.
- Percentages from different bases do not multiply. "30% of 40% of firms" needs both shares to refer to the same population.
- Growth forecasts extend a trend line. Report the base year figure separately from any forecast.
- Price per customer from a list page overstates real revenue where discounts are common. Flag it.
- Do not present a TAM as revenue the user can expect. It is the size of the demand pool.
- Revenue and spend are different. Customer spend on a category can include parts a vendor never sees.
- Company filings give segment revenue under the company's own segment names. Read the note that defines them.
- Currency conversion at one date hides swings. State the rate date and keep the original currency in the table.

## Output

A short definition, a table of inputs (value, unit, year, source, grade), the two calculations with steps shown, and the range with its three main assumptions. Close with the single input that would most improve the estimate if verified.
