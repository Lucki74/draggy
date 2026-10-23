---
name: price-watch-check
description: Reads the current price, currency and stock state from a product page, notes any conditions on it, and appends a dated line to a log file so changes can be compared over time. Use when the user asks to check a product's price, whether the price changed, or whether an item is back in stock.
---

# Price watch check

## Goal

Report the real price a buyer would see now, with its conditions, and keep a small history. The skill reports and records. It does not buy anything.

## When to use

- The user gives a product link and asks about price or stock.
- The user wants to compare today's price with an earlier note.
- For comparing several shops at once, use `use_skill` with `price-comparison`.
- For a big purchase decision, use `use_skill` with `big-purchase-decision`.

## Steps

1. Get the link and the exact variant with `ask_user` (size, colour, plan, region). Check whether a log file already exists with `list_directory` and read it with `read_file` to see previous entries.
2. Open the page with `browser_navigate`. Use `browser_snapshot` to find the price block, the stock message and any option selectors. Dismiss banners using `use_skill` with `cookie-banner-handling`.
3. Select the variant the user wants with `browser_click` or `browser_select_option`, then re-read the price, since many pages update it after a choice. Do not add anything to a cart.
4. Read the price with `browser_get_text`. Separate the current price from a struck-through earlier price, a monthly instalment, a bundle price, a member-only price and a price before tax or shipping. Report the one a normal visitor pays now, and list the others.
5. Record the currency, whether tax is included, the shipping cost if shown without logging in, the stock text exactly as written, the delivery estimate, and the seller if a marketplace.
6. If the price cannot be read without logging in, choosing a region, or entering a postcode, ask the user. Do not enter personal data to see a price.
7. Append a line to the log with `edit_file` or `create_file`: date and time, page address, variant, price, currency, stock text. Keep the format of any existing log.
8. Compare with the last entry and state the change in amount and percent, computed with `run_code` when the numbers are not trivial.
9. If the user wants repeated checks, suggest a schedule they can set up themselves and keep the log format stable so entries stay comparable.

## Gotchas

- A struck-through list price is not what the buyer pays. Read the price element with the label, not the biggest number.
- Prices may differ by country, device, login or cookie state. Say that this is one view.
- "Only 2 left" and countdown timers are sales pressure and not data. Record them as text and do not react to them.
- Do not write the page's claims as fact for other users; the log is for the person who asked.
- Automated checks that repeat often can get blocked. Check no more often than the user needs, and respect the site's rules.
- Never add to basket, apply codes found elsewhere or start checkout without a clear instruction.
- Prices shown in a different currency are converted by the page at its own rate. Record the displayed currency, not your own conversion.
- A lower price from an unknown marketplace seller is a different offer from the shop's own. Name the seller.

## Output

- Whether the buyer would pay more at checkout, if the page says so.
- Price now, with currency, tax and shipping notes.
- Stock state in the page's words.
- Change since the last log entry and the path of the log.
