---
name: budget-sheet
description: Designs a budget workbook with income, categories, plan versus actual and monthly totals for a household, project or small team. Gives planning help only, not investment advice. Use when the user asks for a budget spreadsheet, wants to track spending against a plan, or needs a project budget sheet.
---

# Budget sheet

## Goal

Build a sheet the user will keep up to date: few categories, one place to enter transactions, automatic totals, and a plain view of plan versus actual. A good budget answers "where did the money go and are we on plan" in one look and reconciles to the account balance.

## When to use

- A personal, household or small-team budget in a spreadsheet.
- A project budget with planned and actual spend by line.
- Moving a budget from paper or a messy sheet to a clean structure.
- For choosing or timing investments, this skill does not apply. It is analysis and planning help only. It gives no investment advice and promises no returns, so for decisions the user should consult a licensed advisor.
- For a general tracker of items rather than money, use `use_skill` with `tracker-sheet`.

## Steps

1. Ask with `ask_user` for the period (monthly, yearly, project length), the currency, whether it is personal or shared, and where the actual figures will come from, such as a bank export or manual entry. Do not ask for account numbers or logins.
2. Fix the categories. Aim for 8 to 15 for a household, grouped under fixed costs, variable costs, savings and income. For a project use the cost lines of the approved plan. Too many categories stop being filled in.
3. Design three sheets: `Transactions` (date, description, category, amount, one row each), `Plan` (category by month, planned amount), and `Summary` (plan, actual, difference and percent used per category and month). Name the input cells clearly.
4. Use one sign convention. Keep income and expenses as positive numbers in separate types, or one signed column, but never a mix. State which in a note on the sheet.
5. Build the Summary with SUMIFS over the Transactions table by category and month. Total rows must be formulas. Add a check cell: opening balance plus income minus expenses should equal the closing balance, and show a flag if not.
6. Add data validation on the category column of Transactions from the category list, so spelling never splits a category. Use `use_skill` with `data-validation-rules` for the rule details.
7. Add simple conditional formatting on the difference column for categories over plan. Keep one colour for over and no colour otherwise.
8. If the user has a bank export, import it into Transactions with a mapping step, check for duplicates against existing rows, and map descriptions to categories with a small lookup list, flagging the unmatched for manual choice.
9. Test with five invented transactions: income, a normal expense, a refund, a transfer between own accounts, and a split purchase. Confirm each lands where expected, then clear them.
10. Write the workbook with `write_file` when asked, or give the layout and formulas for the user's application.
11. Plan the monthly routine with the user.
   - Name the day each month for entering transactions and checking the reconcile cell.
   - Agree the rule for handling a category that is over plan: move money, accept, or adjust next month.
   - Suggest a yearly review of categories and amounts, using last year's actuals as the starting point.
   - Keep personal account numbers and logins out of the workbook.

## Gotchas

- Transfers between the user's own accounts counted as spending and as income double the totals. Give transfers their own type and exclude them from both.
- Annual or irregular costs (insurance, fees) break a monthly plan. Spread them as a monthly set-aside or place them in the month they fall, and say which.
- Plan versus actual by category fails when actual rows use categories the plan lacks. The check cell exists to catch this.
- A budget with no review habit decays. Ask for a date to review it, and keep the sheet to what the user will update.
- Any growth, interest or return figure typed into a sheet is the user's assumption, so label it as one and use no figures of your own.
- Currency conversions and tax rules change. When the sheet needs a rate or a rule, ask the user for it or check a live source with `read_url`, and record the date.

## Output

- The monthly routine in three lines.
- The sheet layout, category list and the sign convention chosen.
- The key formulas, including the check cell.
- A short note on what the sheet does not do: it plans and tracks, and gives no financial advice.
