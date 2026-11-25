---
name: dialogue-polish
description: Revises dialogue so each speaker sounds distinct, subtext carries the meaning, and tags, beats and punctuation stay light. Use when the user says "fix my dialogue", "this conversation feels stiff" or "make the dialogue more natural".
---

# Dialogue polish

## Goal

Make characters sound like themselves and want different things in the same exchange. Good dialogue reads fast, does more than one job (reveals, hides, pushes) and never explains what the characters already know.

## When to use

- A scene reads as two people trading information.
- All speakers sound the same.
- The user wants lines cut, sharpened or given more subtext.

For a whole scene, use `scene-writer`. For a character's voice from scratch, use `character-profile`. For screenplay layout, use `screenplay-format`.

## Steps

1. **Read the passage.** Call `read_file` if it is in a file, otherwise work from the paste. Ask with `ask_user` for who is speaking, what each wants in the scene and the genre, only if unclear.
2. **Mark the purpose of each line.** Write a short note per line: reveals, conceals, pressures, deflects, bonds. Lines with no purpose are candidates for cutting.
3. **Find the "as you know" lines.** Mark any line that tells the other character something they already know, solely for the reader. Replace with action, a short reference or move it to narration.
4. **Differentiate voices.** For each speaker, pick two habits: sentence length, formality, interruptions, favorite verbs, questions versus statements, what they avoid saying. Apply them to the lines.
5. **Add subtext.** Where a character states what they feel, make them talk about something nearby instead. Let a question dodge a question.
6. **Trim.** Delete greetings, filler and repeated agreement. Start late into the exchange and leave early.
7. **Fix the tags.** Prefer "said" or no tag when the speaker is clear. Replace stage-business tags ("he growled") with an action beat only when it adds meaning.
8. **Check rhythm.** Read aloud, or ask the user to. Mixed line lengths, occasional fragments and interruptions help. Trim any speech longer than about four sentences unless it is a deliberate monologue.
9. **Use dialect lightly.** Show accent with word choice and rhythm, not heavy phonetic spelling.
10. **Return the edit with a short change log.** List what you changed and why, in at most five lines.
11. **Check the whole scene.** Read the speeches in a row without tags. The reader should still tell who talks. If not, change vocabulary or rhythm.
12. **Keep one flagged original.** Where a line was cut or changed a lot, keep the original in the log, so the author can restore it.

## Gotchas

- Real speech is full of ums and false starts. Transcribe it and the page drags. Give the feel of speech, not a recording.
- Two characters who agree politely for a page produce no scene. Give them different goals.
- Using the other character's name in every line is a tell. People rarely say each other's names in conversation.
- Heavy dialect spelling is hard to read and can look mocking. Use syntax and vocabulary.
- Do not fix the voice by pushing every character to the writer's own voice. Keep each person's habits steady across scenes.
- Cutting too much can remove the quiet beat that makes a reply land. Keep a pause where silence speaks.
- Giving the clever lines to every character makes them all sound like the author. Let someone be dull or wrong.
- Silence and interruption carry meaning. Do not tidy all the broken sentences into full ones.

## Output

The revised passage, then a change log of up to five lines. Keep the user's plot facts and names. If you cut a line that carried a plot fact, say where the fact now lives.

If the passage is long, work on the first two pages and offer to continue, so the author can approve the approach before the rest.
