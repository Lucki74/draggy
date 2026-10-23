---
name: strategy-memo
description: Writes a short decision memo that states the problem, the options considered, a clear recommendation, the risks and the decision needed, with the recommendation at the top. Use when the user asks for a strategy memo, a recommendation for leadership, or a written case for one option over others.
---

# Strategy memo

## Goal

A memo of one to three pages that lets a decision maker choose. The recommendation and the ask are in the first paragraph. The body shows the alternatives, the reasoning and the risks fairly enough that the reader trusts it.

## When to use

- The user must recommend a direction or a spend and put it in writing.
- The user has analysis spread over several documents and needs it as one argument.
- For a one-page version, use `use_skill` with `one-pager`.
- For the option comparison behind it, use `use_skill` with `compare-options`.
- For a build or buy case, use `use_skill` with `build-vs-buy-decision`.
- For a design choice in software, use `use_skill` with `adr-writer`.
- A proposal needs a written record that the options were weighed.

## Steps

1. Ask with `ask_user` who decides, what they must decide, by when, and what they already believe. Read supporting files with `read_file`.
2. Write the decision as a question, then the answer you will recommend. If the user has no recommendation yet, run the analysis first and say it plainly.
3. Open with the bottom line: the recommendation, the ask (approve X by Y) and the two strongest reasons. A reader who stops here should still know what to do.
4. Describe the situation: what happened or what changed, what is at stake, and the constraint that forces a choice. Use facts with sources. For facts that move (prices, rules, market data), verify with `search_web` or `read_url` and give the date.
5. Present options: the recommended one and at least two others, including doing nothing. Describe each fairly in a few lines with its cost, benefit and main risk. Present the strongest version of the options you do not recommend.
6. Explain the choice: the criteria used, how each option scored, and why the recommended one wins. Show the trade-off you are accepting.
7. State the risks and the plan to handle each, plus what would change your recommendation (a trigger and a date to check).
8. Lay out next steps: owners, dates, cost, and the decision point for review. State the resources needed.
9. Verify. Check each number and name against its source; check that the summary matches the body; check that the ask appears once at the top and once at the end.
10. Trim. Remove adjectives, repeated points and detail the reader would not use. Move supporting data to an appendix.

## Gotchas

- A memo with a hidden recommendation makes the reader do the thinking. Put it first.
- A single option presented as a choice is a request for approval. Show real alternatives.
- Weak versions of rejected options damage trust. Steelman them.
- Unsourced numbers get challenged and then the whole memo falls. Cite or label as estimates.
- Hedging every sentence hides the position. State uncertainty once, where it matters.
- A memo with no named decision date or decider is filed away.
- Circulate a draft to one skeptic before the decision maker sees it. Their objections are the ones the memo must answer.

## Output

A markdown memo: Title, Recommendation and ask, Background, Options, Reasoning, Risks and triggers, Next steps, Appendix. One to three pages. Offer `create_file` to save it.
