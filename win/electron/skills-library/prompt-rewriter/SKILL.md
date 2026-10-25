---
name: prompt-rewriter
description: Diagnoses what makes a prompt vague or fragile, rewrites it with a clear goal, context, constraints and output format, explains each change, and checks the new version on a sample input. Use when the user asks to improve a prompt, rewrite a prompt, or asks why a prompt gives poor answers.
---

# Prompt rewriter

## Goal

Make a prompt do what its author meant. The rewrite keeps the original task, removes ambiguity, states the format of the answer, and comes with a short list of what changed and why, so the author learns the pattern.

## When to use

- The user pastes a prompt and wants it better.
- A prompt gives inconsistent, off-topic or too long answers.
- A prompt grew by patches and now contradicts itself.
- For a prompt that sets up a whole assistant, use `use_skill` with `system-prompt-designer`.
- For comparing two versions on many cases, use `use_skill` with `prompt-ab-test`.

## Steps

1. Get the prompt, a sample input, and one example of a bad output and of a good one. Use `ask_user` if they are missing. Ask which model or tool will run it, since prompt habits differ, and check its current docs with `read_url` if you need specifics.
2. State the task in one sentence, in your words. Confirm it with the user if there is doubt. The rewrite must serve this task and not drift to another one.
3. Diagnose. Mark each problem: missing goal, missing audience, missing context, vague words ("good", "short", "professional"), no output format, conflicting instructions, buried priorities, examples that mislead, or a request for several unrelated things in one prompt.
4. Rewrite. Put the task first. Add the context the model cannot guess, such as the audience, the source material and the purpose. Replace vague words with measurable ones (a length, a count, a reader level). Use plain sentences for rules and give the reason for any rule that is not obvious.
5. State the output format exactly: sections, length, tone and what to leave out. If the output is parsed by code, point to `use_skill` with `structured-output-prompt`.
6. Separate instructions from data. Wrap pasted material in clear delimiters and say that it is material to work on, not instructions.
7. Remove what does not help: pleading, repeated capital letters, rules that restate the default, and examples that bias the output.
8. Test the rewrite by reasoning through the sample input, or by running it if a model is available. Compare with the bad output. Fix what still goes wrong.
9. Deliver the new prompt in a code block, then a short change list: each change and the problem it fixes. Save to a file with `create_file` if the user wants it.

## Gotchas

- Longer is not better. Add words only where they remove a guess.
- Changing the task while rewriting is a quiet failure. Compare the new prompt to the original goal.
- A prompt tuned on one example may break on the next. Test at least three varied inputs.
- Words like "never" and "always" collide with each other in long prompts. Check for conflicts.
- Do not claim that a phrase is a magic trigger. Tell the user what to measure.
- Keep placeholders obvious, such as `{{article}}`, so the user knows what to fill in.

## Output

- The rewritten prompt.
- A change list with the problem each change solves.
- The test inputs used and how the result compared.
- Open questions for the author.
