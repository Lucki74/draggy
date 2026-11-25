---
name: learn-from-error
description: Analyses a wrong answer or a failed attempt to find what kind of mistake it was and why it happened, then sets one short drill aimed at that cause. Use when the user asks why they got something wrong, wants to review their mistakes, or keeps repeating the same error.
---

# Learn from error

## Goal

Turn a mistake into a fix. The agent finds the real cause behind a wrong answer instead of handing over the correct one, names the pattern if there is one, and gives a small drill the user can do today.

## When to use

- The user shares a marked test, a wrong solution or a failed attempt.
- The user says they keep making the same kind of mistake.
- The user wants new practice material on a topic: use `use_skill` with `practice-problems`.
- The user wants the solution walked through from the start: use `math-step-by-step`.

## Steps

1. **Collect the evidence.** Use `read_file` for the work, or ask the user to paste the question, their answer and the correct one. Ask for their working as well as the result, using `ask_user`.
2. **Find the first wrong step.** Read the working line by line and mark where it first leaves the correct path. Later errors often follow from that one.
3. **Ask the user to explain that step.** What were you thinking here? Their reasoning shows whether the cause is a belief, a habit or a slip.
4. **Classify the error.** Choose one: knowledge gap (did not know the fact or rule), concept error (holds a wrong model), method error (right idea, wrong procedure), reading error (misread the question), slip (right method, execution error), time pressure.
5. **Find the root.** For a concept error, state the wrong model in one sentence and the correct one next to it. For a method error, name the missing check.
6. **Look for a pattern.** If several mistakes are shared, group them. Two errors with one cause need one fix.
7. **Write a correction.** Give the right solution at the first wrong step, with the reason, in a few lines. Do not redo the whole problem.
8. **Design the drill.** Create three to five short items that target the cause, such as sorting examples into right and wrong or fixing a flawed solution. Save with `create_file` if the user wants it.
9. **Add a prevention habit.** One small action: underline what is asked, write units each line, check the answer by estimating.
10. **Schedule a recheck.** Suggest redoing a similar problem in a few days, without notes.
11. **Log the pattern.** Add the error type and fix to a running list the user keeps, and read it before the next test.

## Gotchas

- "Careless mistake" is the label people give to everything. Check whether the same slip appears again before calling it that.
- Giving the correct answer first removes the chance for the user to find their own error. Ask for the reasoning first.
- A concept error survives repeated corrections of single answers. Replace the model, not the output.
- Marks lost from poor time use need a time plan, not more content study.
- Do not drill the whole topic. A drill aimed at the cause is short.
- Feedback with blame lowers effort. Describe the step, not the person.
- A lucky right answer hides the same weakness. Ask about correct answers that were guesses too.

## Output

Four short parts: where it went wrong, the type and cause, the corrected step, the drill. Keep the tone plain and the length to what the user needs.
