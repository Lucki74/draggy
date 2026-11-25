---
name: presentation-speaker-notes
description: Writes speaker notes for each slide that add to what is on screen, fit the talk length, and include transitions and cues. Use when the user asks for speaker notes, what to say on each slide, or notes added to a presentation.
---

# Presentation speaker notes

## Goal

Give the speaker words they can say naturally, not a script that repeats the slide. A good set of notes covers each slide in the time it deserves, adds the story or evidence the slide leaves out, and links one slide to the next.

## When to use

- The user has a deck (pptx, outline or pasted text) and wants notes per slide.
- The user has a time limit and wants to know if the talk fits.
- For planning the deck itself, use `use_skill` with `slide-outline`.
- For editing the pptx file or writing notes into it, use `use_skill` with `pptx`.

## Steps

1. Read the deck. For a .pptx, extract slide text and any existing notes with `run_command`. For an outline or pasted text, use `read_file`. List slide number, title and body in a table.
2. Ask with `ask_user` for the slot length, the audience, the speaker's own style (formal, casual, story-led) and whether the notes should be full sentences or cue bullets. Ask about speaking pace only if the talk is tight.
3. Allocate time. Divide the total minutes across slides by weight, giving title and divider slides a few seconds and chart or argument slides more. Write the target seconds on each slide.
4. Write the notes per slide in this order: the point in one spoken sentence, the one thing to add that is not on the slide (an example, a number's meaning, a short story), and the lead-in to the next slide.
5. Mark cues in square brackets: [pause], [click], [show chart], [ask the room]. Keep them few.
6. Keep facts true to the source. Where a note needs a statistic or quote that the deck does not hold, write "[add: figure for X]". Never make one up.
7. Check length. Count words per slide with `run_command` and compare with the time at about 130 words per minute for normal speech. Trim slides that run over their time.
8. Deliver the notes as a document with `create_file`, or write them into the pptx notes field if the user asked and the file is backed up first.
9. Prepare the speaker for the parts that usually go wrong.
   - List two likely questions per major section with a short answer drawn from the deck or source.
   - Mark the one slide to cut first if time runs short, and the one to never cut.
   - Add an opening line and a closing line written to be said, not read.
   - Suggest a rehearsal with a timer, and ask them to report the actual time so the notes can be trimmed.
10. Keep the notes in the order of the slides, with slide numbers, so they survive reordering.

## Gotchas

- Reading the slide aloud wastes the notes and bores the room. If the note equals the slide text, delete the note and say something new.
- Full-sentence scripts get read in a monotone. For confident speakers use cue bullets, for nervous ones use short sentences, and ask which.
- Total word count can fit while the pacing does not: five slides of dense charts need more time than twenty image slides.
- Humour, personal stories and claims about the speaker's own experience are not yours to invent. Use placeholders.
- Notes written into the file overwrite existing ones. Show existing notes first and keep them unless told otherwise.
- Notes for an online talk differ from a room talk. Screen sharing hides the speaker's own notes view in some tools, so ask where the notes will be read from.

## Output

- The opening and closing lines, set apart from the per-slide notes.
- Per slide: target seconds, the notes and any cues, in slide order.
- A timing summary against the slot, with the slides to cut if it runs long.
- A list of placeholders the speaker must fill.
