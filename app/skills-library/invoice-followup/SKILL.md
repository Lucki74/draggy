---
name: invoice-followup
description: Writes a payment reminder sequence for an overdue invoice using only the terms and dates the user supplies. Use when the user asks to chase an unpaid invoice, needs a payment reminder email, or says a client has not paid.
---

# Invoice follow-up

## Goal

Get an overdue invoice paid while keeping the client relationship. The skill drafts reminders in an escalating but courteous order, using facts from the invoice. It does not give legal advice or advise on debt recovery; for formal steps or late fees the user should read their contract and consult a professional.

## When to use

- An invoice is past its due date and the user wants a message.
- The user wants a standard set of reminders for a business.
- Making the invoice itself is `use_skill` with `invoice`.

## Steps

1. Ask with `ask_user` for the invoice number, amount, currency, issue date, due date, payment terms, how to pay, and the client contact. Read a copy with `read_file` if there is one.
2. Ask what has happened since: earlier reminders, replies, a dispute, a part payment. Never assume nothing was paid.
3. Ask the user to confirm that the payment has not arrived in their bank account today.
4. Choose the first message by days overdue and the relationship. Draft a friendly note that states the invoice, the amount, the due date and how to pay, and asks them to tell you if something blocks payment.
5. Draft a second reminder for about a week later with a short summary, a request for a payment date, and a new copy of the invoice attached by reference.
6. Draft a third message that is plain and firm, names the amount and days overdue, and asks for a payment date by a specific day. Mention a late fee or interest only if the user gives the clause from their terms.
7. Add a version for a phone call, with three lines to say and one question to ask.
8. Write the subject lines. Put the invoice number in each.
9. Check every number and date against what the user supplied.
10. Offer a polite message for a client who replied with a promise but no date.
11. Suggest logging each contact with date and result so the history is clear.

## Gotchas

- Sending a reminder after the client has paid. Confirm receipt first.
- Threatening action the user has not decided on, such as collections or court.
- Quoting late fees or interest the contract does not state.
- Copying the whole company on a message about one client's debt.
- Ignoring a dispute. If the client questions the invoice, answer the question before asking for payment.
- Reminders with different amounts across messages.
- Sounding sarcastic in the later messages. Plain and specific works better.
- Chasing the wrong contact. Confirm who approves payments.

## Output

Three escalating drafts with subjects and a call script, plus a list of facts to confirm. Nothing is sent. Remind the user that formal debt steps depend on local rules to check with a professional.

Note that tone should match the user's relationship with the client.
