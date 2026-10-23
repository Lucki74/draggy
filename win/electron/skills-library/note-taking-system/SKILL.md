---
name: note-taking-system
description: Sets up a note-taking method for the user's actual courses or work, choosing between outline, question-and-answer, linked notes and similar styles, and creating a template, folder layout and weekly review. Use when the user asks how to take notes, wants a note system, or says their notes are a mess.
---

# Note-taking system

## Goal

Leave the user with a small, working system: one way to capture, one way to process, one place to find things. It fits how they study or work, and costs less time to run than it saves.

## When to use

- The user starts a course, job or research project and wants a method.
- The user has piles of notes they cannot use.
- The user has a single set of messy lecture notes to fix now: use `use_skill` with `lecture-notes-cleanup`.
- The user wants one-page revision summaries: use `cheat-sheet-maker`.

## Steps

1. **Learn the situation.** Use `ask_user` about what they take notes from (lectures, books, meetings, videos), on what tool (paper, laptop, app), how they use notes later (exams, writing, projects) and what goes wrong now.
2. **Look at what exists.** If notes are on disk, use `list_directory` and `read_file` on a few to see names, structure and length.
3. **Pick a capture style.** Match to the source. Structured lectures suit an outline. Dense reading suits question-and-answer or margin notes. Idea work suits short linked notes, one idea each. Fast talk suits keywords now and cleanup later.
4. **Define the unit.** Decide what one note is: one lecture, one idea, one book chapter. State the rule in a sentence.
5. **Set the naming and folders.** Choose a short, predictable name pattern with the date or course first. Keep folder depth at two levels. Create the layout with `create_file` or `run_command`.
6. **Write the template.** Create a note template with only fields the user will fill: title, date, source, key points, questions, action. Delete any field that stays empty after a week.
7. **Add the process step.** Within a day, turn raw notes into a short summary and one or two questions written in the margin. This is the part that builds memory.
8. **Add retrieval.** Pick how the user will find things: tags kept to a short list, an index note per course, or search by title pattern.
9. **Set a weekly review.** Fifteen minutes: merge loose notes, update the index, copy questions to practice.
10. **Trial it.** Ask the user to run it on one real session and report friction. Adjust once.
11. **Plan the backup.** Say where the notes are stored and how they are copied, so a lost laptop does not erase a term of work.

## Gotchas

- A complex system dies in a month. Start with the minimum and add a rule only when a problem repeats.
- Verbatim transcription feels diligent and teaches nothing. Notes should be in the user's own words.
- Tags multiply into thousands. Cap them, or lean on titles and links.
- Handwriting versus typing is a personal and situational choice. Ask what works, do not impose one.
- Moving old notes into a new system costs days. Start the system fresh and migrate only what is used.
- Colour codes and icons need a legend and discipline. Skip them until the basics hold.
- Linking everything to everything creates a web nobody follows. Link only where one note truly depends on another.

## Output

A one-page description of the system (capture, process, find, review), the template text, and the folder layout. Keep it short enough to follow without rereading.
