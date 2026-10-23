---
name: expense-tracking-setup
description: Designs a simple spending tracker around the user's habits, with categories, a capture routine and a weekly check, in the tool they already use. Use when the user asks for help starting to track spending, wants an expense tracker set up, or asks how to keep track of what they spend.
---

# Expense tracking setup

## Goal

Build a tracking method small enough that the user will still use it in three months. The result is a short category list, a capture routine and a weekly check. The skill does not recommend specific apps or products. This is analysis and planning help, not investment, tax or legal advice, and it promises no returns. Tell the user to check decisions with a licensed advisor.

## When to use

- The user has never tracked spending, or tried and stopped.
- The user wants a spreadsheet or file layout to start from.
- Reviewing last month's results is `use_skill` with `monthly-budget-review`.

## Steps

1. Ask with `ask_user` how the user pays (card, cash, transfers), which tool they already open every day (a spreadsheet, a notes app, a banking page), and what they want to learn from tracking.
2. Ask what has failed before. Design against that reason.
3. Pick the lightest capture method that fits: importing a statement export once a week, a quick note when paying, or a monthly sit-down with receipts. Explain the trade-off of effort against accuracy.
4. Propose six to ten categories from the user's life, with plain names. Include a catch-all, and a place for one-off costs.
5. Define the columns: date, amount, description, category, and an optional note. Set the sign rule for refunds and income.
6. If a file is wanted, build it with `create_file` as a CSV or Markdown table with a few example rows clearly marked as examples.
7. Write the weekly routine in three steps and ten minutes: collect, categorize, glance at totals.
8. Write the monthly step: total by category, compare with last month, pick one thing to notice.
9. Set a trial period of four weeks, then ask what to change.
10. Offer a way to handle missed weeks: catch up from the statement, never from memory.
11. Offer a two-minute check at the end of the week with three questions to answer.
12. Explain how to back up the tracker so a lost file does not end the habit.

## Gotchas

- Too many categories. After twelve, categorizing becomes the chore that ends the habit.
- A routine that needs daily action. Weekly import beats daily typing for most people.
- Forgetting cash spending, which leaves a gap in every total.
- Choosing a tool the user will not open without a reminder.
- Treating the first month as a judgment on the user. It is a baseline.
- Letting the tracker hold personal account numbers or passwords. It needs amounts and merchants only.
- Starting in the middle of a month with partial data, which spoils the first totals. Start on the first.
- Over-engineering the sheet with formulas the user cannot maintain.

## Output

The category list, the column layout, the weekly and monthly routines, a file if requested and the four-week trial plan. Keep it to one page.

Add a one-line reminder the user can set on their own phone.
