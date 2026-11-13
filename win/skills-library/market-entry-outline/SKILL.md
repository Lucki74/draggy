---
name: market-entry-outline
description: Outlines how to enter a new market, region or customer segment, covering demand evidence, rules and requirements, the entry route, resources, risks and a staged first step, using live sources for facts that change. Use when the user asks about expanding to another country, entering a new segment, or whether to go into a market.
---

# Market entry outline

## Goal

A structured outline that says whether and how to enter a market, based on checked facts. It ends in a recommended first step small enough to reverse, with a rule for when to stop.

## When to use

- The user is considering a new country, region, segment or sales channel.
- The user wants an outline for a board, partner or advisor.
- For launching in the market once chosen, use `use_skill` with `go-to-market-plan`.
- For sizing sources, use `use_skill` with `market-sizing-sources`.
- For comparing rivals there, use `use_skill` with `competitor-matrix`.
- A partner or advisor has suggested a region and the user wants to test the idea before spending.

## Steps

1. Ask with `ask_user` what the market is (place or segment), why it is attractive, what the business offers today, the budget and the time horizon. Ask what would make the user say no.
2. Define the market clearly: who the buyers are, what they buy now, and the boundary (a city, a country, an industry vertical). Vague boundaries lead to vague numbers.
3. Check demand. Look for evidence that buyers have the problem and pay for solutions: spending data, industry reports, search interest, job posts, customer messages. Use `search_web` and `read_url`. Record source, date and what the source actually measures. Say plainly where only estimates exist.
4. Check the rules. List licences, product standards, data rules, tax, import rules and language requirements that apply. These change and differ by place, so read the official source and cite it. For legal interpretation, tell the user to consult a qualified local adviser.
5. Map competitors and substitutes in that market, including local ones the user may not know. Note price level, channels and strengths.
6. Choose the entry route and compare two: direct sales, online-only, a local partner or reseller, acquisition, or a pilot with one customer. For each give cost, speed, control and risk.
7. List requirements: people, language, payment methods, support hours, logistics, legal entity, and adaptation of the product.
8. List the main risks and what signal would show each early.
9. Propose a staged plan: a low-cost test (a pilot, a landing page, five customer calls), a decision point with a pass rule set in advance, then scale steps. Name the owner and dates.
10. Recommend go, test first, or no-go, and state the reasons and the biggest unknown.

## Gotchas

- Treating a country as one market hides large differences by region and segment. Narrow it.
- Top-down sizing ("one percent of a huge market") is a classic error. Build from reachable buyers.
- Rules and fees change often. A remembered figure is not a source.
- Culture and buying habits can differ in ways that make the product wrong. Talk to local buyers before committing.
- Without an exit rule, a failing test turns into a long commitment.
- Cost of support in another time zone and language is usually underestimated.
- Official statistics differ in definitions across countries. Check what a figure counts before comparing two places.

## Output

Sections: Market definition, Demand evidence, Rules and requirements, Competitors, Entry routes (table), Resources, Risks and signals, Staged plan, Recommendation. Sources with dates at the end. Two pages or less.
