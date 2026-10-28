---
name: llm-output-grader
description: Grades a batch of model outputs against a written rubric with per-criterion scores and quoted evidence, applies the same standard to every item, and flags the items where the grade is uncertain. Use when the user asks to grade model answers, score the outputs of a prompt, or review LLM responses against criteria.
---

# LLM output grader

## Goal

Turn a pile of model outputs into consistent, explainable scores. Each grade points to evidence in the output, the same rubric is applied to every item in the same way, and doubtful calls are marked for a person.

## When to use

- The user has outputs from a prompt and wants to know how good they are.
- A prompt comparison needs a scoring pass.
- For making the cases and rubric, use `use_skill` with `prompt-eval-set`.
- For running two versions side by side, use `use_skill` with `prompt-ab-test`.

## Steps

1. Ask with `ask_user` for the outputs (and the inputs that produced them), the rubric if one exists, and what the grades will be used for. Load them with `read_file`. Count the items.
2. If there is no rubric, write one with the user: three to six criteria, each phrased as something observable. Examples: answers the question asked, every claim is supported by the supplied text, follows the format, correct tone for the reader, no unsafe content.
3. Define a scale per criterion with anchors. For example, 0 fails, 1 partly meets with a named flaw, 2 fully meets. Write a one-line description of each level. Keep scales short so graders agree.
4. Calibrate on a few items first. Grade five by hand, check that the anchors give clear answers, and adjust unclear wording before grading the rest.
5. Grade each item against the rubric one criterion at a time, with the input at hand. For every score below the top level, quote the phrase of the output that justifies it, or note what is missing.
6. Check facts against the source, not against your own impression. Where the output makes a claim, compare it to the input text or a reference answer.
7. Resist style bias. Do not reward length, confident tone or polish for their own sake. Do not penalise an unusual but correct approach.
8. Flag uncertainty. Mark items where two readings of the rubric give different grades, where you lack the knowledge to judge, or where the input was ambiguous. Those go to a person.
9. Re-grade a random sample of about a tenth of the items later without looking at your first grades. Compare, and if agreement is low, tighten the rubric and redo the affected criteria.
10. Write results to a file with `create_file`, one row per item with the scores, evidence and flags, and compute summary numbers with `run_command`. Report per-criterion averages and the common failure types.

## Gotchas

- The grader's drift over a long batch is real. The re-grade sample catches it.
- Grading while knowing which prompt version made the output biases scores. Hide it when you can.
- Model graders favour their own style and longer answers. Check the grader against human grades on a sample.
- A single overall score hides what failed. Keep per-criterion scores.
- Do not grade private or sensitive text outside the place the user allowed.
- Scores are a measurement tool, not a verdict. Say what the numbers cannot tell.

## Output

- The results file path and the summary table.
- The most common failure types with example ids.
- The flagged items and the agreement from the re-grade.
- Changes to the rubric that would help.
