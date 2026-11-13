---
name: few-shot-builder
description: Builds a small set of input and output examples that teach a model a pattern, covering the range of inputs, the exact format and edge cases, while keeping the examples varied and separate from the test cases. Use when the user asks to add examples to a prompt, build few-shot examples or show the model the format.
---

# Few-shot builder

## Goal

Choose and write examples that show a model what you want better than a description does. The set is small, varied and consistent with the written rules, and it is kept apart from the data used to test the prompt.

## When to use

- A prompt describes a format or style but the model keeps missing it.
- A classification, extraction or rewriting task needs a stable pattern.
- The user has real data to turn into examples.
- For judging the prompt after adding examples, use `use_skill` with `prompt-eval-set`.
- For the surrounding prompt text, use `use_skill` with `prompt-rewriter`.

## Steps

1. Ask with `ask_user` for the task, the current prompt, a sample of real inputs and the output the user wants for some of them. Look at files with `read_file` if the data is on disk.
2. List the dimensions that vary in the inputs: length, topic, tone, language, quality, missing fields, ambiguous cases. Your examples must cover the main ones.
3. Decide how many. Start with three to five. Add more only if tests show a gap, because each example costs context and can pull the output towards itself.
4. Pick examples from real data where possible. Include at least one typical case, one edge case (empty, very short, noisy, or odd format) and one case where the right answer is "none" or "cannot tell" if that is allowed.
5. Write the outputs by hand with care. They must follow every rule in the prompt exactly, because the model copies details such as spacing, capitalisation, field order and length.
6. Vary the surface. If all examples start the same way, are the same length or use the same label, the model will copy that accident. Shuffle the order and check the label balance, so one answer is not over-represented.
7. Format each example the same way, with clear delimiters between input and output and between examples. State in the prompt that the examples show format and are not content to reuse.
8. Check for contradictions between examples and rules. If an example breaks a rule, fix the example or the rule.
9. Keep a held-out set of other cases for testing. Never test with the same items used as examples. Save the examples with `create_file` and give the user the assembled prompt block.

## Gotchas

- Examples are stronger than rules. A wrong detail in an example beats a right sentence.
- Real personal data in examples can leak into outputs. Use made-up or cleaned data.
- Too many similar examples teach a narrow pattern and hurt new inputs.
- Order can matter. The last example often has more pull, so do not end on an odd one.
- If outputs vary legitimately, show that range instead of one fixed style.
- Do not claim a number of examples works for every task. Test.

## Output

- The example block and the dimensions it covers.
- Which cases were left out on purpose, and the held-out set path.
- Checks done for consistency with the rules.
- Suggested test steps.
