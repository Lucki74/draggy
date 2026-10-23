---
name: lecture-notes-cleanup
description: Turns messy lecture notes or a raw transcript into structured study notes with headings, definitions, examples and a list of open questions, without adding content the lecture did not contain. Use when the user asks to clean up, organise or tidy class notes, or to turn a lecture transcript into notes.
---

# Lecture notes cleanup

## Goal

Return notes the user can study from: the lecture's order and emphasis preserved, shorthand expanded, fragments joined, and every doubtful spot flagged. Nothing is added from outside unless it is marked as an addition.

## When to use

- The user pastes or points to rough notes, slide dumps or an auto-generated transcript.
- The user wants one tidy document per lecture.
- The user is choosing a long-term system: use `use_skill` with `note-taking-system`.
- The user wants a one-page condensed version: use `cheat-sheet-maker`.

## Steps

1. **Read everything first.** Use `read_file` on the notes or transcript. Note the subject, the date if given, the lecturer's order of topics and the length.
2. **Ask what is known.** Use `ask_user` for the course, any slides or textbook chapter, and the style wanted (outline, prose, Cornell-style with questions on the side).
3. **Find the skeleton.** List the main topics in the order covered. Mark signals the lecturer gave: "this will be on the exam", repeated points, long examples.
4. **Expand shorthand.** Turn abbreviations and arrows into words ("->" as "leads to" or "causes", depending on context). Ask when two readings are possible.
5. **Fix transcript noise.** Remove fillers and false starts. Correct obvious misrecognised terms only when the correct term is clear from the context or the slides.
6. **Write the sections.** Under each heading, give the main point first, then supporting points, definitions in bold-free plain lines and examples marked as examples.
7. **Flag gaps.** Where the notes are cut off, contradictory or unclear, insert a visible marker such as `[unclear: check slides]` instead of guessing.
8. **Pull out the structure.** At the end, add a list of key terms with their definitions from the notes, and a list of questions the lecture raised or the notes could not answer.
9. **Compare with sources.** If slides or a textbook are provided, check names, numbers and definitions against them with `read_file`, and note mismatches.
10. **Save.** Write the cleaned notes with `create_file`, or update the original with `edit_file` only if the user asks. Keep the original untouched otherwise.
11. **Offer a recall pass.** Suggest covering the notes and writing what the lecture argued, then comparing, as the next study step.

## Gotchas

- Smoothing a fragment into a clean sentence can invent a claim. If the original is a few words, keep it short and flag it.
- Transcription errors turn terms into sound-alike words. Check names and technical terms against slides before correcting.
- The lecturer's emphasis is data. Do not flatten a point that was stressed into one line among many.
- Notes in two languages or mixed code and prose need both kept. Do not translate unless asked.
- Merging two lectures into one document hides where one ended. Keep dates and breaks.
- Adding outside facts makes the notes look more complete and wrong about what the class covered. Mark every addition.
- Diagrams drawn on the board are lost in text. Describe each in a line and mark it for the user to redraw.

## Output

The structured notes with headings, key terms and open questions at the end, then a brief list of the flagged gaps and where the file is saved.
