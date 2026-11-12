---
name: emergency-fund-plan
description: Helps the user work out a cash buffer target from their own essential costs and plans how to build it in steps. Use when the user asks how big an emergency fund should be, wants to build a cash buffer, or asks about a rainy day fund.
---

# Emergency fund plan

## Goal

Turn the idea of a buffer into a number based on the user's own essential spending and a build plan they can follow. There is no universal right size, and the skill says so. It does not recommend where to hold the money, and for those choices the user should speak to a licensed advisor.

## When to use

- The user has little or no cash set aside and wants a target.
- The user has a buffer but wonders if it is large enough.
- A goal with a date, such as a holiday, is `use_skill` with `savings-goal-plan`.

## Steps

1. Ask with `ask_user` about the household: who depends on the income, how stable the income is, and what could interrupt it. Treat answers as context, not as a score.
2. List essential monthly costs with the user: housing, utilities, food, transport, insurance, minimum debt payments, childcare. Load a budget with `read_file` if one exists.
3. Total the essentials with `run_command`. Keep a separate line for costs that arrive once a year.
4. Explain that the target is a number of months of essentials, and that the right number depends on stability, dependants and other support. Ask the user to choose a first milestone, such as one month, and a longer-term range.
5. Compute the targets for one, three and six months of essentials, as options. Do not state one as the answer.
6. Ask how much the user can set aside each pay period, and compute the time to each milestone.
7. Define what counts as an emergency, in the user's words, and what does not. Write it down.
8. Define the refill rule: what the user does after using the buffer.
9. Suggest keeping the buffer separate from daily spending, and ask the user where it would be easy to reach but not tempting. Do not name products.
10. Offer to recompute the target when essentials change, and list which figures to update.
11. Ask whether partial milestones, such as one week of costs, would help the user start.

## Gotchas

- Counting non-essential costs, which inflates the target and discourages the user.
- Presenting a fixed number of months as a rule. Circumstances differ.
- Building the buffer while ignoring high-interest debt, or the reverse, without asking the user how they feel about the trade-off. Present both choices.
- Mixing the buffer with money meant for a purchase.
- Forgetting that the target grows when the cost of living grows. Revisit once a year.
- Assuming interest on the buffer.
- Using current spending, not essential spending, as the base.
- Treating all dependants and jobs alike. Stability differs a great deal.

## Output

The essentials total, three target options, the time to each at the user's saving rate, the emergency definition and the refill rule. No returns are promised.

Add a note that the numbers are planning aids and not a guarantee of safety.
