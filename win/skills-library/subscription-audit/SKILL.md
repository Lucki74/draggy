---
name: subscription-audit
description: Finds recurring charges in a statement export, lists them with yearly cost and last use, and marks ones worth reviewing. Use when the user asks what subscriptions they pay for, wants an audit of recurring charges, or suspects forgotten subscriptions.
---

# Subscription audit

## Goal

Give the user a clear list of everything that charges them on a schedule, with the yearly cost, so they can decide what to keep. The user decides; the skill never cancels anything. It names no replacement services and gives no advice on products. This is analysis and planning help, not investment, tax or legal advice, and it promises no returns. Tell the user to check decisions with a licensed advisor.

## When to use

- The user has bank or card statements and wants to find recurring charges.
- The monthly total looks high and the user does not know why.
- A review of all spending, beyond recurring charges, is `use_skill` with `spending-analysis`.

## Steps

1. Ask with `ask_user` for the months of statements to scan. Three months catches monthly charges, twelve months also catches annual ones.
2. Load the files with `read_file`. With `run_command`, print the columns, date range and row count.
3. Group transactions by merchant text, normalizing case and stripping reference numbers.
4. Detect recurrence: same merchant and a similar amount at regular gaps (weekly, monthly, quarterly, yearly). List near matches separately, for example a price that changed.
5. For each recurring item show merchant, amount, frequency, yearly cost, first and last seen. Compute the yearly total for all items.
6. Ask the user about each item: still used, shared with someone, or unknown. Mark unknown items for investigation, such as checking the merchant's own account page.
7. List charges that look like free trials that rolled into paid: a small or zero first charge followed by a larger one.
8. Note the next renewal date for annual items so the user can decide before they renew.
9. Before any cancellation, remind the user to check notice terms, refund rules and what data they lose, on the provider's own page.
10. Produce the sorted list, most expensive per year first.
11. Offer a short checklist for each cancellation: notice, refund, data export, end date.
12. Re-run the scan in three months to catch new charges.

## Gotchas

- Missing annual charges when only three months were scanned.
- Merchant descriptors that hide the real service. Ask before deciding it is unknown.
- Flagging a shared family plan as unused.
- Counting a price increase as a new subscription.
- Cancelling something with an early exit fee. Check terms first.
- Forgetting charges billed through app stores or a second card.
- Assuming a charge is a subscription because it repeats. Rent and loan payments repeat too.
- Treating a charge made by another household member as the user's own.

## Output

A table of recurring items with yearly cost and the user's decision column, the yearly total, and renewal dates ahead. Do not state savings as a promise.

Add the user's decision for each item so the next audit starts from it.
