---
name: learning-journal
description: Sets up and runs a short learning journal where the user records what they learned, what stayed unclear and what to practise next, then reviews the entries each week to guide the next sessions. Use when the user wants to reflect on learning, track progress, or start a study journal.
---

# Learning journal

## Goal

Build a light habit of reflection that makes study better. Each entry takes a few minutes, ends with a question for the next session, and feeds a weekly review that changes what the user does next.

## When to use

- The user wants to track and improve how they learn a skill or course.
- The user finishes sessions and cannot say what they got from them.
- The user wants a general study timetable: use `use_skill` with `study-plan`.
- The user wants to log a project's engineering decisions: use `adr-writer`.

## Steps

1. **Understand the aim.** Use `ask_user` for the subject, how often the user studies, the tool they prefer (paper, a note app, a file in a folder) and how many minutes they will give to the journal.
2. **Set the format.** Keep it to five prompts: what I studied, what I can now do or explain, what is still unclear, how I felt about it (focus, difficulty), and what I will do next time. Cap each answer at one to three lines.
3. **Create the file.** Use `create_file` for a journal file with a header and an entry template. If the user has a notes folder, check the layout with `list_directory` and follow its naming.
4. **Run the first entry together.** After a study session, ask the five prompts one at a time with `ask_user`. Write the answers as the first entry with the date.
5. **Push for specifics.** If the user writes "learned about loops", ask "which kind, and what could you not do yesterday that you can today". Specific entries are useful ones.
6. **Turn unclear points into tasks.** For each unclear item, write a concrete next action: a question to look up, an example to try, a person to ask.
7. **Add the question for next time.** End each entry with one question to answer at the start of the next session. This is a built-in recall test.
8. **Start each session with the last entry.** Read it with `read_file`, ask the question, and see what stuck.
9. **Do the weekly review.** Read the week's entries. Count repeated unclear points, estimate hours, note which methods worked. Write a short summary and two changes for next week using `edit_file`.
10. **Prune.** After a month, check if any prompt is skipped or empty and remove it.
11. **Celebrate evidence.** At month end, list three things the user can now do that they could not before, with the entry dates that show it.

## Gotchas

- Journals become diaries when they grow long. Keep entries short and about learning.
- Skipping the next-time question loses the benefit. It is the part that connects sessions.
- Judging feelings as results is a trap. "Felt hard" is data, not failure.
- A journal that takes longer than the study gets dropped. Cut prompts until it fits in five minutes.
- Do not ask for private details beyond the learning. Stay with study content.
- Progress claims need evidence. Add a dated example of work done, such as a solved problem or a finished page.
- A missed week is not a failure. Restart with one line, not a catch-up of every day.

## Output

The journal file path, the template, and the first entry. In later use, a brief reply with the entry saved and the question for next time. The weekly review is a short paragraph and two actions.
