---
name: skill-roadmap
description: Breaks a skill the user wants to learn into ordered stages by dependency, each with a milestone that can be tested, practice tasks and a time estimate based on the weekly hours the user has. Use when the user asks how to get good at something, wants a roadmap, or asks what to learn first.
---

# Skill roadmap

## Goal

Give the user a route from where they are to where they want to be. Stages follow what depends on what, each ends in something they can do and show, and the time estimates come from their real hours.

## When to use

- The user names a skill (a language, an instrument, a programming area, a craft) and asks how to approach it.
- The user feels lost among resources and wants an order.
- The user is choosing between courses: use `use_skill` with `course-picker`.
- The user wants a small build to practise with: use `project-based-learning`.

## Steps

1. **Define the target.** Use `ask_user` for what the user wants to do with the skill, in a concrete sentence ("hold a 10 minute conversation", "build and deploy a small web app"). Vague goals give vague roadmaps.
2. **Assess the starting point.** Ask what they can already do. Offer three quick tasks of rising difficulty and see where they stop. Write their level in a sentence.
3. **Get the time.** Ask hours per week and how long they will keep going. Convert to total hours.
4. **List the parts of the skill.** Break the target into sub-skills. Check the structure of the field in two or three reputable curricula, syllabi or standards, found with `search_web` and `read_url`.
5. **Order by dependency.** Draw which sub-skill needs which. Put prerequisites first, and defer topics that only matter for advanced use.
6. **Form stages.** Group into three to six stages. Each stage has a name, the sub-skills, and one milestone: a task the user can do without help, such as "write a function with tests".
7. **Add practice.** For each stage choose two or three practice tasks that use the sub-skills. Reading about them does not count. Point to resource types, and check names and links before listing any.
8. **Estimate time.** Give a range per stage in hours, and say it is a rough guide. Compare with the user's hours to give a calendar range.
9. **Mark the checkpoints.** After each milestone, a review: redo the test task a week later from memory.
10. **Save.** Record the roadmap with `update_plan` or `create_file`, and agree when to revise it.
11. **Plan the revision.** After stage two, schedule a short review of stage one, since early skills fade when unused.

## Gotchas

- Lists of topics are not roadmaps. Without dependency order, beginners start at the interesting end and stall.
- Time guides vary hugely by person and by prior skill. Give ranges and update them after stage one.
- Milestones phrased as "understand X" cannot be checked. Phrase them as an action with an output.
- Too many stages at the start overwhelms. Detail the first stage fully and outline the rest.
- Resources vanish or change. Verify any named resource before recommending it.
- A roadmap for a skill the user will use for fun differs from one for a job. Match the goal.
- Plateaus are normal. Plan one lighter week per stage so a flat patch does not read as failure.

## Output

The target and the starting level, then the stages as a list with sub-skills, milestone, practice and hours, then the calendar range. Keep each stage under six lines.
