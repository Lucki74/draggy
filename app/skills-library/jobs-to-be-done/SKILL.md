---
name: jobs-to-be-done
description: Frames what customers are trying to get done as job statements with a situation, a motivation and a desired outcome, drawn from interviews or real behavior, and links each job to what the product must do. Use when the user asks about jobs to be done, why customers hire a product, or what need an idea really solves.
---

# Jobs to be done

## Goal

A short set of job statements that explain why people switch to a product, what they were doing before, and what progress they want. The statements describe the customer's situation and outcome, not the product's features.

## When to use

- The user wants to understand why customers buy, switch or leave.
- The feature list is long and no one can say which problem matters.
- For a profile of a typical buyer, use `use_skill` with `customer-persona`.
- For a promise based on the job, use `use_skill` with `value-proposition`.
- The user wants interview questions that reveal motives rather than opinions.

## Steps

1. Ask with `ask_user` what the product is and what evidence the user has: interviews, support tickets, reviews, churn notes. Read files with `read_file`. If there is none, plan three to five customer interviews and stop with the question list (step 9).
2. Choose recent examples. Pick real customers who switched or bought in the last few months. Recent events are remembered better than old ones.
3. For each example, reconstruct the story: the first thought that something had to change, what they tried before, what they compared, what almost stopped them, and what finally tipped the decision. Write it as a short timeline.
4. Pull out the forces: push (what was wrong with the old way), pull (what attracted them), habit (what kept them where they were) and anxiety (what worried them about switching).
5. Write job statements in the form "When [situation], I want to [motivation], so I can [outcome]." Use the customer's words. Keep the solution out of the statement.
6. Add the competing alternatives, including doing nothing, a spreadsheet or hiring someone. The real rival is whatever the job is done with today.
7. Group similar statements and keep three to five. For each, note the evidence count: how many customers showed it.
8. Link each job to product consequences: what must be true for the job to succeed, what is missing, and what can be dropped.
9. If evidence is thin, write five open interview questions that start with "Tell me about the last time ..." and list who to interview.
10. Check statements: each has a situation, none mentions a feature, and each is backed by a story.

## Gotchas

- "I want a dashboard" is a solution. Ask what they would do with it and what happens without it.
- Interviewing only happy users misses why others left. Include churned customers.
- Jobs are not personas. The same person has different jobs in different situations.
- Asking "would you use X?" yields polite yes. Ask about past behavior.
- Skipping anxieties and habits hides the real barrier to switching.
- Do not invent customer stories. Mark hypothesized jobs as hypotheses.
- Jobs have emotional and social sides (looking competent to a boss). Ask about them, since they often decide the purchase.

## Output

A table of Job statement, Situation trigger, Current alternatives, Forces, Evidence count. Then Product implications and Open questions. About one page.
