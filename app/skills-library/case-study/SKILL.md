---
name: case-study
description: Writes a customer or project case study with situation, action and measured result using only facts, figures and quotes the client has approved, and a baseline for every number. Use when the user asks for a case study, a customer success story, or to turn a finished project into a written example.
---

# Case study

## Goal

A reader in a similar position sees what happened and can judge whether it applies to them. A good case study states the starting situation, what was done and why, and the result with a baseline and a time frame, with the client's consent for what is named.

## When to use

- A finished project, engagement or customer win needs to be written up.
- The user has notes, metrics or interview material.
- For the interview that produces the material, use `use_skill` with `interview-questions`.
- For a news announcement of the same result, use `use_skill` with `press-release`.
- For internal lessons after a failure, a different document fits; ask the user what they need.

## Steps

1. Gather the material with `read_file`: notes, emails, metrics exports, interview transcripts. Then ask with `ask_user` for what is missing: the client and contact, their goal, what they tried before, what was delivered, when, and the results with their source.
2. Settle permissions first. Ask whether the client approved being named, the figures used and any quotes. If not named, write it as an anonymous case ("a regional retailer") and remove details that identify them.
3. Establish the baseline for each result. A figure like "sales grew 30%" needs: grew from what, over what period, measured how, and attributed to what. If any of these is missing, ask or state the gap. Do not add a number.
4. Outline: the client and the problem (with stakes), constraints, the approach and the reasons for it, what happened, the results, and what the client or you would do differently. Keep it to one page of reading unless the user wants more.
5. Write the situation with specifics from the material: size, sector, the pain in the client's words where approved.
6. Write the action as choices, not a task list: what you considered, what you picked, why. Include a difficulty that arose and how it was handled, if true.
7. Write the results with their baselines and periods. Separate what is measured from what is reported by the client. Pull one or two quotes in the speaker's exact words, as approved. Do not alter a quote to improve it.
8. Add a short note on fit: who this approach suits and when it would not. This builds trust.
9. Send the draft back to the user flagged with every number and quote that needs client sign-off. Save with `create_file`.
10. Offer a short pull-out summary (three lines: challenge, action, result) for use on a page or a slide.
11. Keep a dated record of what the client approved, so a later edit can be checked against it.

## Gotchas

- Invented metrics or quotes can end a client relationship and damage the writer's reputation. Use only what is supplied and mark what needs approval.
- A result with no baseline cannot be judged. "Doubled" is empty without the starting figure and period.
- Attributing a change to your work when other factors contributed overstates it. Say what else was happening.
- Publishing a client's name, figures or logo without written approval creates trouble. Ask, even for a friendly client.
- A story with no difficulty reads like an ad. Real obstacles make the result credible.
- Rounding results up flatters you and misleads readers. Round honestly.
- Results from a short period may not last. Give the time window, and add a follow-up when you have one.
- Client jargon in quotes can confuse other readers. Keep the quote exact and explain around it.
- Mentioning costs or contract values often breaks confidentiality terms. Ask before including them.
- The hero of the story is the client. A case study that centres your own team reads as an ad.
- Different readers want different results: the technical lead wants method, the buyer wants outcome. Pick the main reader.

## Output

- The case study with a title that names the client or sector and the outcome, then sections for situation, approach, results and fit.
- A sign-off list: each figure, quote and name with its approval status.
- Missing facts and questions, kept separate from the draft.
