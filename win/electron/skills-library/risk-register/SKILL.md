---
name: risk-register
description: Builds a risk register for a project or plan, ranking each risk by likelihood and impact and giving it a trigger, an owner and a concrete response. Use when the user asks what could go wrong, wants a risk list, or needs to prepare a plan for review.
---

# Risk register

## Goal

A short, ranked list of specific risks for this project, each with a signal that tells you it is happening and a response someone can act on. The register is a working tool, so it stays small enough to be read and revisited.

## When to use

- Before committing to a plan, a migration, a launch or a large refactor.
- The user asks "what could go wrong", "what are the risks", "is this plan safe".
- A review or stakeholder asks for a risk section.
- A single technical unknown dominates: use `tech-spike` instead of listing it.

## Steps

1. Read the material: the plan, spec or design with `read_file`, and the code areas affected with `search_files`. Risks come from specifics, so do not start from a generic list.
2. Ask `ask_user` for context you cannot see: hard dates, team size and availability, external dependencies, what failure would cost, who is affected.
3. Walk the plan step by step and ask at each one: what assumption is it making, what does it depend on, who or what outside our control is involved, and what is new to this team. Each answer is a candidate risk.
4. Sweep these areas for anything missed: people and availability, external services and vendors, data and migrations, performance and scale, security and privacy, compatibility, tooling, and unclear requirements.
5. Write each risk as a cause and a consequence: "If the vendor API changes its pagination, the sync job drops records." One sentence, specific to this project.
6. Rate likelihood and impact as low, medium or high. Rate on evidence you have and say what the evidence is. Do not attach percentages or money figures unless the user supplied them.
7. Add a trigger for each: the observable sign that it has started (a failing check, a missed milestone, an error rate the user defined). A risk without a trigger cannot be watched.
8. Choose a response type for each: avoid (change the plan), reduce (do something now), transfer (insurance, vendor, contract), or accept (with a named fallback). Write the actual action and who owns it.
9. Sort by combined rating. Keep the top five to ten. Move the rest to a short "watch" list. Check any external fact, such as a service limit or deprecation date, with `read_url` or `search_web` before recording it.
10. Save with `create_file` at the project's docs location, or present in chat. Add a review point, such as "revisit at each checkpoint".

## Gotchas

- Generic risks ("scope creep", "delays") apply to every project and teach nothing. Name the cause in this project.
- A mitigation of "monitor" or "be careful" is not a response. State the action, the owner and when it happens.
- Rating everything high flattens the list. Force a ranking and let some risks be medium.
- Risks entered once and never reviewed are decoration. Attach a review moment.
- Mixing risks (might happen) with issues (already happening). Issues go to the plan, not the register.
- Do not invent probabilities. If you have no basis, rate coarsely and label the rating as judgement.

## Output

A table with columns: risk, likelihood, impact, trigger, response, owner. Top risks first, then a watch list. A two-line summary above it naming the single biggest risk and the next action. Under about 40 lines.
