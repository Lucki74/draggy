---
name: scenario-phrasebook
description: Builds a short phrasebook and a sample dialogue for one real situation in a target language, such as a hotel check-in, a doctor's office booking or a job interview, with replies the learner may hear and a role-play to rehearse. Use when the user prepares for a specific situation abroad or at work and needs the exact phrases.
---

# Scenario phrasebook

## Goal

Prepare the learner for one situation with the lines they will say, the lines they will hear back and the questions they can ask when lost. They leave with a card they can keep on their phone and a rehearsal that felt like the real thing.

## When to use

- The user is going to a situation in another language: ordering, renting, asking for directions, a meeting.
- The user wants to rehearse a conversation with set roles.
- The user wants open-ended talk: use `use_skill` with `conversation-practice`.
- The user wants polite versus casual wording: use `formal-vs-informal`.

## Steps

1. **Define the scenario.** Use `ask_user` for the situation, the place and variety of the language, the learner's level, who they will talk to and what they must achieve.
2. **List the goals.** Write the three to five things they need to get done in the situation, in order, such as "ask the price, ask if breakfast is included, pay".
3. **Write the learner's lines.** For each goal give one polite default phrase, with a pronunciation hint if the sounds are hard, and one simpler fallback.
4. **Write the other side.** List the replies and questions they will probably hear, with meanings. Learners fail on what they hear more than on what they say.
5. **Add repair phrases.** Include "could you repeat that", "more slowly please", "how do you say" and "I do not understand" in the target language.
6. **Check the phrases.** Verify uncertain wording and local customs (greetings, titles, tipping, politeness level) with `search_web` and `read_url`, and mark regional differences.
7. **Write a sample dialogue.** A short exchange of eight to twelve lines showing the whole flow, with a translation in a second column.
8. **Add numbers and key words.** List the amounts, times, dates or items that this situation uses, with the forms the learner needs.
9. **Run the role-play.** Offer to play the other person. Use `ask_user` for the learner's replies, answer in character at their level and vary the replies so they cannot memorise a script.
10. **Review.** After the role-play, list what went well, the missed phrases and any error that blocked understanding.
11. **Save the card.** Write the phrasebook with `create_file` as a one-page list ready to screenshot.

## Gotchas

- Phrasebook lines learned by heart fall apart when the answer is unexpected. Practise listening to variants.
- Politeness norms differ by country. A direct request fine in one place sounds rude in another.
- Do not teach very long sentences. Short phrases with clear stress are easier to say and to get right.
- Real staff may speak fast or answer in English. Teach the learner how to ask them to slow down.
- Prices, hours and legal rules change. Do not state them as facts, and tell the learner to check locally.
- Avoid inventing details about a particular business or place. Keep the scenario general unless the user gave specifics.
- Dialogues in books are tidy. Add at least one interruption or misunderstanding.

## Output

The goals, the learner's lines, the replies to expect, repair phrases, one sample dialogue with translation, then the role-play result. Keep each section short.
Give the saved file path if one was made.
