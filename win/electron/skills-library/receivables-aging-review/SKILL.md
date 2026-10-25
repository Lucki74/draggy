---
name: receivables-aging-review
description: Groups unpaid invoices by age and customer, ranks follow-up priority and lists actions per bucket. Use when the user asks who owes them money, wants an aging report reviewed, or needs to prioritize collections.
---

# Receivables aging review

## Goal

Show the user where unpaid money sits by age and customer, and what to do about each group. The result is a priority list for follow-up. It is not legal or debt-recovery advice; formal steps depend on contracts and local rules the user should check with a professional.

## When to use

- The user has an open-invoice list or an aging export.
- Cash is tight and the user needs to decide whom to chase first.
- Writing the reminder itself is `use_skill` with `invoice-followup`.

## Steps

1. Load the list with `read_file`. With `run_code`, print the columns, the number of rows and the total open amount. Keep that total.
2. Ask with `ask_user` for the as-of date, the standard payment terms, and any customers with special terms.
3. Compute each invoice's days overdue from the due date, not the issue date. If the file only has issue dates, apply the terms and state it.
4. Group into buckets: not yet due, 1 to 30, 31 to 60, 61 to 90, over 90 days overdue. Let the user change the bucket edges.
5. Total by bucket and by customer with `run_code`. Show each bucket's share of the total.
6. Check for partial payments, credit notes and disputes. Exclude disputed items from the chase list and list them separately.
7. Rank customers by amount overdue times age, and mention any with repeated late payment.
8. Write an action per bucket: a courtesy message, a firm reminder, a phone call, a review of further sales to that customer.
9. Reconcile: bucket totals add to the starting total.
10. Offer a dated chase list saved with `create_file`.
11. Flag customers that are over a credit limit if the user gives limits.
12. Suggest which accounts to hold new orders for, as an option for the user to decide.

## Gotchas

- Aging from the invoice date when customers have different terms.
- Missing credit notes or part payments, which overstate the debt.
- Chasing small balances before large ones because they feel easier.
- Treating a disputed invoice as a late one.
- Looking only at the oldest bucket. A big not-yet-due balance from one customer is also a concentration risk.
- Using the report date instead of the as-of date of the export.
- Applying today's date to an old export.
- Ignoring currency differences within one bucket total.

## Output

Bucket table with counts and amounts, customer ranking, disputed list, actions per bucket and the reconciliation line. Offer next steps only as options for the user.

Keep dispute notes with the customer, for later conversations.
