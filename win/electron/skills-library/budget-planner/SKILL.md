---
name: budget-planner
description: Builds personal or household budgets from income and expenses, shows where money goes, suggests realistic savings and saves the budget as a spreadsheet. Use when the user wants to make a budget, track spending, save for something, or understand their finances.
---

# Budget planner

This gives practical budgeting help, not regulated financial advice. For investments, debt restructuring, tax or pensions, suggest a qualified adviser.

## Collect

- Monthly take-home income (after tax), including irregular income averaged per month.
- Fixed costs: rent or mortgage, utilities, insurance, phone and internet, subscriptions, loan repayments.
- Variable costs: groceries, transport, eating out, shopping, entertainment, gifts.
- Annual or occasional costs (car servicing, holidays, gifts), converted to a monthly amount.
- Goals: emergency fund, paying off a debt, a purchase by a date.
If the user shares bank export text or a CSV, categorise the transactions and total them by category.

## Method

1. Totals by category and the monthly surplus or shortfall. Double-check the arithmetic.
2. Compare to a simple guideline, such as roughly 50% needs, 30% wants, 20% savings and debt, while noting it varies by situation and cost of living.
3. Find the biggest realistic savings: subscriptions not used, high-interest debt first, recurring small costs that add up. Give amounts, not only percentages.
4. For a savings goal: monthly amount needed = (target − current) / months remaining.
5. Suggest an emergency fund target of around 3 to 6 months of essential costs, built gradually.

## Output

A summary table, the three most effective changes with monthly effect, and a goal timeline. Offer an .xlsx with create_file with columns Category, Type (fixed/variable), Monthly (amount), Notes, plus Total rows; numbers without currency symbols, the currency named in the header.
