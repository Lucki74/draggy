---
name: chain-of-thought-structure
description: Structures multi-step reasoning in a prompt or pipeline by deciding when to ask for steps, when to split the task into chained calls with checks between them, and how to verify results without trusting stated reasoning as proof. Use when the user wants a model to reason step by step, the model skips steps on hard tasks, or a prompt should be split into stages.
---

# Chain-of-thought structure

## Goal

Give hard tasks a shape that helps a model get them right: the right amount of working-out, stages that can be checked, and verification that does not depend on the model's own explanation being true.

## When to use

- A task needs several dependent steps: calculation, planning, multi-document analysis.
- A single prompt gives answers that look fluent and are wrong.
- A pipeline of calls needs its stages designed.
- For testing the result, use `use_skill` with `prompt-eval-set`.
- For machine-readable intermediate results, use `use_skill` with `structured-output-prompt`.

## Steps

1. Ask with `ask_user` for the task, a few example inputs with known right answers, the current prompt and the typical failure. Collect the failures with `read_file` if saved.
2. Classify the failure. Is it a skipped step, a wrong fact, an arithmetic slip, a missed constraint, or a wrong overall approach? The cure differs for each.
3. Decide whether to ask for visible working. For multi-step problems, asking the model to work through the steps before giving the final answer often helps. For simple lookups or short answers it adds length without value. Check the provider's current docs with `read_url` for features that provide reasoning modes, since these change.
4. If you ask for working, put it in a separate, clearly marked place from the final answer, for example a section for steps and a section for the answer, so code or readers can use the answer alone.
5. Consider splitting into stages when one prompt holds too many jobs. Typical split: extract the facts, then decide, then write. Each stage gets a narrow prompt and a defined input and output.
6. Put checks between stages. Use code in `run_code` for what code can verify: arithmetic, counts, schema, dates, references. Use a second prompt for judgment checks, with a rubric.
7. Handle failures at a stage. Retry with the error message, fall back to a simpler path, or stop and flag the item. Limit retries.
8. Do not treat the written reasoning as a faithful trace of why the model answered. It can be wrong or post hoc. Verify the answer against the source or a calculation.
9. Compare designs on the test cases: single prompt, single prompt with steps, and staged chain. Measure accuracy, cost and time, and pick the simplest design that meets the bar. Record the results.

## Gotchas

- More stages mean more cost, delay and places to break. Add one only for a measured gain.
- Asking for steps on a trivial task bloats the output.
- Errors compound down a chain. A bad extraction poisons every later stage, so check early.
- Visible reasoning may include material you do not want to show users. Separate it from the answer.
- Do not assume what a given model does internally. Test on your cases.
- Keep the stage prompts short and single purpose.

## Output

- The chosen structure with stage prompts and checks.
- The failure type it addresses.
- Comparison results across designs.
- Remaining failure cases.
