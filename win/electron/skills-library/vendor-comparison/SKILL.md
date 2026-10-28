---
name: vendor-comparison
description: Compares vendor quotes on like-for-like terms, total cost over the period and risks, and shows the trade-offs without choosing for the user. Use when the user asks to compare suppliers or quotes, wants to know which vendor costs less, or must evaluate two or more vendors.
---

# Vendor comparison

## Goal

Put competing quotes on one footing so the user can see the real difference in cost, scope and risk. The user makes the choice. Contract terms are summarized for comparison only and are not legal advice; the user should have a professional review anything they sign.

## When to use

- Two or more suppliers have sent quotes or price lists.
- The user wants a weighted view of price against service and risk.
- Building a quote for the user's own client is `use_skill` with `quote-builder`.

## Steps

1. Read each quote with `read_file`. List the vendor, date, validity period, currency, and what the quote includes.
2. Build a scope table with the same rows for every vendor: items, quantities, service levels, delivery times, support, setup fees. Mark gaps as not stated, never as zero.
3. Ask with `ask_user` for the period that matters (one year, three years) and any volume the user expects to change.
4. Compute total cost over that period with `run_command`: recurring fees, one-off fees, usage charges at the expected volume, renewal increases if stated.
5. Note terms that affect risk: minimum commitment, renewal and notice, price change clauses, liability limits, data or exit arrangements. Quote the wording and cite where it appears.
6. Ask the user for the criteria and their weights before scoring, then score each vendor. Show the scores next to the raw facts.
7. Run a check on the weights: change the top weight by a notch and see if the order changes.
8. List questions to put back to each vendor to remove unknowns.
9. State what the comparison cannot show, such as quality or reliability, and suggest references or trials.
10. Keep a log of the assumptions about volume so the comparison can be redone if they change.
11. Draft an email asking each vendor to confirm the open items in writing.

## Gotchas

- Comparing quotes for different scope and calling the cheapest the best.
- Skipping renewal pricing, where the first-year discount often ends.
- Choosing weights after seeing which vendor wins.
- Reading a missing line as included. Ask the vendor.
- Mixing currencies or tax-inclusive with tax-exclusive prices.
- Treating a verbal promise as part of the quote.
- Counting a discount that depends on a commitment the user may not make.
- Ignoring switching costs, such as time to migrate.

## Output

A side-by-side table, total cost per vendor over the period, a risk list with quoted clauses, the weighted scores with the sensitivity note, and follow-up questions. No recommendation unless the user asks, and then with the reasons.

Separate facts taken from the quotes from the user's own judgments.
