---
name: brainstorming
description: Explores what the user actually wants and weighs real options before any spec, design or code exists. Asks the one question that unblocks, checks the codebase for constraints, and ends with a recommended direction. Use when the user has an idea but no plan, says "I want to build", "help me think this through", or asks what approach to take.
---

# Brainstorming before building

## Goal

Leave the user with a clear statement of the problem, two or three genuinely different approaches with trade-offs, and one recommended direction they have agreed to. Nothing gets built until intent is settled. This is for software and product decisions; for names, gifts or content ideas use `brainstorm`.

## When to use

- The request is an idea, not a requirement: "I want an app that...", "we need better search".
- Several designs would all satisfy the words of the request.
- The user asks "what should I do", "what are my options", "is this a good approach".
- A spec already exists and needs ordering: use `writing-plans`.
- The user wants a comparison of named products: use `compare-options`.

## Steps

1. Restate the idea in one or two sentences and ask the user to correct it. Do not propose anything yet.
2. Check what exists. If a project is open, use `list_directory`, `search_files` and `read_file` for related code, constraints, conventions and prior attempts. Facts found here replace questions you would otherwise ask.
3. Find the real goal. Ask with `ask_user`, one question at a time, starting with the one whose answer changes the most: who uses this, what happens today without it, what would make it a success, what is fixed (deadline, stack, budget).
4. Stop asking once an answer would not change the options. Three to five questions is typical. Write down any assumption you are making instead of asking a sixth time.
5. Generate approaches that differ in kind, not in polish: buy versus build, simple and manual versus automated, extend existing code versus new module, small first version versus full design. Aim for two or three. Include the do-nothing or minimal option when it is honest.
6. For each approach write: how it works in two lines, what it costs (time, complexity, risk), what it gives up, and the condition under which it is the best choice.
7. Check facts that can have changed (library capabilities, pricing, limits) with `search_web` or `read_url` before relying on them. Mark anything unchecked as an assumption.
8. Recommend one approach and say what would change your mind. Name the first thing to learn or build to test it.
9. Confirm with `ask_user`: go with the recommendation, pick another, or refine. Once agreed, offer the next skill: `spec-writing` for requirements or `tech-spike` for an open technical unknown.
10. Offer to save the outcome with `create_file` as a short decision note if the user wants a record.

## Gotchas

- Asking a list of questions in one message gets partial answers. One question per turn, each with the choices you already see.
- Three "options" that are one idea with different names is theatre. If only one approach is sane, say so and say why.
- Jumping to a solution the moment a keyword appears (they said "database", so pick one) skips the problem. State the goal first.
- Questions the code could answer waste the user's time. Search before asking.
- Being agreeable. If the idea has a flaw, say it plainly with the reason, then still offer the path they asked for.
- Brainstorming has no end unless you set one. Finish with a recommendation and a next step, not a longer list.

## Output

Short sections: Problem as understood, What the code already tells us, Options (each with cost and give-ups), Recommendation, Open questions, Next step. Under about 40 lines in total. Skip filler and do not write code or a full design in this skill.
