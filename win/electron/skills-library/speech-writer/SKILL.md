---
name: speech-writer
description: Writes speeches, toasts, spoken presentation scripts and talks meant to be heard rather than read, timed to a target length. Use when the user needs a wedding toast, keynote, eulogy, pitch, team talk, or says "write a speech" or "something I can say out loud".
---

# Speech writer

## Goal

Produce text written for the ear: short sentences, repetition that helps memory, and signposts that tell listeners where they are. A good result fits the requested time, sounds like the speaker, and can be delivered in one breath per sentence.

## When to use

- The user needs a toast, keynote, eulogy, pitch, team talk or any text to be spoken aloud.
- The user wants a spoken script for a presentation.
- For a letter or email meant to be read, use `use_skill` with `formal-letter` or `email-writer`.

## Steps

1. Gather the brief. Find out or infer the occasion, the audience, the speaker's relationship to them, the length in minutes, the tone (moving, funny, rallying, formal), and any stories, names or facts that must appear. Ask for the essentials in one message with `ask_user` if they are missing. Speaking pace is about 130 words per minute, so a 3-minute toast is about 400 words.
2. Open strong. Win attention in the first 20 seconds with a story, a striking line or a direct connection to the room. Introduce the speaker only if needed.
3. Build the body from three main points or moments at most. Give each a story or concrete example, not a list of adjectives.
4. Add signposts: "First...", "That brings me to...", "Which is why...".
5. Close by returning to the opening image or line, then end with a clear action: the toast itself, the call to action, the thank-you.
6. Edit for speech. Keep sentences short enough to say in one breath. Prefer concrete details ("she drove four hours in the snow") over abstractions ("she is dedicated"). Replace words that are hard to pronounce together. Read the text in your head for rhythm.
7. Check the word count against the target time and trim or extend.

## Gotchas

- Written prose read aloud sounds stiff. Long sentences, nested clauses and parentheses do not survive speech.
- Humour must include the audience and never humiliate anyone present.
- At weddings and eulogies, in-jokes that most of the room will not get leave listeners out. Cut them.
- Names, dates and facts the user did not give you are not yours to invent. Leave a clear placeholder instead.
- Overusing (pause) marks clutters the script. Mark only the pauses that matter.

## Output

The speech in short paragraphs, with line breaks where the speaker should pause and (pause) marked sparingly. State the estimated speaking time at the top. At the end, offer one alternative opening or closing line.
