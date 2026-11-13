---
name: email-triage
description: Sorts a pasted batch of emails or a thread list into do now, reply today, delegate, defer and ignore, with a one-line next action and a deadline for each. Use when the user says "triage my inbox", "which of these emails matter" or "sort these emails by urgency".
---

# Email triage

## Goal

Turn a pile of messages into a short, ordered list of actions. A good result lets the user clear the inbox in one pass: every message has a bucket, a next step and, where one exists, a date.

## When to use

- The user pastes several emails, subject lines or a thread list and asks what to deal with first.
- The user comes back from leave and faces a backlog.
- The user wants a daily or weekly inbox routine.

For writing one reply, use `use_skill` with `email-writer`. For a nudge on a message that got no answer, use `follow-up-email`.

## Steps

1. **Collect the input.** If the emails are in a file, call `read_file`. If they are pasted, work from the paste. Ask once with `ask_user` for the user's role, current top priorities and today's date. Without the date, deadlines cannot be ranked.
2. **List every message.** Number them in the order given. Record sender, subject, date received, and the exact ask if there is one. A message with no ask is information only.
3. **Find the real deadline.** Look in the body for dates, "by Friday", "before the meeting", "EOD". A stated deadline outranks the order of arrival. Write the deadline next to the item, or write "none stated".
4. **Assign one bucket.**
   - Do now: due within a day and only the user can do it.
   - Reply today: a short answer unblocks someone else.
   - Delegate: someone else owns the work. Name who, if known.
   - Defer: needs time. Give a date to return to it.
   - Ignore or archive: no ask, no deadline, no consequence.
5. **Check for hidden asks.** Re-read the long threads from the bottom. The question that matters is often in the last paragraph or a forwarded section.
6. **Group quick replies.** Collect every item that takes under two minutes into one list so the user can clear them together.
7. **Flag conflicts.** If two do-now items collide with the user's stated priorities, say so and ask which wins.
8. **Offer drafts.** Do not write replies unless asked. Offer to draft the top three with `use_skill` and `email-writer`.
9. **Set a time box.** Suggest a block for the do-now list and a second block later for the reply-today list, so the pass does not turn into answering mail all day.
10. **Propose rules.** If the same sender or subject recurs in the ignore bucket, suggest a filter or label and let the user decide. Never create a rule without asking.
11. **Check completeness.** Count the items in all buckets. The total must equal the number of messages received. Report any message you could not classify and why.

## Gotchas

- Sender rank is not urgency. A short note from a peer with a deadline tomorrow beats a long note from a director with no date.
- A thread where the user is the person being waited on is a do-now item even when the last message looks like a thanks.
- Automated mail (receipts, alerts, calendar notices) can hide a real action, such as an expiring card or a failed payment. Scan the subject for words like "failed", "expires", "action required" before binning.
- Do not mark something ignore because the topic is boring. Ignore means there is no ask and no cost to skipping.
- Never invent a deadline. When none is given, say "none stated" and propose one only as a suggestion.
- Dates in a pasted thread may be in a different time zone or format. Confirm before ranking two items an hour apart.
- Newsletters and mailing lists often carry one line that applies to the user, such as a policy change. Skim the first paragraph before archiving a sender the user has not muted.
- Replies marked "cc" are not always read-only. If the user is named in the body, treat it as an ask.
- A reply-all chain may hold three different asks to three people. Split it into separate items.

## Output

A table or plain list per bucket, in this order: Do now, Reply today, Delegate, Defer, Ignore. Each line has the message number, sender, the next action in under 12 words, and the date. End with one sentence naming the single message to open first. No preamble, no motivational closing.

If the batch has more than about thirty messages, give the Do now and Reply today buckets in full and summarize the rest by count and sender.
