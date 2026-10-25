---
name: swot-analysis
description: Builds a SWOT analysis from evidence about a business, product or project, then turns the four lists into a few strategic moves. Use when the user asks for a SWOT, wants to assess strengths and weaknesses, or needs to check their position before choosing a strategy.
---

# SWOT analysis

## Goal

A SWOT that someone could argue with because it cites facts, and that ends in choices. The four lists are short, each item has evidence, and the last section says what to do about them.

## When to use

- The user asks for a SWOT or wants a quick read on where a business or project stands.
- The user is preparing a plan, review or pitch and needs the position stated plainly.
- For a deeper look at rivals alone, use `use_skill` with `competitor-matrix`.
- For choosing between named options, use `use_skill` with `compare-options`.
- For describing how the business makes money, use `use_skill` with `business-model-canvas`.
- The user needs a shared starting point before a planning session with a team.

## Steps

1. Frame the subject. Ask with `ask_user` what is being analyzed (the whole firm, one product, a project), the goal it is judged against, and the time horizon. A SWOT without a goal has no yardstick.
2. Gather inside facts. Ask for data the user holds: sales by segment, costs, team skills, customer feedback, assets. Open any file they name with `read_file`.
3. Gather outside facts. Check market conditions, rules, rivals and trends with `search_web` and `read_url`. Note the source and date of each. Do not use remembered figures for things that change.
4. Sort every point. Strengths and weaknesses are internal and the user can change them. Opportunities and threats are external and the user can only respond. Move misplaced items.
5. Keep each item to a fact and a consequence: "Repeat customers are 60 percent of orders (from the user's sales export), so retention is cheaper than acquisition." If the user gave no number, do not invent one.
6. Rank. Keep the top four or five in each list by effect on the goal. Mark items that rest on opinion rather than data as "to verify".
7. Cross the lists. Pair strengths with opportunities (use), weaknesses with threats (protect), strengths with threats (defend), and weaknesses with opportunities (fix first). Write one move per pair that matters.
8. Pick the moves. Choose up to three that fit the goal and resources, and name the first step for each.
9. Review against the Goal: every move traces to at least one list item, and every list item has evidence or a verify mark.

## Gotchas

- Strengths written as flattery ("great team") carry no information. Ask what the team does better than a rival and how the user knows.
- Opportunities that are just wishes are not external facts. Point to a trend, a gap or a change in rules.
- A weakness for one goal can be a strength for another. State the goal at the top.
- Long lists hide the key points. Cap each list.
- The analysis ages. Date it and name the facts most likely to change.
- A SWOT with no moves is a description. Do the cross step.
- Teams fill the Strengths box fastest and the Weaknesses box slowest. Ask for customer complaints to balance it.

## Output

A two-by-two grid in text with the four lists, the "to verify" marks, then a table of Moves: Move, Based on, First step. Include sources with dates. About one page. Offer to save with `create_file`.
