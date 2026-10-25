---
name: toast-writer
description: Writes a toast of one to three minutes for a wedding, retirement, birthday or milestone, built on one true story, one turn and a raised glass. Use when the user says "write a wedding toast", "best man speech" or "retirement toast".
---

# Toast writer

## Goal

Give the speaker something they can say aloud, from memory or a card, that moves the room. A good toast is short, warm, specific to the honoree, easy to speak and ends with a clear cue to raise glasses.

## When to use

- A wedding, engagement, anniversary, retirement, birthday, farewell or award.
- The user must speak for one to three minutes at a meal or gathering.
- A draft toast runs long, rambles or leans on inside jokes.

For longer speeches, use `use_skill` with `speech-writer`. For jokes, add `joke-and-humor-writer`. For a written card, use `thank-you-note`.

## Steps

1. **Collect the facts.** Call `ask_user` for: who is honored, the speaker's relationship, the occasion, the audience (family, colleagues, mixed), the time limit, the tone, and names to mention with correct spelling. Ask for topics to avoid.
2. **Get one story.** Ask for a real moment that shows the honoree's character, not a list of virtues. It should take under 40 seconds to tell.
3. **Find the point.** Write the one thing the story shows: loyal, stubborn, generous, funny. State it in a sentence. This is the toast's spine.
4. **Plan the shape.** An opening line that greets and names the speaker's link. The story. The turn to a wish or a quality. The raise of the glass. Aim for about 130 words per minute of speaking.
5. **Draft for the ear.** Short sentences, simple words, the key word at the end of the line. Use "you" and "we" for the room. Avoid reading-only phrasing.
6. **Add light humor if it fits.** One or two gentle lines at the speaker's own expense or about harmless quirks. Use `use_skill` with `joke-and-humor-writer` for more.
7. **Include the other person at weddings.** Mention both partners, a sentence about what they bring out in each other, and no stories about past relationships.
8. **Write the ending.** A wish in one sentence and a cue: "Please raise your glasses to Maya and Tom." End on the names.
9. **Time it.** Use `run_code` to count words, then divide by about 130 to estimate minutes. Cut to fit.
10. **Make a speaking card.** Offer a version in short lines with marked pauses for the speaker to hold.
11. **Check the guest list sensitivities.** Ask about divorced parents, absent family, recent losses or rivalries that the toast should avoid.
12. **Confirm the order of speakers.** If others speak before or after, ask what they will cover so stories do not repeat.

## Gotchas

- An inside joke that only three people understand leaves the rest of the room waiting. Explain it in a clause or drop it.
- Stories that embarrass the honoree, mention exes, drinking or money can sour the event. Run anything risky past the user first.
- Toasts that run past three minutes lose the room. Cut the second story.
- Thanking everyone in the family by name turns it into a list. Thank the hosts in one line.
- Reading from a phone screen reads as flat. Suggest a card and one practice run aloud.
- Do not invent facts about the honoree. Use what the user gave. Ask for gaps.
- Alcohol makes people loose on stage. Suggest keeping the toast written and practiced, with a card.
- Starting with "Webster's dictionary defines" or a quote search result is a tired opening. Start with the person.

## Output

The toast text with paragraph breaks at natural pauses, then a single line with the word count and estimated time. If asked, add a shorter 60-second version after it.

If the event is formal or multilingual, add a line on cultural customs to check, such as who speaks first.
