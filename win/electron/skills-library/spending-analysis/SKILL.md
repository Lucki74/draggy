---
name: spending-analysis
description: Analyses a transaction export for trends, repeat merchants and unusual items, and reports what the data shows without judging choices. Use when the user asks to analyze their spending, wants to know where their money goes, or looks for patterns in transactions.
---

# Spending analysis

## Goal

Describe what the transactions say: where the money went, how it changed over time, and what stands out. The skill reports and asks. It does not judge the user's choices, recommend products, or give financial advice.

## When to use

- The user has a bank or card export covering several months.
- The user wants to see trends before setting a budget.
- Finding only recurring charges is `use_skill` with `subscription-audit`.

## Steps

1. Load the file with `read_file`. With `run_code`, print the columns, row count, date range and the first rows. Ask with `ask_user` which columns hold date, description and amount and which sign means spending.
2. Clean in the code, not by hand: trim text, parse dates, drop exact duplicate rows only after asking, and keep the original file unchanged.
3. Remove transfers between the user's own accounts and card payments from the spending view, and say how many rows were removed and their total.
4. Ask for the user's categories, or group by merchant first and let the user name the groups. Do not invent a category scheme.
5. Compute totals by category and month, the average per month, and the top ten merchants by total and by count.
6. Compare the months. For each large change, look at the rows behind it and say whether it was one big item or many small ones.
7. List unusual items: the largest single transactions, a merchant that appears for the first time with a big amount, repeated small charges that add up.
8. Normalize for month length when comparing months, or show per-day averages.
9. Write the findings as plain statements with numbers, then three open questions for the user.
10. Reconcile: the category totals plus removed rows equal the source total.
11. Offer a chart description of the monthly totals if the user wants one, and keep the data table beside it.
12. Save the cleaned table with `create_file` if the user wants to reuse it.

## Gotchas

- Counting transfers and card repayments as spending, which doubles totals.
- Comparing months of different length or a partial month.
- Descriptions that hide the merchant. Ask before assigning.
- Treating one large purchase as a trend.
- Describing the user's choices as good or bad. Report the facts and let the user draw conclusions.
- Missing refunds, which reduce a category.
- Looking at one month only. Patterns need at least three.
- Calling a merchant total a habit when it was a single event.

## Output

A summary of totals and averages, a month-by-category table, the top merchants, the unusual items with dates and the reconciliation line. End with the open questions.

Keep wording descriptive: this category rose, not you overspent.
