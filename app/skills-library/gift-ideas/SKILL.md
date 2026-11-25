---
name: gift-ideas
description: Generates gift ideas from what the user knows about the person, the budget and the occasion, with a short reason for each. Use when the user asks for gift ideas, what to buy for a birthday, or help choosing a present.
---

# Gift ideas

## Goal

Offer a short list of gifts that fit the receiver, with the reason each could work, a price check from live sources and a delivery date that beats the deadline.

## When to use

- A birthday, holiday, thank-you or farewell is coming.
- The user knows the person but is out of ideas.
- Putting a limit on the spend is `use_skill` with `budget-planner`.

## Steps

1. Ask with `ask_user` about the receiver: relationship, age range, interests, recent changes in life, and what they complained about or mentioned wanting.
2. Ask about the occasion, the budget, the date of the event, and whether the gift is shared with others.
3. Ask what was given before, to avoid repeats, and what the receiver already owns in this area.
4. Think in four types: something they wanted but would not buy, something that solves a small daily problem, an experience, and something handmade or personal.
5. Draft eight to ten ideas across the types, each with one line on why it fits this person. Keep every idea within the budget.
6. Check availability and price for the top five with `search_web` and `read_url`. Note the shop, the price on the day and the delivery estimate, and mention that prices change.
7. Check return terms and gift receipt options for items where size or taste matters.
8. Remove ideas that arrive after the deadline, or flag them with an alternative such as a card or voucher.
9. Rank the shortlist and give a first pick with the reasoning.
10. Offer wording for a card message in the user's voice, kept short and sincere.
11. Suggest wrapping and delivery options if the receiver lives far away, and the cost of each.
12. Save the shortlist with links via `create_file` if the user wants to decide later.

## Gotchas

- Ideas that fit the giver and not the receiver.
- Ignoring the budget.
- Suggesting items that need a long delivery time.
- Gifts that create work for the receiver, such as a pet or a large project.
- Choosing sizes by guess. Ask or pick a returnable item.
- Assuming a trend item suits someone who does not follow it.
- Quoting a price from memory.
- Overlooking customs fees on overseas orders.

## Output

A ranked shortlist with the reason, price, source, delivery date and return terms for each, plus a draft card message.
