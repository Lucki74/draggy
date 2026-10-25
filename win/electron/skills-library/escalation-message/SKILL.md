---
name: escalation-message
description: Writes a message that raises a blocked or stuck issue to someone with authority, with the history, the impact and the exact decision or action needed. Use when the user says "escalate this to my manager", "they are not responding, go higher" or "raise this issue with leadership".
---

# Escalation message

## Goal

Get a stuck problem unstuck by putting it in front of the person who can decide. A good escalation is factual, short, free of blame, and ends with a clear request and a date.

## When to use

- A vendor, team or approver has not answered after repeated attempts.
- A deadline is at risk and the owner cannot fix it alone.
- A conflict over priorities needs a decision from above.

For a first nudge, use `follow-up-email`. For a customer wronged by a company, use `complaint-letter`. For a talk with the person involved, use `difficult-conversation-prep` first, because skipping them can damage trust.

## Steps

1. **Check the ladder.** Call `ask_user`: has the user raised this directly with the owner, how many times, on what dates, and through which channel? If not tried directly, suggest trying once more first, and say why. Write the escalation only if the user confirms.
2. **Gather the record.** Call `read_file` on the thread, ticket or notes. Extract dates, what was asked, what was promised, what happened. Quote nothing you cannot find.
3. **State the impact.** One sentence on what is at stake: a date, money, a customer, a team's work. Use numbers only when the user gives them.
4. **Define the ask.** One of: a decision, a person to be assigned, a priority call, an introduction, or approval. Write it as a sentence the reader can say yes to.
5. **Draft the body.**
   - Subject: the issue and the ask, such as "Decision needed by Friday: vendor contract renewal".
   - First line: why the reader is being asked.
   - Timeline: three to five dated bullets.
   - Impact: one sentence.
   - What the user has tried.
   - The ask and the date.
6. **Check the tone.** Describe actions and dates, not character. Replace "they ignored me" with "no reply since the 3rd despite two messages".
7. **Decide on copies.** Ask whether to copy the owner. Default: tell the owner beforehand or copy them, so nothing happens behind their back.
8. **Prepare the reply path.** Note what to do if the reader answers with questions: have the evidence at hand.

## Gotchas

- Surprising the other party with a message to their boss turns a process problem into a personal one. Warn them first when it is safe to.
- Attaching the entire thread without a summary makes the reader do the analysis. Summarize in five lines and link the rest.
- An escalation without a specific ask gets sympathy and no action.
- Emotional adjectives are quoted back in later meetings. Keep them out.
- Do not send customer data or private information to a wider list than needed.
- If the issue is safety, harassment or misconduct, the right route is the formal reporting channel, not an email chain. Tell the user to use it.
- Writing at the height of frustration produces drafts the user later regrets. Suggest sleeping on it unless a date forces the send.
- Claiming the issue is "urgent" for everything wears out the word. Reserve it for a real, dated consequence.

## Output

A ready-to-send message with subject. Below it, one line stating who is copied and why, and one line for a suggested date to check back. No theory about escalation.
