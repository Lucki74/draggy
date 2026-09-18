---
name: flashcards
description: Turns notes, chapters, vocabulary lists or a topic into effective flashcards (one fact per card, clear cues) and saves them as a spreadsheet ready to import into Anki or Quizlet. Use when the user asks for flashcards, study cards or Anki cards.
---

# Flashcards

## Good cards

- **One fact per card.** Split lists into several cards or a cloze card per item.
- **Front:** a specific question or cue, never ambiguous. "Capital of Australia?" not "Australia".
- **Back:** the shortest complete answer, plus a few words of context if it helps memory.
- **Both directions** only for vocabulary, as two separate cards.
- **Why and how** cards for understanding, not only definitions: "Why does ice float?"
- Avoid yes/no questions and cards whose answer is given away by the front.
- For languages, include an example sentence on the back.

## Method

1. Read all the material. Pick what is worth remembering: key terms, facts, formulas, dates, processes, distinctions often confused.
2. Write the cards in order of the material, typically 15 to 40 per chapter.
3. Check each card makes sense on its own, out of context.

## File

Save with create_file as a .csv file (for example biology-chapter-3.csv) with the header `Front,Back,Tags` and one card per row. Quote any cell containing a comma or quote, and double the quotes inside it. Tags are one word, like the chapter name. If the user would rather have a spreadsheet, use the same content with an .xlsx name.

Tell the user the file name and the number of cards. Anki imports the .csv through File, Import; Quizlet takes the Front and Back columns pasted into its import box. Show the first five cards in the reply as a preview.
