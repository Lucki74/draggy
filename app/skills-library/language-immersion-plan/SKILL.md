---
name: language-immersion-plan
description: Builds a weekly routine that puts a target language into the learner's daily life through listening, reading, speaking and writing habits sized to their free time, with checkpoints and a way to adjust. Use when the user wants a plan to learn a language faster, wants to surround themselves with it, or asks how to practise every day.
---

# Language immersion plan

## Goal

Turn "I should practise more" into a schedule the learner can keep. The plan fits their real hours, mixes the four skills, uses media and people they enjoy, and has a weekly check so it changes when it stops working.

## When to use

- The user wants a daily or weekly routine for a language they are learning.
- The user lives away from the language and wants to create exposure at home.
- The user needs a word list for the plan: use `use_skill` with `vocabulary-builder`.
- The user wants a structured course path: use `language-tutor`.

## Steps

1. **Get the facts.** Use `ask_user` for the language, current level, goal and deadline (trip, exam, move), minutes available on weekdays and weekends, and what they enjoy (music, football, cooking, series).
2. **Define the target.** Turn the goal into a measurable outcome for the period, such as "hold a ten-minute conversation about work in eight weeks".
3. **Budget the time.** Split the minutes across listening, reading, speaking, writing and review. Weight the split toward the skill the goal needs most.
4. **Choose input they like.** Pick podcasts, shows, channels, books or games in the language at a level they can mostly follow. Use `search_web` and `read_url` to confirm that suggested resources exist and suit the level.
5. **Change the environment.** Add small switches: phone language, a daily news headline, a shopping list in the language, a playlist for commutes.
6. **Add output.** Schedule speaking or writing early, even small: a voice note, a diary line, a message to a language partner. Offer `use_skill` with `language-exchange-messages` for the first contact.
7. **Add review.** Plan a short review block from the learner's own mistakes and new words so the input turns into memory.
8. **Draft the week.** Build a table with day, minutes, activity and the exact resource. Keep the first week lighter than the rest.
9. **Set checkpoints.** Add a weekly check of one measurable thing: minutes done, words reviewed, a recorded minute of speech compared with week one.
10. **Track the plan.** Create a task list with `update_plan` and save the full routine with `create_file`.
11. **Plan for breaks.** Write a minimum version for bad days, five minutes of listening or one page, so one missed day does not end the habit.

## Gotchas

- Plans built for the best week fail in the average one. Size the plan for a tired Tuesday.
- Passive listening alone rarely builds speaking. Include output from the first week.
- Media that is too hard gets dropped. Prefer content with subtitles in the target language or graded material.
- Streaks drive habits, but guilt over a broken streak ends them. Allow rest days in the schedule.
- Resources move and disappear. Check links before listing them and give an alternative.
- Do not promise fluency by a date. Describe what practice usually gets, and let the checkpoints show progress.
- Too many apps scatter attention. Cap the plan at one resource per skill.

## Output

The target, the weekly table with minutes and resources, the checkpoints, and the minimum-day version. Save as a file and give the path.
Offer a review after two weeks to adjust.
