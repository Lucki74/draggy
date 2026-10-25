---
name: customer-success-checkin
description: Prepares an agenda for a check-in call with an existing customer from usage and history, surfacing risks, wins and expansion signals. Use when the user asks to plan a customer check-in, a quarterly business review, or a health call with an account.
---

# Customer success check-in

## Goal

Make the check-in useful to the customer first and the account team second. The agenda covers what changed since last time, what the customer is trying to achieve, and what the team will do next.

## When to use

- A scheduled review or check-in with a current customer.
- The user suspects an account is at risk or ready to grow.
- The renewal message itself is `use_skill` with `renewal-email`.

## Steps

1. Gather history: read notes, tickets or usage exports with `read_file`, and ask with `ask_user` for contract dates, owners, and the goals the customer gave at the start.
2. Summarise since the last check-in: usage trend, support issues, people who joined or left, commitments made on each side.
3. Compare current results to the customer's stated goals. Mark each goal as met, partly met or unknown.
4. List risks you can see in the data: falling use, open issues, a champion who left, a missing sponsor.
5. List possible wins to name: results the customer achieved. Use only measured ones.
6. List expansion signals as questions, not pitches, for example a team asking about a feature they do not have.
7. Write a 30 to 45 minute agenda: their goals first, results, issues and fixes, plans for the next period, and a clear list of follow-ups.
8. Add three questions that invite candour, such as what would make this twice as useful.
9. After the call, list actions with owner and date.
10. Send the agenda two days ahead so the customer can add items.
11. Check who attends from the customer side and tailor the opening to the most senior person.

## Gotchas

- Turning the call into a feature announcement.
- Asking whether everything is fine. People say yes. Ask what is harder than expected.
- Leaving out the person who pays the bill, who may see value differently from daily users.
- Presenting usage numbers that the user has not verified.
- Mentioning renewal price or upsell before the customer's goals are covered.
- Skipping the follow-up note. Send it within a day.
- Bringing bad news cold. Share known issues in the agenda so nobody is surprised.
- Taking silence on the call as agreement. Ask directly for a view.

## Output

A one-page agenda with context, goal status, risks, wins, questions, and a follow-up template with owner and date columns.

Include a note on what to leave out if the call is cut short.
