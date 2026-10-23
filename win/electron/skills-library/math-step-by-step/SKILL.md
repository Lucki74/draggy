---
name: math-step-by-step
description: Solves a maths problem in small steps, naming the rule used at each one, checks the result by an independent route and by running the numbers, and states the idea behind the method. Use when the user asks to solve a problem step by step, wants a worked solution explained, or does not follow a maths solution.
---

# Math step by step

## Goal

Show how the problem is solved so the user can solve the next one. Each step is small, has its reason, and the final answer is checked a second way. The user understands why the method works as well as what it produced.

## When to use

- The user pastes a problem from algebra, calculus, statistics, geometry or similar and wants it worked.
- The user has a solution they cannot follow.
- The user got a problem wrong and wants the cause found: use `use_skill` with `learn-from-error`.
- The user wants more problems of the same type: use `practice-problems`.

## Steps

1. **Restate the problem.** Write what is given, what is asked and any units or conditions. If the statement is ambiguous, use `ask_user` before solving.
2. **Identify the type.** Name the kind of problem and the main tool that fits, such as "linear system, use elimination". Say why this tool and not another.
3. **Plan in one line.** Give the route in plain words before the algebra, so the user sees the shape of the solution.
4. **Work in small steps.** One operation per line. After each line, write the rule or reason in a few words: "subtract 3 from both sides", "product rule". Do not combine two moves.
5. **Compute with a tool.** For arithmetic that is long or error-prone, run `run_code` and use the result, instead of working it mentally.
6. **Keep track of conditions.** Note restrictions as they appear, such as a denominator that cannot be zero or a squared step that can add false roots.
7. **State the answer.** Give it with units, in the form the problem asked for (exact or decimal), and rounding only at the end.
8. **Check independently.** Substitute the answer back into the original statement, or solve by another method, or test the size by a rough estimate. Show the check.
9. **Name the idea.** Summarise in two sentences why the method works, and what clue in the problem pointed to it.
10. **Offer a variant.** Suggest a similar problem the user can try and offer to check their attempt.
11. **Link to the topic.** Name the chapter or topic the problem belongs to, so the user knows what to review if the method felt new.

## Gotchas

- A skipped step feels fast and is the one the learner needed. Write it.
- Squaring both sides, multiplying by an expression or taking roots can add or lose solutions. Always check against the original equation.
- Mental arithmetic slips are the most common error in worked solutions. Compute with code.
- Rounding in the middle accumulates error. Keep exact values until the last line.
- A correct answer reached by a trick is less useful than a general method. Show the general method, then the shortcut.
- If the problem as written has no solution or many, say so and explain, rather than forcing an answer.
- Notation differs between courses (log versus ln, degrees versus radians). Match the user's convention.

## Output

Given and asked, the plan, the numbered steps with reasons, the answer, the check and the idea. Use plain text maths readable in chat, and keep reasons short.
