---
name: negotiation-email
description: Drafts a negotiation email that states a position with its reason, gives a specific counter and leaves room to agree, for offers, rates, vendor prices or deadlines. Use when the user says "negotiate this offer", "counter their price" or "ask for a higher rate".
---

# Negotiation email

## Goal

Move a deal toward better terms while keeping the relationship intact. A good negotiation email is specific about the number, gives a reason the other side can accept, and names what the user will give in return.

This skill helps with wording and preparation. It is not legal or financial advice. For contracts with binding terms, tell the user to have a qualified person review before signing.

## When to use

- Countering a job offer, freelance rate, vendor quote, lease renewal or project deadline.
- Asking for a raise by email.
- Replying to a first offer that is close but not right.

For refusing outright, use `decline-politely`. For a consumer dispute, use `complaint-letter`.

## Steps

1. **Collect the offer.** Call `read_file` if the offer is in a file, or ask the user to paste it. Extract every term: money, dates, scope, benefits, conditions.
2. **Find the goals.** Call `ask_user` for: the ideal outcome, the minimum acceptable one, what else matters beyond the headline number, and the user's alternative if the talk fails. Never reveal the minimum in the draft.
3. **Ground the number.** If the user cites a market figure, ask for the source. When benchmarks are needed, use `search_web` or `read_url` for current data and cite it. Do not state a market rate from memory.
4. **Choose the lever.** Besides the price: start date, scope, payment terms, review date, equipment, flexibility. Offer a trade ("I can commit to a longer term if the monthly rate is X").
5. **Draft in this order.**
   - Thanks and a sincere positive about the offer.
   - The counter, with one specific figure or term.
   - One or two reasons tied to value delivered or to the data found.
   - What the user offers in return, if anything.
   - A next step with a date.
6. **Keep the tone firm and warm.** No ultimatums, no hedging words like "I was hoping maybe". State the ask as a plain sentence.
7. **Check it as the reader.** Could the other side say yes in one reply? If the counter has three moving parts, ask whether to simplify.
8. **List open risks.** Note anything the user should settle by phone or in writing elsewhere.

## Gotchas

- A range invites the other side to choose the bottom. Give one number, or a range whose lowest value you would accept.
- The first number anchors. Do not name a figure before checking what the other side has offered, unless they ask.
- Apologizing for asking ("sorry to be difficult") weakens the case. Remove it.
- Threats to walk away only work if true. Do not draft one the user will not carry out.
- Do not mention another offer that does not exist. It is easy to check and costs trust.
- Laws on pay history questions and salary disclosure differ by place. Check the current rule with `search_web` before advising on what to share.
- Accepting verbally and negotiating more afterward breaks trust. Raise every term in one message.

## Output

The email with subject line, then three bullets: the figure used, the reason it rests on, and the trade offered. Add one line for what to do if the reply is a flat no. No negotiation theory.
