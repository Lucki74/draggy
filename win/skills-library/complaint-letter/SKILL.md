---
name: complaint-letter
description: Writes a consumer complaint to a company about a faulty product, poor service or a billing error, with dated facts, evidence and the remedy the user wants. Not a legal document. Use when the user says "write a complaint letter", "complain about a faulty product" or "ask for a refund by email".
---

# Complaint letter

## Goal

Get a refund, repair, replacement or correction from a company. A good complaint is calm and factual, names the order, lists what went wrong and when, and says in one sentence what the user wants and by when.

This is a consumer letter. It is not a legal demand. If money is large or the company refuses, tell the user to check the consumer authority or a qualified adviser for their country.

## When to use

- A product arrived broken, late, wrong or never.
- A service was not delivered as described.
- A bill, fee or charge is wrong.

For a message between colleagues, use `escalation-message`. For a business apology the user is sending, use `apology-message`.

## Steps

1. **Collect the facts.** Call `ask_user` for: company, product or service, order or account number, purchase date, price, what went wrong, dates of earlier contact, and what the user wants. Ask which evidence exists: receipts, photos, emails, chat logs.
2. **Read the paper trail.** If the user has files, call `read_file` and pull exact dates and quotes. Note any warranty or return period the company states. If a policy page is cited, use `read_url` to confirm the text.
3. **Find the right address.** Use `search_web` or `read_url` for the company's official complaints or customer-care contact. Check it is the company's own site.
4. **Define the remedy.** One clear request: full refund, replacement, repair, price correction, or written explanation. Add a response deadline of a reasonable length, such as 10 to 14 days, and tell the user to adjust it to the company's published policy.
5. **Draft the letter.**
   - Subject with order number and the issue.
   - Opening: who the user is, what was bought, when.
   - The problem in dated, numbered facts.
   - Previous contact and the result.
   - The remedy and the deadline.
   - List of attachments.
6. **Check tone.** Firm, courteous, no insults, no threats. Delete capitals and exclamation marks.
7. **Check the claims.** Every fact must come from the user. Do not cite consumer laws or specific rights from memory. If the user wants one named, look it up on an official site first, and cite the source.
8. **Plan the next step.** Say what the user can do if there is no reply: a second letter, the card issuer's chargeback process, or a consumer body. Check live rules before stating details.

## Gotchas

- Anger hides the ask. A reader skimming a rant misses the order number and the remedy.
- Refund rights and deadlines differ by country and by payment method. Never state a legal right as fact without a checked source.
- Do not exaggerate. One false detail lets the company dismiss the whole complaint.
- Keep copies of everything sent. Suggest sending by a channel that records delivery.
- Do not include card numbers or full account details in the letter. Last four digits are enough.
- Asking for compensation on top of the remedy slows things down. Include it only if the user truly wants it.

## Output

The letter with subject line and attachment list. Beneath it, a two-line note: the deadline set, and what to do if the company does not reply. No legal conclusions.
