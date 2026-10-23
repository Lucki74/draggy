---
name: cheat-sheet-maker
description: Condenses a course, chapter or skill into one dense page of the formulas, rules, patterns and worked examples the user is most likely to forget, laid out for quick lookup. Use when the user asks for a cheat sheet, a one-page summary for revision, or a quick reference.
---

# Cheat sheet maker

## Goal

Produce a single page that the user would actually reach for. It holds what is hard to remember or easy to confuse, each item with its conditions, arranged so the eye finds it fast. It does not repeat what the user knows by heart.

## When to use

- The user is preparing for an exam, interview or task and wants a quick reference.
- The user has notes or a course outline and wants the core of it.
- The user wants the contents turned into question cards: use `use_skill` with `flashcards`.
- The user wants a branching overview of ideas: use `mind-map-outline`.

## Steps

1. **Define the use.** Use `ask_user` for the subject, where the sheet will be used (open book, desk reference, memory aid for a closed exam), the size limit and what the user already finds easy.
2. **Read the material.** Use `read_file` or `read_url` on notes, slides or a syllabus. If no material is given, state what you know and confirm the scope with the user.
3. **List candidates.** Write everything that could go on the sheet: formulas, definitions, rules, steps, common values, symbols, exceptions.
4. **Cut to the forgettable.** Remove what the user knows or can derive in seconds. Keep items that are long, rare, similar to others or costly to get wrong.
5. **Attach conditions.** Each formula or rule carries when it applies, what the symbols mean and units. A bare formula causes wrong use.
6. **Add one example per cluster.** A very short worked case shows the item in action. Prefer one example that covers several items.
7. **Group and order.** Group by task ("when asked to find X") rather than by chapter if that is how the user will look things up. Put the most used items top left.
8. **Check accuracy.** Recompute formulas and numbers with `run_code` where possible. For facts that change, verify with `search_web` and date them.
9. **Format to fit.** Use compact tables and short lines. Save with `create_file` as a Markdown file that prints on one page, and say which parts to trim first if it overflows.
10. **Test it.** Ask the user to answer two sample questions using only the sheet and fix gaps.
11. **Plan the update.** Note which items to add after the next practice test shows what the user still forgets.

## Gotchas

- Copying the whole syllabus onto a page defeats the point. Selection is the work.
- Similar items confuse under stress. Put look-alikes side by side with the difference marked.
- Allowed-materials rules vary for exams. Ask whether a sheet is permitted and what size, and do not suggest hiding one.
- A wrong formula on a cheat sheet is worse than none. Verify each one.
- Tiny text is unreadable under pressure. Cut content before shrinking type.
- A sheet made from memory alone repeats the user's gaps. Build it from the source.
- Copying a sheet from a classmate imports their gaps. Make your own from the course material.

## Output

The sheet itself, in Markdown tables and short lines, with a heading per group. After it, one line on what was left off on purpose. Mention the file path if saved.
