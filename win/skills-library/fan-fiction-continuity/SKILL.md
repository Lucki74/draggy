---
name: fan-fiction-continuity
description: Plans and checks fan fiction against the source canon so characters, timeline and world rules stay consistent, and marks where the story deliberately diverges. Use when the user says "write fan fiction", "does this fit canon" or "continue this story in the same universe".
---

# Fan fiction continuity

## Goal

Keep a fan story faithful to the work it plays in. A good result uses the characters' known voices and histories, respects the timeline and rules of the world, and makes any change a clear choice.

## When to use

- The user writes or plans fan fiction and wants help with canon.
- A draft may contradict events, ages, powers or relationships in the source.
- The user wants a story that continues after a canon ending, or fills a gap.

For original characters, use `character-profile`. For original worlds, use `worldbuilding`. For prose, use `scene-writer`.

## Steps

1. **Identify the source.** Call `ask_user` for: which work, which edition or season, which point in the timeline the story sits at, and whether the story is canon-compliant, alternate universe or a crossover. Ask what the user already knows well.
2. **Gather the canon.** Use `search_web` and `read_url` on official or well-maintained community wikis, and the work itself if the user supplies text. Note the source of each fact. Do not rely on memory for names, dates, ages or rules.
3. **Make a canon sheet.** Short lists: characters involved (traits, speech habits, relationships), timeline events up to the story's point, world rules, locations, open questions. Mark facts that sources disagree on.
4. **Fix the divergence.** State what the story changes, if anything, in one line: "Mara survives chapter 12." Everything after follows from that, and everything before stays.
5. **Check the plan against the sheet.** Go through each planned scene and ask: who knows what at this point, where are they, what could they do, what would they say? Mark conflicts.
6. **Check voices.** For each main character, write two lines in their known manner, then compare with the draft's lines. Flag any that sound like someone else.
7. **Handle original characters.** If the user adds one, give them a place in the world that fits the rules and a reason not to overshadow the canon cast.
8. **Review the draft.** If a draft exists, call `read_file` and list contradictions with the sheet, with the line and the canon source.
9. **Offer fixes.** For each conflict, give two options: change the story, or declare it an intentional divergence and note why.
10. **Add a header note.** Suggest a line stating the canon point, the divergence and any warnings, for readers.
11. **Track the sources used.** Keep a short list of the pages and chapters the facts came from, so the user can verify them.
12. **Plan a canon-check pass.** After drafting, re-read the story against the sheet, scene by scene, and list changes.

## Gotchas

- Characters pushed out of character to fit a plot are the usual complaint. Let the plot bend instead.
- Memory of canon is often wrong, especially on dates, ages and the order of events. Check each fact.
- Adaptations, sequels and reboots differ. Make sure the fact comes from the version the story uses.
- Quoting long passages of the source text is a copyright issue and unnecessary. Refer to events in your own words.
- Many communities and hosting sites have rules about content, ratings and tags. Ask where the user will post, and check the rules with `read_url`.
- Real people (actors, public figures) are not characters. Do not write fiction of real individuals.
- Fan communities often disagree about what is canon. Name the source you follow and say so in the header.
- Warnings and ratings protect readers. Tell the user to add the right tags for the platform.

## Output

A canon sheet, then a list of conflicts found with fixes, then the divergence statement and a suggested header note. Use short bullets with the source named for each fact. If drafting is wanted, write it after the sheet is agreed.

If the user posts chapters over time, offer to update the canon sheet as the story grows.
