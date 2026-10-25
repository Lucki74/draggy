---
name: big-purchase-decision
description: Lays out the full cost, trade-offs and open questions for a large personal purchase without telling the user whether to buy. Use when the user asks if they should buy something, whether a big purchase is affordable, or wants to think a major purchase through.
---

# Big purchase decision

## Goal

Help the user see the whole cost and the alternatives so the decision is theirs and unhurried. The skill organizes facts and questions. It does not tell the user to buy or not, does not recommend products or lenders, and does not give financial advice. This is analysis and planning help, not investment, tax or legal advice, and it promises no returns. Tell the user to check decisions with a licensed advisor.

## When to use

- The user is weighing a vehicle, appliance, device, course or similar spend.
- A seller or a deadline is adding pressure.
- Planning savings for it is `use_skill` with `savings-goal-plan`.

## Steps

1. Ask with `ask_user` what the item is, the price, why the user wants it, what happens if they wait, and how they plan to pay (cash, savings, instalments).
2. Build the full cost with `run_code`: price, taxes and fees the user has been quoted, delivery, accessories, insurance, running costs per year, upkeep, and the expected years of use. Ask for each; leave unknowns marked unknown.
3. If paying over time, ask for the stated term, rate and fees from the offer. Compute the total paid and the monthly amount, and compare with paying outright.
4. Compare with the budget: load it with `read_file` or ask for monthly surplus. State what the purchase displaces.
5. Ask what would happen to the user's plans if the money were not available next month. This tests the buffer.
6. List alternatives: a cheaper version, a used one, renting, borrowing, waiting three months. Use `search_web` for current prices if the user wants a comparison, and report the date of each price.
7. Write the user's own criteria: what must be true for this to feel like a good decision a year from now.
8. Suggest a waiting rule if the user is unsure, such as deciding after a set number of days, and checking whether the want remains.
9. Summarize the facts for and against in two short lists without a verdict.
10. Offer a short list of questions to put to the seller about total cost, returns and warranty.
11. Ask whether anyone else shares the cost or the use, and include them in the discussion.

## Gotchas

- Focusing on the monthly payment and missing the total cost.
- Leaving out running and upkeep costs, which can exceed the price over time.
- Deciding inside the seller's time limit. A real offer survives a day.
- Treating resale value as certain. Present it as an unknown.
- Comparing the price with income instead of with the budget and buffer.
- Offering a verdict. The same facts can lead to different good choices.
- Anchoring on the discount. A sale price on an item you do not need is still a cost.
- Skipping the cost of the item you will replace or sell.

## Output

A cost table, the budget fit, alternatives with price dates, the user's criteria and two plain lists of considerations. Close by asking what the user wants to check next.

Keep the output neutral so the user can decide in their own time.
