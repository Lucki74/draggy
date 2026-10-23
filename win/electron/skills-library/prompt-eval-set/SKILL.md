---
name: prompt-eval-set
description: Builds a labelled set of test cases with expected behaviour and a scoring rubric so prompt changes can be compared fairly, covering typical, edge and adversarial inputs and keeping a held-out portion. Use when the user asks for a test set for a prompt, how to evaluate a prompt, or an eval for an LLM feature.
---

# Prompt eval set

## Goal

Give the user a repeatable way to say whether a prompt change helped. The set mirrors real use, each case states what good looks like, scoring can be applied the same way each time, and a held-out part guards against tuning to the test.

## When to use

- A prompt is about to change and the user wants proof it improved.
- A feature built on a model keeps regressing.
- Before comparing prompts, use this, then `use_skill` with `prompt-ab-test`.
- For scoring the outputs, use `use_skill` with `llm-output-grader`.

## Steps

1. Ask with `ask_user` what the prompt does, who uses it, what failures hurt most and where real inputs can be found: logs, tickets, files. Read samples with `read_file`. Remove or mask personal data before using any real input.
2. Define success per case type. Is the answer a label, a fact, a format, or free text judged on quality? That sets how it will be scored.
3. Build the case list in groups: typical inputs in proportion to real use, edge cases (empty, huge, mixed languages, odd formats), cases the model should decline or flag, and adversarial inputs aimed at the prompt's rules. Aim for enough cases per group to see a pattern, and state the size you chose and why.
4. For each case write: id, input, expected behaviour or reference answer, the failure it targets, and the weight. Where several answers are valid, describe the properties rather than one string.
5. Write the rubric. Prefer yes or no checks: format valid, required field present, no invented source, correct label, within length. Add a small quality scale only where needed, with anchored descriptions for each level.
6. Mark checks that code can do (schema validation, regex, exact label match) and implement them with `run_code`. Leave the rest to a person or a model grader.
7. Split the set. Keep a held-out part that is not used when tuning the prompt, and look at it only for the final comparison.
8. Run the current prompt over the set to get a baseline. Read a sample of failures by hand to confirm the rubric judges what you meant, and fix cases that are unclear.
9. Save cases and rubric as files with `create_file`, with a version tag, and write down how to rerun them and what changes require adding cases.

## Gotchas

- Only easy cases hide regressions. Include the failures users complained about.
- A rubric two people apply differently is not a rubric. Test it on a few cases with a second reader.
- Tuning on the test set inflates scores. Keep the held-out part sealed.
- Models can vary run to run. Repeat runs and report the spread.
- Do not hard code model names or limits in the set. Record the settings used in each run.
- Sets go stale as use changes. Add new failures as cases when they appear.

## Output

- The case file path and group sizes.
- The rubric and which checks are automated.
- The baseline result and the held-out split.
- How to rerun and when to extend the set.
