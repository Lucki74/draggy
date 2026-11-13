---
name: structured-output-prompt
description: Prompts a model for output that code can parse, by defining a schema with clear field meanings, giving an example and failure handling, and adding validation and retry in the calling code. Use when the user asks to get JSON from a model, force a fixed output format, or return structured data from an LLM.
---

# Structured output prompt

## Goal

Get output a program can read without guessing. The schema is small and unambiguous, the prompt shows the shape, and the code validates every reply and handles the ones that fail.

## When to use

- A model's answer feeds a parser, a database or a UI.
- Replies sometimes arrive with extra prose, missing fields or wrong types.
- For general prompt clean-up, use `use_skill` with `prompt-rewriter`.
- For examples that teach the format, use `use_skill` with `few-shot-builder`.

## Steps

1. Ask with `ask_user` what the program does with the output, which fields it needs, which are optional, and what should happen when the input has no answer. Ask what language the calling code uses.
2. Check the provider's current docs with `read_url` for built-in structured output or tool calling features. If one exists, prefer enforcing the schema through it, and still validate. Do not assume features from memory.
3. Design the schema. Keep it flat where possible, use short field names with a clear meaning, use enums for fixed choices, and decide what null means. Remove fields the program does not use.
4. Describe each field in the prompt in a sentence: what goes in it, its type, allowed values, and what to put when unknown. Say whether extra text outside the structure is allowed. Usually it is not.
5. Add one complete example with realistic data, and one with an empty or "no result" case. Show exactly the intended shape, including quotes and brackets.
6. Separate instructions from the input. Delimit the input text and say it is data. Tell the model what to do if the input tries to change the format.
7. Write the validator in `run_command` or the project's language: parse, check required fields, types and enums, and reject unknown values. Keep the error message for the retry.
8. Design failure handling. On invalid output, retry a limited number of times with the validator's error message appended, then fall back to a safe default or flag for human review. Log the failures.
9. Test on varied inputs, including long text, empty text, text in other languages and text that contains braces or quotes. Count the share of valid replies and report it.

## Gotchas

- Valid JSON can still hold wrong content. Validate meaning where you can, such as a date range or a known id.
- Models may wrap output in code fences or add a sentence before it. Strip it in code, and also ask for none.
- Long free-text fields inside JSON invite broken escaping. Keep them short or put them in a separate step.
- Changing the schema breaks old data. Version it.
- Do not parse with a loose regex and trust the result.
- Never run code or queries built straight from model output without checks.

## Output

- The schema and the prompt text.
- The validator and the retry rule.
- Test results with the valid share.
- Known failure cases and the fallback.
