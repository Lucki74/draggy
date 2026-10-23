---
name: extract-function
description: Pulls a block of code into a named function with the right parameters and return value while keeping control flow and results identical. Use when the user asks to extract a function or helper, says a function is too long, or wants a repeated block factored out.
---

# Extract function

## Goal

A block with one clear job becomes a function with a name that says that job, inputs it truly needs and outputs the caller truly uses. The code behaves exactly as before and the calling function reads shorter.

## When to use

- A function does several things and one block stands apart.
- The same block appears in more than one place.
- For a multi-step restructure with a test net, use `use_skill` with `safe-refactor`.
- To rename the result afterwards, use `use_skill` with `naming-review`.
- Review feedback says a function does too much and names the block.
- A comment above a block names what it does, which hints at the function name.

## Steps

1. Read the whole enclosing function with `read_file`. Select the block by what it does, not by line count. A good block has one purpose that can be named in a verb phrase.
2. Run the covering tests with `run_command` for a baseline. If none cover this block, say so and consider a characterisation test first.
3. List every variable the block reads that is defined outside it. These become parameters, unless they are module-level constants or members that stay in scope.
4. List every variable the block assigns that the code after it reads. These become return values. If there are several, return an object or tuple, or reconsider the cut.
5. Check control flow inside the block: `return`, `break`, `continue`, `throw`, `await`, `yield`. A return inside the block would now return from the new function only. Convert it into a returned signal or choose a different block.
6. Check for mutation. If the block modifies an argument in place, decide whether the new function should keep doing that or return a new value, and keep the behaviour the same.
7. Write the new function with `edit_file`: place it near its caller, give it the name from step 1, keep types if the language has them, and replace the block with a call.
8. If the same block appears elsewhere, find the copies with `search_files`. Replace only the ones that are truly identical in meaning, and run tests after each.
9. Run tests, typecheck and linter with `run_command`. Review with `git_diff` that only the extraction and the call changed.

## Gotchas

- A block that assigns a variable used later looks self-contained until the tests show a missing value. Check reads after the block as well as before it.
- A `return` or `await` inside the extracted block changes meaning once it sits in another function. Async extraction needs the new function to be async and awaited.
- Closures capture variables by reference. Extracting a block that relies on loop variables or later mutation can change what it sees.
- More than four or five parameters means the cut is wrong. Try a different boundary or group the data into a type.
- A helper that needs its caller's private state to work is not an extraction. It is the same function split in two places.
- Do not extract on a hunch for reuse. Two uses is a reason. One use needs a naming or length reason.
- Keep comments with the code they explain. Move them with the block.
- Resist moving the new function to another file in the same change. Extraction first, relocation later, so the diff stays readable.

## Output

- The new function and the edited caller, shown as a focused diff.
- The parameters and returns chosen, with a line on why.
- The test result before and after.
- Other copies found and whether they were replaced.
