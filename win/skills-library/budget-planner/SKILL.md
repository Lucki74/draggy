---
name: budget-planner
description: Builds personal or household budgets from income and expenses, shows where the money goes, suggests realistic savings and saves the budget as a spreadsheet. Use when the user wants to make a budget, track spending, save for something, or understand their finances.
---

# Budget planner

## Goal

Show the user where their money goes each month, find savings they can realistically make, and set out a timeline for any goal. This is practical budgeting help, not regulated financial advice. For investments, debt restructuring, tax or pensions, suggest a qualified adviser.

## When to use

- The user wants a budget, a spending breakdown or a plan to save for something.
- The user shares a bank export or CSV to categorise.
- Questions about which investment to buy or how to structure tax are out of scope. Say so and point to an adviser.

## Steps

1. Collect:
   - monthly take-home income after tax, with irregular income averaged per month
   - fixed costs: rent or mortgage, utilities, insurance, phone and internet, subscriptions, loan repayments
   - variable costs: groceries, transport, eating out, shopping, entertainment, gifts
   - annual or occasional costs (car servicing, holidays, gifts), converted to a monthly amount
   - goals: emergency fund, paying off a debt, a purchase by a date

   If the user shares bank export text or a CSV, categorise the transactions and total them by category.
2. Work out totals by category and the monthly surplus or shortfall. Double-check the arithmetic, using `run_command` if the data is large.
3. Compare to a simple guideline, such as roughly 50% needs, 30% wants and 20% savings and debt, and note that it varies with situation and cost of living.
4. Find the biggest realistic savings: unused subscriptions, high-interest debt first, small recurring costs that add up. Give amounts as well as percentages.
5. For a savings goal, the monthly amount needed is (target minus current) divided by months remaining.
6. Suggest an emergency fund target of around 3 to 6 months of essential costs, built gradually.

## Gotchas

- Forgetting annual costs makes a budget look healthier than it is. Spread them across twelve months.
- Mixing pre-tax and take-home income gives a surplus that does not exist.
- The 50/30/20 split is a starting point. In a high-rent city needs can legitimately take more than half.
- Percentages alone do not motivate. State what a change is worth per month.
- Do not recommend specific investments, tax moves or debt restructuring.

## Output

A summary table, the three most effective changes with their monthly effect, and a goal timeline. Offer an .xlsx file with `create_file`, with columns Category, Type (fixed or variable), Monthly (amount) and Notes, plus Total rows. Leave currency symbols out of the numbers and name the currency in the header.
