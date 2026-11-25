---
name: follow-up-sequence
description: Designs a short sequence of follow-up messages after a sales meeting or proposal, each with a new reason to write and a stop rule. Use when the user says a prospect went quiet, wants a follow-up cadence, or asks how to chase a deal without nagging.
---

# Follow-up sequence

## Goal

Give the user a plan of three to five touches, spaced sensibly, where every message adds something the buyer can use. The plan also says when to stop.

## When to use

- A meeting, demo or proposal has happened and nothing has come back.
- The user wants a cadence for many leads at once.
- A single nudge on an old email is `use_skill` with `follow-up-email`.
- The user wants a one-off nudge on a single thread, which `use_skill` with `follow-up-email` covers.

## Steps

1. Ask with `ask_user`: what happened last, when, what was agreed, who the contact is, and how urgent the buyer's own deadline is.
2. Read any thread or notes the user points to with `read_file`. Pull out the buyer's stated problem and any date they gave.
3. List possible reasons to write that are new to the buyer: an answer to a question they asked, a relevant example the user supplied, a short summary of the decision they face, a question on who else should see it.
4. Assign one reason per touch. Choose the channel and gap for each from what the buyer has used so far. Gaps lengthen as the sequence goes on.
5. Draft each message in three to five sentences. The last touch is a polite close-out that gives the buyer an easy way to say not now.
6. Add the stop rule: after the final touch, move the deal to nurture and set a date to review it.
7. Check that no two messages say the same thing.
8. Offer to log the schedule as tasks in the user's own tracker, written as plain dated lines.
9. Check the whole sequence for tone drift: it should end as friendly as it began.

## Gotchas

- "Just checking in" has no content. Replace it with a reason.
- Touches clustered in one week feel like pressure. Spread them out.
- Switching channel every time with no pattern. Use what the buyer answers on.
- Promising materials the user does not have. Ask first.
- Continuing after a clear no. A refusal ends the sequence.
- Forgetting the buyer's own calendar: budget cycles and holidays move the right gap.
- Using the buyer's silence as proof of rejection. Many replies arrive late in a sequence.
- Attaching new files on every touch. One clear link or none.

## Output

A table of touch number, day offset, channel, purpose, and draft text, then the stop rule and review date. No message is sent.
- Include the trigger that would end the sequence early, such as a reply or a booked call.
- Flag any touch that depends on information the user must still get.
