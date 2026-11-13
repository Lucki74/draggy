---
name: scratchpad-notes
description: Keeps a running notes file during long or exploratory work, with findings, hypotheses, dead ends and next steps, and rereads it so work is not repeated and nothing is lost in a long session. Use when the user asks to keep notes while working, track findings in a file, or when a task spans many files and attempts.
---

# Scratchpad notes

## Goal

Hold the details of ongoing work outside the conversation. The notes record what was found, what was tried and what is next, stay short enough to reread, and are kept away from the project's tracked files.

## When to use

- A debugging or research task will run through many attempts.
- You are exploring a codebase and learning facts you will need again.
- The user asks you to keep notes or track findings.
- For turning notes into a report at the end, use `use_skill` with `session-summary`.
- For notes aimed at another session, use `use_skill` with `context-handoff`.

## Steps

1. Pick a location outside the repository, such as the session's scratch folder, or ask with `ask_user` if the user wants it elsewhere. Create the file with `create_file` and a short heading with the task and the date.
2. Set up four sections: Facts (verified, with source), Hypotheses (each marked open, confirmed or rejected), Tried (action and result), and Next (the next two or three steps).
3. Record facts as you learn them with the path and line or the command that showed them. A fact without a source belongs under Hypotheses.
4. Before trying something, write the hypothesis it tests and the result that would confirm it. After, record the outcome in a line.
5. Record dead ends clearly, including the exact error text. That stops you retrying the same thing later in the session.
6. Use `edit_file` to update entries in place instead of appending contradictions. When a hypothesis is rejected, mark it and keep the reason.
7. Reread the file with `read_file` at natural pauses: before a new approach, after a long step, and when you feel lost. Decide the next action from the file.
8. Keep it tight. Trim old detail that no longer helps once an area is settled, and fold it into one line.
9. At the end, either hand the notes to the user (path and a two-line summary) or delete the file if the user wants no leftovers and it holds nothing they need.

## Gotchas

- Notes inside the project folder get committed or shipped. Keep them outside.
- Never copy secrets or tokens into notes.
- A scratchpad that you never reread is a diary. Use it to decide.
- Notes grow. A five-hundred-line file is as hard to use as the conversation.
- Mixing facts and guesses corrupts both. Keep the sections apart.
- Do not present guesses from the notes as findings in the final answer.

## Output

- The notes file path and its current section sizes.
- The confirmed facts and rejected hypotheses, briefly.
- The next step recorded in the file.
