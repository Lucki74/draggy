---
name: language-exchange-messages
description: Drafts and polishes messages to a language exchange partner or tutor in the target language, from the first hello to scheduling and follow-ups, at the learner's level and with a short explanation of the choices. Use when the user wants to write to a language partner, introduce themselves, or keep a chat going in a foreign language.
---

# Language exchange messages

## Goal

Help the learner send messages that sound friendly and natural at their level, so exchanges start and continue. They keep their own voice and learn the phrases behind each message instead of pasting a script.

## When to use

- The user is writing to a new language partner, tutor or pen friend.
- The user needs to arrange a call, reschedule or politely end an exchange.
- The user wants an existing message checked: use `use_skill` with `writing-correction`.
- The user wants live practice: use `conversation-practice`.

## Steps

1. **Get the situation.** Use `ask_user` for the language and variety, the platform (app, email, chat), who the partner is, the learner's level, and what the message must do.
2. **Collect the learner's facts.** Ask for two or three things about themselves they are happy to share: interests, work, goals. Do not invent personal details.
3. **Match the tone.** Use informal and warm for peers on exchange apps, a little more formal for a paid tutor. Offer `use_skill` with `formal-vs-informal` if unsure.
4. **Draft short.** Write three to six sentences: greeting, who they are, what they want from the exchange, a concrete question or proposal, a friendly close.
5. **Keep to the level.** Use structures the learner can understand and reuse. They should be able to explain every sentence they send.
6. **Add a question.** End with one easy question so the partner has something to answer.
7. **Propose logistics clearly.** For scheduling, state a time with time zone, the length and the medium, and give one alternative. Check date and time formats common in the partner's country.
8. **Explain the choices.** Add a short note on three phrases: why this greeting, why this closing, any local habit. Check unsure phrases with `search_web`.
9. **Offer variants.** Give a shorter and a warmer version so the learner can pick the one that sounds like them.
10. **Edit with the learner.** If they change the draft, review it with `edit_file` or in chat, and flag any new error kindly.
11. **Prepare replies.** List three likely responses and how to answer them, so the chat does not stop after the first exchange.

## Gotchas

- A long, polished first message can overwhelm the partner and does not sound like the learner. Keep it short.
- Copying a template word for word gets noticed. Change details so it fits the person.
- Never include personal data the learner did not choose to share, such as address, phone number or workplace.
- Time zones cause missed calls. Always name the zone or convert for the partner.
- Honorifics and greetings differ by culture. Check what the partner's language expects.
- Emojis and slang vary in meaning across regions. Use few and common ones.
- Do not claim a fluency the learner lacks. Honest notes like "I am still learning" invite patience.

## Output

The draft message, a shorter and a warmer variant, a three-line note on the phrases, and likely replies. Send nothing on the user's behalf.
Keep the explanation in the learner's language.
