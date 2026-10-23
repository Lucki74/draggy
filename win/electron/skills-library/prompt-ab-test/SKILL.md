---
name: prompt-ab-test
description: Compares two prompt versions on the same cases with one rubric, runs each case more than once, and reports the difference with its uncertainty and the cases that moved, so a change is kept only when the evidence supports it. Use when the user asks which of two prompts is better, wants to compare prompt versions, or wants to A/B test a prompt change.
---

# Prompt A/B test

## Goal

Decide between two prompts with evidence. Only one thing differs between versions, both run on identical cases and settings, scoring is blind to the version, and the report says how sure the result is.

## When to use

- A prompt was edited and the user wants to know if it is better.
- Two candidate prompts exist and one must be picked.
- A test set is needed first: use `use_skill` with `prompt-eval-set`.
- For the scoring step on free text, use `use_skill` with `llm-output-grader`.

## Steps

1. Ask with `ask_user` for the two prompts, the test cases, the success criteria and the costs that matter: quality, length, speed, price. Check that the cases come from real use and that some are held out from earlier tuning.
2. Write down the difference between A and B in one line. If more than one thing changed, say which parts matter or plan separate tests. A result with several changes cannot say which one worked.
3. Fix everything else: same model, same settings, same input order, same date. Record the settings in a file with `create_file`. If sampling is random, plan several runs per case.
4. Decide the scoring before running. Use the rubric from the test set, with automatic checks in `run_code` for what code can judge and a written scale for the rest. Decide what counts as a meaningful difference up front.
5. Run both versions over all cases. Save every output with the case id and version. Mix the order of runs so that drift in conditions does not favour one version.
6. Hide the version when judging free text. Shuffle outputs into pairs labelled by position and score without knowing which is which, or have a second reader do it.
7. Score and tabulate: per case, per group of cases, overall. Count wins, ties and losses as well as average scores.
8. Judge the uncertainty. With few cases or noisy scores, a gap may be chance. Report the spread across repeated runs, show the cases that flipped, and say if more cases are needed. Do not report significance you did not calculate.
9. Read a sample of outputs where the versions differ. Check that the score reflects real quality and not length, formatting or a rubric quirk.
10. Recommend: ship A, ship B, or gather more data. List the regressions of the winner and the cost differences.

## Gotchas

- Picking the winner on a few favourite examples is anecdote. Use the full set.
- Longer answers often score higher by default. Control for length or add a length check.
- Tuning on the test cases and then testing on them inflates results.
- A better average can hide a worse tail. Look at the worst cases.
- Provider settings and models change over time, so rerun old comparisons before relying on them.
- Do not claim a model-specific cause for a difference. Report what you measured.

## Output

- The settings file and the outputs path.
- The table of results with wins, ties and losses.
- The uncertainty statement and the flipped cases.
- The recommendation and its trade-offs.
