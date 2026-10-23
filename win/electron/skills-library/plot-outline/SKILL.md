---
name: plot-outline
description: Turns a premise into a scene-level outline with a goal, obstacles, turning points and an ending that pays off the setup. Use when the user says "outline my novel", "help me plot this story" or "structure my plot".
---

# Plot outline

## Goal

Give the writer a working map from first scene to last. A good outline shows what the protagonist wants, what stands in the way, how each scene changes the situation, and why the ending feels earned.

## When to use

- The user has a premise or a few ideas and needs a structure.
- A draft stalls in the middle or the ending does not land.
- The user wants a chapter list for a novel, a novella or a long story.

For a single scene, use `scene-writer`. For a very short story, use `flash-fiction`. For critique of a finished draft, use `short-story-critique`.

## Steps

1. **State the premise in one sentence.** Ask with `ask_user` if needed: who, what they want, what stops them, what is at stake. If the user gives a draft, call `read_file` first.
2. **Fix the end first.** Ask what the final image or choice is. Everything before it is built to make that choice hard and meaningful.
3. **Choose the structure.** Three acts is the default. Ask whether the user prefers another shape (five acts, episodic, braided timelines) and adopt it.
4. **Set the key points.** Write a line for each: opening situation, inciting event, first commitment, midpoint reversal, low point, climax, resolution. Name the character's choice at each, and the event beside it.
5. **Build the middle.** Fill it with scenes where each one raises cost: a plan fails, a lie grows, a helper leaves. Each scene should change what the protagonist knows or can do.
6. **Link scenes by cause.** Connect them with "because" or "but", not "and then". Rewrite any link that is only "and then".
7. **Add subplots sparingly.** Each should touch the main plot at least twice and echo its theme. Cut any that do not.
8. **Plant and pay off.** List the setups early on (a skill, a debt, a rumor) and the payoff scene for each. Every payoff needs a setup, and every setup needs a payoff.
9. **Check the stakes.** At each act break ask what the protagonist can lose now that they could not before.
10. **Format the outline.** One line per scene with place, who is present, goal, obstacle and result. Use `update_plan` for long outlines to track chapters as steps if the user is drafting.
11. **Run a pressure check.** Read only the last line of each scene. They should read as a chain of changes. If two in a row feel the same, merge or replace one.
12. **Mark the optional scenes.** Flag the ones that can be cut first if the word count runs long, so cuts later are cheap.

## Gotchas

- A chain of events is not a plot. If a scene could swap places with another, the cause is missing.
- Heroes who succeed by luck or by an outsider's rescue cheat the ending. Make the protagonist's choice solve it.
- A middle full of the same kind of obstacle is repetition. Change the kind, the cost or the ally.
- Twists must be planted. Check that a reader could have guessed it, fairly, on rereading.
- Do not outline every beat if the user writes by discovery. Offer a lighter version: end image, midpoint, and three questions.
- Subplots that resolve in a summary paragraph read as leftovers. Give them a scene.
- Treating the outline as a contract leads to scenes written to fit rather than to work. Say it can change.
- Expecting the structure to supply the theme is a mistake. Ask what the story is arguing and check that the ending takes a side.

## Output

A numbered list of scenes grouped under act headings, each with one line for the result and a mark where a setup or payoff sits. Under 700 words for a full novel outline unless the user asks for more.

Offer to save the outline with `create_file`. No lecture on structure theory.

If the user wants a lighter plan, give the ending image, the midpoint, the low point and three open questions in ten lines.
