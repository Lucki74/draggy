---
name: pricing-strategy-options
description: Lays out the realistic pricing models for a product, with trade-offs, the value metric to charge on, a structure to test and checks against live market data, without inventing price points. Use when the user asks how to price a product, which pricing model to use, or whether to charge per seat, per use or a flat fee.
---

# Pricing strategy options

## Goal

A short analysis that narrows pricing to two or three workable structures, says what each assumes, and sets out a test to find the price. The numbers come from the user's costs and from sourced market data, never from guesses.

## When to use

- The user is setting prices for a product or service, or reconsidering them.
- The user is choosing between subscription, per-use, tiers, one-off or free-with-upgrade.
- For understanding rival offers first, use `use_skill` with `competitor-matrix`.
- For margins and cash in a spreadsheet, use `use_skill` with `budget-sheet`.
- The user wants to raise prices and needs to know how to do it with less damage.

## Steps

1. Gather the context with `ask_user`: the product, the buyer, how it creates value (time saved, revenue gained, cost avoided), costs per customer if known, and the goal (growth, margin, market entry).
2. Find the value metric: the unit that grows when the customer's value grows (seats, projects, records, usage, locations). Pick one that is easy to count and hard to game.
3. Find the price range from three sides. Cost floor from the user's numbers. Value ceiling: what the buyer gains in money terms, from user data or interviews. Market range: current rival prices from `search_web` and `read_url`, with URL and date. State when the data is missing.
4. List candidate models and what each fits: flat fee, tiered plans, per-unit, usage-based, freemium, one-off with add-ons, and a hybrid. For each, note who it suits, what it assumes, and one risk (bill shock, churn, free users who never pay).
5. Pick two or three fits for this product. Explain why the rest were set aside.
6. Design the tiers, if tiered: what separates them (limits, features, support), a plan most buyers should choose, and what the free or entry plan includes.
7. Plan a test. Options include asking ten target buyers which plan they would buy and why, a landing page with two prices, or a pilot with a few customers. Set a pass rule before starting.
8. List the checks: what happens to margin at the lowest and highest usage, how a price change reaches existing customers, and how discounts are handled.
9. Recommend the first structure to test and the review date.

## Gotchas

- Cost-plus alone ignores value. A product that saves a buyer a lot can be priced above its cost by a wide margin.
- Charging on a metric that does not track value makes the biggest users pay too little or the smallest too much.
- Rival prices are an input, not the answer. Different costs and different buyers change the right price.
- Asking "would you pay for this?" overstates. Ask for a commitment such as a deposit or a signed letter.
- Taxes, currency and local rules change by place. Check live sources before quoting a final price.
- Free plans cost money to serve. Include the cost of free users in the margin check.
- Never present an invented price as a finding. Mark examples as examples.
- Too many tiers confuse buyers. Three plans cover most products, and a fourth needs a clear audience.

## Output

A table of Model, Fits when, Assumes, Risk; the chosen metric; a tier sketch; the test with its pass rule. Sources listed with dates. About a page and a half.
