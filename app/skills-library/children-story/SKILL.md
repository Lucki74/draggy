---
name: children-story
description: Writes a story for a young child at a stated age, with simple language, a repeated pattern, a small problem the child can follow and a calm, satisfying ending. Use when the user says "write a bedtime story", "a story for my 5 year old" or "children's story about".
---

# Children's story

## Goal

Give a parent, teacher or carer a story that is a pleasure to read aloud and right for the child's age. A good one has a small, clear problem, a character the child cares about, a pattern to join in with and an ending that feels safe.

## When to use

- A bedtime story, a picture book text or a class read-aloud.
- A story to teach a routine or ease a worry, such as a first day at school.
- A personalized story with the child's name and interests.

For adult fiction, use `use_skill` with `story-writer`. For very short fiction for adults, use `flash-fiction`. For names, use `naming-generator`.

## Steps

1. **Ask for the child.** Call `ask_user` for: age, interests, any names to use, the length (a read-aloud of three to ten minutes), the setting, and the theme if any (sharing, bedtime, a new sibling). Ask what to avoid, such as fears or family situations.
2. **Choose the age band.** For ages 2 to 4: very short sentences, one idea per page, much repetition, familiar things. For 5 to 7: a simple plot with three steps, some new words, light humor. For 8 and older: a longer plot with a small twist. Match vocabulary to the age.
3. **Make a character with one want.** A small animal, a child or a toy, with a want a child understands: to find a lost hat, to be brave at the dark stairs.
4. **Plan three tries.** Children's stories often use a rule of three: the character tries, fails, tries again, fails differently, then succeeds. Each try is a little different.
5. **Add a refrain.** A repeated line the child can say along ("Not by my chinny chin chin" style, in your own words). Place it at each try.
6. **Write for the ear.** Read aloud. Use sound words, rhythm and short paragraphs. Leave room for the reader to pause and the child to point.
7. **Keep the problem gentle.** Make the worry small and solvable. If something is scary, keep it mild and resolve it kindly.
8. **Let the child solve it.** The hero solves the problem with a kind, clever or brave act, not a rescue by an adult.
9. **End calmly.** For bedtime, finish with a quiet scene and a settling image. Avoid new excitement in the last lines.
10. **Check the facts and the words.** Animals, places and objects behave as the child knows them unless made-up on purpose. Read the final text for words that are too hard.
11. **Add picture notes.** If the story will be illustrated, mark where each page turn falls and one image per page.
12. **Offer a shorter version.** Provide a trimmed text for a short bedtime, with the same beginning and ending.

## Gotchas

- Stating the moral at the end ("and so we learn") shrinks the story. Let the events show it.
- Words above the age band stop the read-aloud. Replace or explain them in context.
- A frightening villain with no comfort leaves bedtime harder. Keep scares mild and end with safety.
- Long descriptive paragraphs lose small listeners. Keep the action moving and the pictures easy to imagine.
- Using a real child's name or details is fine for the family, but do not add private data if the text will be shared publicly. Ask.
- Do not copy a well-known picture book's characters or lines. Make fresh ones.
- Too many characters confuse small listeners. Keep to three at most.
- A child's attention on an unfamiliar word fades. Repeat new words in a clear context.

## Output

A title and the story in short paragraphs, with the refrain visible. Below it, one line giving the age band and read-aloud time. If asked, add three questions the reader can ask the child afterward.

If the story is for a group, note where children can join in with actions or sounds.
