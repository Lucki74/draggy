---
name: assumption-test-plan
description: Lists the assumptions a business idea or plan depends on, ranks them by risk, and designs a cheap test for the riskiest ones with a pass or fail rule set before the test runs. Use when the user wants to validate an idea, asks what must be true for a plan to work, or wants to test assumptions before spending money.
---

# Assumption test plan

## Goal

A short list of the beliefs that could sink the plan, ranked, with a test for each of the top ones. Each test states what will be done, how long it takes, what result counts as a pass, and what the user will do in either case.

## When to use

- The user has an idea, product or plan and has not yet checked the basics with real people.
- The user is about to invest time or money and wants to cut the risk first.
- For finding what could go wrong across a whole plan, use `use_skill` with `pre-mortem`.
- For questioning the user about the idea first, use `use_skill` with `grill-me`.
- For the model being tested, use `use_skill` with `business-model-canvas`.
- A small team wants to decide what to learn first before writing any code.

## Steps

1. Ask with `ask_user` for the idea or plan in two sentences, the customer, how money would be made and what the user has already learned. Read notes with `read_file`.
2. Extract assumptions. Cover four kinds: desirability (customers have the problem and care), viability (they will pay enough, and the economics work), feasibility (it can be built or delivered with the team and tools), and adjacent (channels, partners, rules). Write each as a statement that can be false: "Freelance designers will pay monthly to track invoices."
3. Rank each on two scales: how much the plan fails if it is false, and how little evidence the user has now. The top-right group, high impact and low evidence, are the riskiest.
4. Pick the top three. For each, choose the cheapest test that gives real evidence: customer interviews about past behavior, a landing page with a sign-up, a manual version of the service for five customers, a pre-order or letter of intent, a technical spike of a day.
5. Define the test: who participates (the real target, not friends), how many, how the user reaches them, how long it runs and what it costs.
6. Define the pass rule before running. Pick a measurable threshold and write it down, such as "at least 3 of 10 interviewees describe the problem unprompted and have tried a workaround". The numbers come from the user's judgment of what would justify going on, not from outside benchmarks.
7. Define the response: what the user will do on pass (next test or build), on fail (change the idea or drop it), and on mixed results (what extra data is needed).
8. Order the tests. Run the cheapest and most decisive first. Record the dates and an owner.
9. Plan the log: a table with Assumption, Test, Result, Learning and Decision, updated after each test.
10. Check the plan for bias: are the tests designed so the idea could fail? If a test cannot produce a no, change it.

## Gotchas

- Asking friends or family gives kind answers. Test with the actual target.
- "Would you buy this?" overstates demand. Ask for a deposit, a booking or time commitment, or ask about past behavior.
- A pass rule set after seeing results is not a rule. Write the threshold first.
- Testing safe assumptions feels productive and teaches little. Start with the one that can kill the idea.
- A test that builds the whole product is not a cheap test. Fake or manual versions are enough.
- Small samples give signals, not proof. Say what each result can and cannot show.
- Tests that need personal data from participants must follow the user's consent and privacy rules. Ask before collecting.

## Output

A table ranking assumptions, then for the top three a test card (Assumption, Test, Who, How many, Time, Cost, Pass rule, If pass, If fail), and a results log template. About one page.
