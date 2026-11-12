---
name: decline-politely
description: Writes a clear, kind refusal to an invitation, request, offer or job, with the no stated early and no false opening left behind. Use when the user says "turn down this request", "politely say no" or "decline the invitation".
---

# Decline politely

## Goal

Say no once, so it is understood the first time. A good refusal is warm, short, honest and final, and where possible it points the other person to something useful.

## When to use

- Turning down a meeting, speaking invitation, favour, project, job offer or vendor pitch.
- Saying no to extra work from a manager while keeping the relationship.
- Declining a social or networking request.

For asking for something, use `use_skill` with `email-writer`. For pushing back on terms while staying in the deal, use `negotiation-email`.

## Steps

1. **Read the request.** If it is in a file, call `read_file`. Note exactly what was asked, by whom and by when a reply is expected.
2. **Settle the decision.** Call `ask_user`: is it a firm no, a not-now, or a no-unless? Write only the version the user means. A "maybe later" must come with a real date.
3. **Choose the reason level.** Options are no reason, a brief true reason, or a constraint (time, scope, policy). Ask which the user prefers. Never invent a reason.
4. **Draft in four beats.**
   - Thanks, in one clause, for the specific thing offered.
   - The no, in the first or second sentence, in plain words ("I can't take this on").
   - The reason, only if chosen, in one sentence.
   - A kind close, with an alternative if there is one: another person, a later window, a smaller version, a resource.
5. **Match the relationship.** A boss, a stranger, a close colleague and a recruiter each need a different register. Keep contractions in casual cases.
6. **Remove openings.** Delete "unfortunately I might not be able to" and "let me see". Search the draft for words that invite a counter: "right now", "at the moment", "this time" unless meant.
7. **Check the length.** Three to six sentences for most cases. Longer notes read as guilt.
8. **Offer the redirect.** If suggesting another person, confirm the user has that person's agreement before naming them.
9. **Check the timing.** A quick no is kinder than a slow one. If the user needs time to decide, draft a short holding reply with a real date for the answer.
10. **Read it as the asker.** Would the asker know what to do next? If they might ask again, add a clear closing line such as "I won't be able to help with this one".
11. **Prepare for pushback.** Offer a one-sentence second reply for when the asker insists, which repeats the no without new reasons.

## Gotchas

- Softening so far that the reader hears "maybe" means a second round of asks. State the no in the first lines.
- An invented excuse (a trip, a deadline) can be disproved later. A short true statement is safer.
- Declining to a manager: give the trade-off, not the refusal alone ("I can take this if the report moves to next week"). Ask the user if that offer is real.
- Do not apologize three times. One "sorry" or "thank you" is enough.
- When declining a job offer, keep the door open only if the user wants it, and send it before the offer's deadline.
- Do not tell the reader what they should have done differently.
- Giving different reasons to different people lets the lie surface. Keep one consistent reason, or none.
- Ghosting is not a no. Silence leaves the asker waiting and costs more goodwill than a clear refusal.
- A decline that praises the offer at length leads the reader to ask again later. Keep the thanks to one clause.

## Output

The ready-to-send message, with a subject line for email. One line afterward naming any alternative or date offered so the user can confirm it. No tips on assertiveness.

If the user wants a shorter or firmer variant, give it directly under the main draft.
