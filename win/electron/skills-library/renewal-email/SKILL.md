---
name: renewal-email
description: Drafts a customer renewal email that recaps value delivered, states the terms the user supplies, and asks for a clear yes or a conversation. Use when the user asks to write a renewal email, send a renewal reminder, or contact a client whose contract ends soon.
---

# Renewal email

## Goal

Write a renewal message that is clear about what happens next, grounded in value the customer has actually received, and easy to answer. The user supplies every term, date and price.

## When to use

- A contract or subscription ends soon and the customer must be contacted.
- The user wants a reminder after the first renewal email went unanswered.
- Preparing the call that comes before is `use_skill` with `customer-success-checkin`.

## Steps

1. Ask with `ask_user` for: customer and contact name, renewal date, the terms as written (price, period, changes), and what the customer has used or achieved. Read any account notes with `read_file`.
2. Check recent history for open issues or complaints. If any exist, tell the user to resolve or acknowledge them in the email.
3. Choose the opening: a specific result or milestone the customer reached, taken only from what the user supplied.
4. State the renewal plainly: what renews, on what date, at what terms. If terms changed, say what changed and why in one sentence, and put it high enough to be seen.
5. Give one action: reply to confirm, or pick a time to talk. Make it a single clear step.
6. Offer a second route for customers who want changes: a short call or a reply with their questions.
7. Draft a subject line that names the renewal and date.
8. Draft a short reminder version for ten days later with a different reason to write.
9. Verify every number and date against what the user gave.
10. Run a final read for tone: friendly, direct, no pressure phrases.
11. Check the send date against the notice period the user mentioned, if any.

## Gotchas

- Burying a price rise in the last paragraph. Customers who find it later feel misled.
- Stating terms, discounts or dates the user never gave. Ask first.
- Opening with the request before any value. Lead with something they got.
- Sending to the wrong contact. Confirm who holds the budget.
- Notice periods and cancellation rights depend on the contract and local rules. Tell the user to check the contract itself and, if unsure, a professional.
- Urgency tactics that the customer will see through.
- Auto-renewal wording differs by contract. Quote only what the contract says.
- Mentioning other customers or discounts the user has not approved.

## Output

The main email with subject, a shorter reminder, and a short list of facts the user must confirm before sending. Nothing is sent.

Add a one-line version for a chat or text follow-up if the user wants it.
