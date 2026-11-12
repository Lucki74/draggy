---
name: follow-up-email
description: Writes a follow-up to a message that got no reply, restating the ask in a way that is easy to answer and escalating politely over several rounds. Use when the user says "follow up on my email", "they never replied" or "write a nudge".
---

# Follow-up email

## Goal

Get an answer from someone who has gone quiet, without damaging the relationship. A good follow-up is shorter than the original, repeats one clear ask, and lets the reader reply in a line.

## When to use

- A request, quote, application or invoice has had no response after a reasonable wait.
- The user wants a second or third nudge with a different angle.
- The user wants a reminder after a meeting where someone promised an action.

For the first message, use `use_skill` with `email-writer`. For a stuck issue that needs a higher authority, use `escalation-message`.

## Steps

1. **Read the original.** If it is in a file, call `read_file`. Otherwise ask the user to paste it with `ask_user`. Pull out the exact ask, any deadline and the date sent.
2. **Count the attempts.** Ask how many times the user has already written and through which channel. The tone for a first nudge differs from that of a fourth.
3. **Check the wait.** Compare today's date with the date sent. Business requests often need two to five working days. If the wait is shorter, say so and suggest holding off, but write the draft if the user insists.
4. **Pick the angle.**
   - Round one: a light reminder with the ask restated.
   - Round two: add a reason the date matters, or a smaller version of the ask.
   - Round three: offer an easy exit ("if this is no longer a priority, tell me and I will close it").
   - Round four or more: suggest another channel or another person instead of another email.
5. **Write the draft.** Reply in the same thread so the history stays attached. Put the ask in the first sentence. Add one line of context. Give a date by which the user needs an answer, if there is a real one.
6. **Make replying cheap.** End with a question answerable by yes, no or a single date. Offer two options if that fits.
7. **Trim.** Remove apologies, "just checking in" and a recap of the full first email. Keep it under about 80 words.
8. **Show the draft with a subject line.** Keep the original subject with "Re:" unless the thread is long, then suggest a clearer one.
9. **Check the channel.** If the first message went by email and the matter is urgent, suggest one nudge by phone or chat. Draft that short version too if asked.
10. **Add a trigger date.** Note the date by which, if there is still no answer, the user should change course: another contact, a different channel, or closing the item.
11. **Log it.** Suggest the user record the date sent, so the next round counts correctly.

## Gotchas

- "Just following up" says nothing. State the thing you are following up on.
- Do not change the ask between rounds without saying so. A moving target reads as confusion and gives the reader a reason to delay.
- Guilt phrases ("as I mentioned twice") produce silence. State facts and dates instead.
- A follow-up sent to a wider group than the original (copying a boss) is an escalation, not a nudge. Only do that if the user chooses it.
- Out-of-office replies and auto-responders count as a reply. Read them for a return date before nudging.
- Forwarded threads can lose the attachment. Check that the file the ask depends on is still present.
- Following up the same afternoon, or at the same hour every day, reads as pressure. Space nudges out and vary the weekday.
- A holiday week in the recipient's country explains many silences. Check the date before assuming neglect.
- Emails sent to a shared inbox may have no owner. Ask who handles it, then write to that person.

## Output

The draft email with subject and body, ready to send. Below it, one line stating the round number and the suggested wait before the next nudge. No explanation of the techniques used.

If the user asks for a sequence, give all rounds at once, each labeled with its day offset from the first message.
