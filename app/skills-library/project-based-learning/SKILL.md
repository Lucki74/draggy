---
name: project-based-learning
description: Designs a small project that makes the user practise a target skill, sized to finish, with milestones, checkpoints and a list of decisions only they can make. Use when the user wants to learn by building, asks for a project to practise on, or is stuck copying tutorials.
---

# Project-based learning

## Goal

Pick or shape one project that exercises the exact skills the user wants to build, can be finished in the time they have, and leaves them with something working and the ability to explain it. The point is learning, not output.

## When to use

- The user says they learn best by doing, or has finished tutorials without gaining skill.
- The user wants a portfolio-sized piece tied to a learning goal.
- The user needs the order of topics first: use `use_skill` with `skill-roadmap`.
- The user wants exercises with answers on a narrow topic: use `practice-problems`.

## Steps

1. **State the learning goal.** Use `ask_user` for the skills to be practised (not the product), current level, hours per week, and tools or language already chosen.
2. **Collect interests.** Ask what the user would enjoy making or finds useful in daily life. A project they care about survives the dull middle.
3. **Propose two or three ideas.** Each is small: one core feature set, finished in two to six weeks of their hours. Show which target skills each practises.
4. **Check the skill match.** For each idea, list the skills it forces. Drop ideas that avoid the target skill, such as a project built entirely from a template.
5. **Choose and cut.** After the user picks, write the smallest version that counts as done, in three or four sentences. Move extras to a "later" list.
6. **Break into milestones.** Four to six steps, each ending in something that runs or can be shown. Order to reach a working end-to-end slice early.
7. **List the user's decisions.** Mark choices the user must make and research themselves (data format, layout, algorithm). These decisions are the learning.
8. **Plan help.** Say what you will do (review, explain errors, suggest where to read) and what you will not (write the core logic for them). Agree on it.
9. **Set checkpoints.** At each milestone, ask the user to explain what they built and why, and to name one thing they would change. Track in `update_plan`.
10. **Close out.** When done, run a short review: what was hard, what to learn next, and what to build in the next project.
11. **Keep a decision log.** Ask the user to note each choice and the reason in a file, which becomes the material for the closing review.

## Gotchas

- Projects balloon. The first version that works end to end beats a half-built grand design.
- Following a tutorial step by step teaches typing. Require at least one decision per milestone that the tutorial does not make.
- If the project needs a skill far above the user's level, split off a warm-up. Frustration ends projects.
- Reusing a stack the user already knows teaches nothing new. Add one new tool or concept per project.
- Real use matters. Even one user, such as the learner's own family, keeps the project honest.
- Do not take over to speed things up. Offer a hint ladder: question, pointer, example, then the answer.
- Stuck for days means the step is too big. Split the milestone instead of pushing harder.

## Output

The project in a short brief (what, for whom, done means), the milestone list with checks, and the help agreement. Add the first action for this week.
