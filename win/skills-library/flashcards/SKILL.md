---
name: flashcards
description: Turns notes, chapters, vocabulary lists or a topic into flashcards with one fact per card and clear cues, saved as a CSV (or spreadsheet) ready to import into Anki or Quizlet. Use when the user asks for flashcards, study cards, Anki cards, or to turn notes into cards.
---

# Flashcards

## Goal

A deck the learner can import and use today. Each card tests one fact, makes sense on its own, and has a front that cannot be answered by reading it.

## When to use

- The user asks for flashcards, study cards or Anki cards from notes, a chapter, a vocabulary list or a topic.
- For a live question-and-answer session instead of a file, use `use_skill` with `quiz-me`.
- For a study schedule around the material, use `use_skill` with `study-plan`.

## Steps

1. Read all the material first. Pick what is worth remembering: key terms, facts, formulas, dates, processes, and distinctions people often confuse.
2. Write the cards in the order of the material, typically 15 to 40 per chapter. Follow these rules:
   - One fact per card. Split lists into several cards, or one cloze card per item.
   - Front: a specific question or cue. "Capital of Australia?" works, "Australia" does not.
   - Back: the shortest complete answer, plus a few words of context if it helps memory.
   - Both directions only for vocabulary, as two separate cards.
   - Add why and how cards for understanding beyond definitions: "Why does ice float?"
   - Avoid yes/no questions and fronts that give away the answer.
   - For languages, put an example sentence on the back.
3. Check that each card makes sense out of context.
4. Save with `create_file` as a .csv (for example `biology-chapter-3.csv`) with the header `Front,Back,Tags` and one card per row. Quote any cell containing a comma or quote, and double the quotes inside it. Tags are one word, such as the chapter name. If the user prefers a spreadsheet, use the same content with an .xlsx name.

## Gotchas

- An unquoted comma in a cell shifts every later column, and Anki imports a broken deck without warning. Quote such cells and double inner quotes.
- A card that packs a whole list into one answer is never recalled completely. Split it.
- A bare term on the front ("Australia") has several valid answers, so the learner cannot tell if they were right.
- Cards copied from notes without a check often depend on the paragraph around them. Test each one in isolation.
- Reversed vocabulary cards belong in the file as separate rows, not as one two-way card.

## Output

The .csv file, then a reply with the file name and the number of cards. Tell the user Anki imports it through File, Import, and Quizlet takes the Front and Back columns pasted into its import box. Show the first five cards as a preview.
