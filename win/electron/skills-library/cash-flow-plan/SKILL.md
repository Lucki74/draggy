---
name: cash-flow-plan
description: Lays out expected cash in and cash out by week or month from the user's own figures and shows where the balance runs low. Use when the user asks to plan cash flow, wonders if the business will run short of cash, or wants a cash flow forecast.
---

# Cash flow plan

## Goal

Show when money is expected to arrive and leave, so the user sees the weeks that are tight before they arrive. This is planning arithmetic on figures the user supplies. It is not financial advice, and decisions about borrowing or investing belong with a licensed accountant or advisor.

## When to use

- The user asks whether cash will cover upcoming bills and payroll.
- The user has a bank balance, a list of invoices and a list of recurring costs.
- Estimating months of cash left is `use_skill` with `runway-calculator`.

## Steps

1. Ask with `ask_user` for the start date, the opening bank balance, the period length (weeks or months) and how many periods to cover.
2. Load any exports with `read_file`: open invoices, bills, payroll, loan payments, subscriptions.
3. List cash in by expected payment date, not issue date. Ask for each customer's usual delay in paying.
4. List cash out by due date. Include items that come once a quarter or once a year, and mark which are fixed.
5. Build the table with `run_code`: opening balance, in, out, closing balance per period. Print the lowest closing balance and the period it falls in.
6. Add a cushion line if the user names a minimum balance they want to keep.
7. Mark the assumptions that carry the most weight, such as one large customer paying on time.
8. Run a second case in which the biggest receipt arrives one period late, and show the result.
9. List the periods where the balance falls under the cushion and the size of each gap.
10. Reconcile: opening balance plus all in minus all out equals the last closing balance.
11. Offer a weekly check-in routine: replace forecast figures with actuals each week and re-run.
12. List the three levers the user could pull if a gap appears, such as timing of bills, without recommending any.

## Gotchas

- Putting sales on the day invoiced. Cash arrives later, and the gap is the point.
- Forgetting annual bills and tax payments. Ask for a calendar of them and tell the user to check due dates and amounts with their accountant and the live rules.
- Using one average payment delay for every customer.
- Mixing profit with cash. A profitable month can still end with less cash.
- Treating a credit line as income. It is a buffer with its own terms.
- Leaving out owner draws or loan repayments.
- Mixing VAT or sales tax collected with cash the business can spend. Ask how the user handles it.
- Starting from the books balance instead of the bank balance.

## Output

A period table, the lowest point with its date, the assumptions list and the late-receipt case. State that figures are estimates from the user's inputs and are not advice.

End with the single date to watch most closely.
