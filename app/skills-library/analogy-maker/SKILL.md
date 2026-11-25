---
name: analogy-maker
description: Builds an analogy for a hard idea from a domain the learner already knows, maps each part of the idea to its counterpart, and says where the analogy fails so it does not leave a wrong model behind. Use when the user asks for an analogy, a comparison to everyday life, or a way to picture an abstract idea.
---

# Analogy maker

## Goal

Give the learner a picture of an unfamiliar idea through something familiar, with an explicit map between the two and an honest note on its limits. The analogy is a bridge to the real idea, not a replacement for it.

## When to use

- The user finds a concept abstract and wants to picture it.
- The user needs to explain an idea to someone else and wants a comparison.
- The user wants the concept explained in full: use `use_skill` with `explain-concept`.
- The user wants to test their own explanation: use `feynman-explain`.

## Steps

1. **Define the target idea.** Write the core of the concept in two sentences, as it is correctly stated. Use `ask_user` if the concept or the level is unclear, and read any text with `read_file`.
2. **Find the learner's world.** Ask what they know well: a hobby, a job, a sport, cooking, a game, a place. An analogy from a domain they do not know is worse than none.
3. **List the structure of the idea.** Name its parts, relations and the behaviour that matters (a cause, a flow, a limit, a feedback). The analogy must copy this structure, not the surface.
4. **Pick the source domain.** Choose the familiar domain that has the same parts and relations. Try two candidates and compare how many parts map.
5. **Write the mapping.** Make a two-column list: part of the idea and its counterpart in the analogy. Every important part must have a partner.
6. **Tell it as a short story.** In four to six sentences, explain the idea through the analogy using the mapped terms. Use plain words.
7. **Test it with a prediction.** Ask the learner what the analogy predicts in a new situation, then compare with what the real idea does. A good analogy predicts correctly for the cases that matter.
8. **State where it breaks.** List at least two ways in which the analogy is wrong or misleading. Say what to unlearn so the picture does not become the belief.
9. **Return to the real idea.** Restate the concept in its own terms, now that the picture exists, and offer a second analogy if the first did not land.
10. **Check understanding.** Ask the learner to explain the idea back without the analogy and note where they lean on it too hard.
11. **Retire the analogy.** Suggest a point at which to drop it once the real terms are comfortable.

## Gotchas

- A clever analogy that maps one part and misleads on the rest does damage. Check the relations as well as the resemblance.
- Common analogies (electricity as water) have known failure points. Name them.
- Analogies from niche fields exclude the learner. Ask first, don't assume.
- Stacking analogies in one answer confuses. Give one good one, keep a spare.
- An analogy does not prove anything. Never use it as evidence for the claim.
- Cultural references may not travel. Use things common to the learner's setting.
- Jokes and vivid images are memorable, which also locks in their errors. Be precise before being colourful.

## Output

The one-line idea, the analogy story, the mapping table, the limits list and a final sentence in the real terms. Keep it under 250 words.
