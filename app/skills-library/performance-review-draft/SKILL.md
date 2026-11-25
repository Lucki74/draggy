---
name: performance-review-draft
description: Drafts a performance review from a manager's notes and goals, with specific examples, balanced feedback and clear goals for the next period. Use when the user asks to write a performance review, needs help with an employee review, or wants to draft feedback for a team member.
---

# Performance review draft

## Goal

Turn a manager's scattered notes into a fair, specific review the employee can act on. Each judgement rests on an example, and the next period has clear goals.

## When to use

- A review cycle is open and the manager has notes, goals or a template.
- The manager wants to rework a draft that feels vague or harsh.
- A development path beyond this review is `use_skill` with `career-plan`.

## Steps

1. Ask with `ask_user` for the employee's role, the review period, the company's template or rating scale, and the goals set at the start of the period.
2. Read the manager's notes, past reviews, and any project records with `read_file`.
3. List results against each goal with the evidence: what was delivered, when, and what changed because of it. Ask the manager for numbers or outcomes they can verify.
4. Sweep the whole period, from the first month to the last. Ask about early-period work that the manager may have forgotten.
5. Write strengths with a concrete example for each, and explain the effect on the team or customers.
6. Write areas to improve as behaviours and results, not traits. State the example, the effect and what better would look like.
7. Check that the language describes the work and not the person. Replace labels such as careless with what happened.
8. Check balance and consistency: the same standard should apply as for peers, so ask whether a similar issue was raised with others.
9. Draft goals for the next period that are specific, within the person's control and dated, with the support the manager will give.
10. Add a short opening and a closing that name the overall assessment in line with the template's scale. Leave the rating itself to the manager.
11. Suggest talking points for the review meeting, including questions that invite the employee's view.
12. Remind the manager to follow the company's own process on documentation, and to take any dispute or legal question to HR.
13. Read the draft once as the employee would, and fix any line that would feel unfair or unclear.

## Gotchas

- Vague praise or criticism with no example.
- Recent events outweighing the whole period.
- Comparing people instead of describing results.
- Surprises: feedback that the employee hears first in the review.
- Attributing results to personality or background.
- Setting goals that depend on things the employee cannot control.
- Mixing pay or promotion decisions into the draft without the manager saying so.
- Copying text from last year's review without checking that it still applies.

## Output

A draft review in the template's sections, with examples, goals for the next period, talking points for the meeting and a list of facts the manager must verify.
