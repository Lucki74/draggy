---
name: practice-problems
description: Writes a set of practice problems for a topic at rising difficulty, each testing one idea, with worked answers kept apart so the user can try first. Answers that can be computed are computed. Use when the user asks for practice problems, exercises or extra questions on a topic.
---

# Practice problems

## Goal

Give the user problems that build skill: each one tests a named idea, the set climbs from basic to demanding, and every answer has been checked. The user should be able to work through the set without outside help.

## When to use

- The user has learned a topic and needs repetition with variety.
- The user wants problems for a course, for a specific skill or for a test.
- The user wants questions to answer in conversation with scoring: use `use_skill` with `quiz-me`.
- The user wants a full exam plan: use `exam-prep`.

## Steps

1. **Pin the scope.** Use `ask_user` for topic, level, what the user struggles with, count wanted and the format (short answer, multi-step, code, proof).
2. **List the skills.** Write 4 to 8 specific sub-skills the topic needs, such as "isolate a variable" or "read a time zone offset". One problem will target each.
3. **Draft by level.** Order warm-up, standard, harder and stretch. Each level changes one thing, not three: a new number type, one extra step, a changed context.
4. **Vary the surface.** Change the story, the numbers and the representation so the user cannot pass by pattern matching one template.
5. **Solve every problem yourself.** For numeric or code problems, compute with `run_command`. Compare to the key. A problem with no unique answer gets reworded or dropped.
6. **Write the worked answers.** Show the steps and the reason for each, then a short note on the common wrong path.
7. **Add hints.** For the hardest three, write a one-line hint that does not give the method away.
8. **Save apart.** Put problems and answers in separate sections or two files with `create_file`, so the answers stay out of sight.
9. **Offer marking.** Invite the user to submit attempts. Mark each step, with the final answer as one of them.
10. **Adjust.** After they try, make a second set that targets the sub-skills they missed.
11. **Track coverage.** List which sub-skills each problem tested and flag any left untested.

## Gotchas

- Generated problems often have hidden errors: wrong key, ambiguous wording, missing units. Solve them independently before sharing.
- A hard problem built from trivia is just obscure. Make it hard by reasoning depth.
- Realistic numbers matter. Answers like 0.0000417 push attention to arithmetic and away from the idea.
- If the user's course uses a specific notation or textbook method, match it or ask for an example.
- Do not show the answer in the same message as a problem when the user wants to try first.
- Problems on a topic that changes (rules, tax, versions) need the current source. Check it with `search_web`.
- Copying problems from a textbook or exam bank is a copyright issue. Write original ones in the same style.

## Output

Numbered problems with the level and the sub-skill in brackets, then a separator, then answers with steps. State how many were verified by computation.
