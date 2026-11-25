---
name: expense-categorizer
description: Assigns each line of an expense or transaction export to a category from the user's own list and flags lines that need a human decision. Use when the user asks to categorize expenses, sort transactions, or tag business spending.
---

# Expense categorizer

## Goal

Turn a raw list of transactions into a categorized file the user can sum and review. Categories come from the user's chart, not from the model. Uncertain lines are flagged instead of guessed. Which category counts for tax or reporting is a question for the user's accountant.

## When to use

- The user has a bank or card export and a category list.
- The user wants a repeatable rule set for recurring merchants.
- Summarizing the categorized result is `use_skill` with `expense-report-summary`.

## Steps

1. Load the file with `read_file`. With `run_command`, print the columns, the date range, the row count and the first ten rows.
2. Ask with `ask_user` for the category list. If the user has none, propose a short one and get approval before using it.
3. Ask which columns hold the date, description, amount and any existing tag. Ask whether positive amounts are spending or income.
4. Build rules from exact merchant strings in the data. Apply them with `run_command` and count how many lines each rule matched.
5. Mark as needs review any line with a vague description, an amount over a limit the user names, or a merchant that could fit two categories.
6. Show the unmatched and review lines grouped by merchant, so the user decides once per merchant.
7. Apply the user's answers and re-run. Check that the sum of all categories equals the sum of the source.
8. Save the result with `create_file` as a CSV with the original columns plus category and review flag.
9. Offer the rule list so the next export is faster.
10. Keep a rule list in the answer so the user can reuse it next month.
11. Report the share of lines categorized by rule, by user decision and still open.

## Gotchas

- Guessing from a short merchant code such as a payment processor prefix. The code hides the real seller.
- Inventing categories the user does not use, which breaks their reports.
- Putting a mixed purchase, such as a supermarket receipt with office and personal items, in one category without asking.
- Dropping refunds or transfers between the user's own accounts, which distort totals.
- Sign confusion across card and bank exports.
- Treating business and personal use of one card as the same.
- Silently changing the original description text. Keep the source columns untouched.
- Treating reimbursements from clients as negative expenses.

## Output

The saved CSV path, counts per category, the number of flagged lines and the rules used. Do not claim any line is deductible.

Keep review lines at the top of the file so they are seen first.
