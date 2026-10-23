---
name: meeting-request
description: Writes a meeting or call request that states the purpose, the length, proposed times in the reader's time zone and what the guest should prepare. Use when the user says "ask for a meeting", "schedule a call with" or "request 30 minutes".
---

# Meeting request

## Goal

Get a meeting booked in one round trip. A good request tells the reader why the time is needed, how long it takes, when it could happen and what they get out of it, so they can say yes without a follow-up question.

## When to use

- Asking a colleague, client, manager or outside contact for a call.
- Proposing a recurring check-in.
- Turning a long email thread into a short call.

For a first message to a stranger, use `cold-outreach`. For turning down someone else's request, use `decline-politely`.

## Steps

1. **Gather the details.** Call `ask_user` for: who, the purpose, the decision or output wanted, the length, the user's time zone, the guest's time zone if known, the user's free windows, and the medium (video, phone, in person, location).
2. **Test the need.** If the purpose is one question or a status check, suggest an email or chat first and say why. Keep the meeting if the user still wants it.
3. **Write the subject.** Include the purpose and the length, such as "Budget review, 30 min, week of the 14th". Use real dates only from the user.
4. **Open with the purpose.** First sentence: what the meeting is for and what should be decided or produced.
5. **Offer two or three slots.** Write each with weekday, date, time and zone abbreviation. Check weekday and date pairs against a calendar with `run_code` if there is any doubt. Offer an invitation link only if the user has one.
6. **State the length.** Fifteen minutes is easier to accept than "a quick chat". Match the agenda to the time.
7. **Add the prep.** One line on any document to read or data to bring, with a link or attachment note.
8. **Name the attendees.** If others should join, say who and why. Ask the guest to forward if someone else is better placed.
9. **Close with the action.** "Reply with the slot that suits you and I will send the invite." Add a fallback: "If none work, send two of your own."
10. **Prepare the invite text.** Write a two-line calendar description with the purpose and the link or room, so the invite is useful if the guest accepts without reading the email.
11. **Plan a reminder.** Suggest a short note the day before, with the agenda and the link, for meetings with outside guests.
12. **Handle a reschedule.** Offer a one-line reply for the case where the guest proposes another time or asks to move it.

## Gotchas

- Mismatched weekday and date ("Tuesday 12th" when the 12th is a Wednesday) makes the request look careless and causes no-shows. Verify.
- Time zones: write the zone on every slot, and convert for the guest if known. "3pm" alone is ambiguous.
- Asking "when are you free?" pushes all the work to the guest. Always offer slots.
- A long agenda in the first email scares people off. Keep the agenda to three bullets at most, and only if it helps.
- Holidays and local weekends differ by country. Check the guest's location before proposing a Friday or a Sunday.
- Do not promise a meeting link or a room the user has not booked.
- Sending a calendar invite before the guest agrees to the idea puts a block on their day. Ask first, invite after.
- "Pick your brain" gives no purpose and no length. Replace it with the one question you need answered.
- For senior guests, ask for the assistant's help only if the user knows the right contact. Do not guess at an assistant's address.

## Output

Subject line and email body of about 70 to 110 words, with the slots in a short list. Add a one-line shorter chat version if the user mentioned Slack. No commentary.

Give the calendar description and the reschedule reply as two extra short blocks after the email, only if the user asks for them.
