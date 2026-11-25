---
name: reading-graded-text
description: Writes a short original text in the target language at the learner's level, with a few glossed words, comprehension questions and a recap task, so they can practise reading with success. Use when the user asks for something to read at their level, a graded reader, or a short story or article for language practice.
---

# Reading graded text

## Goal

Give the learner a text they can mostly understand without a dictionary, with just enough new material to stretch them. They finish it feeling able, with a handful of new words and some questions that show whether they understood.

## When to use

- The user wants reading practice at A1 to C1 on a topic they like.
- The user wants a text built around words or a grammar point they are studying.
- The user already has a text that is too hard: use `use_skill` with `text-simplifier`.
- The user wants a lesson built from a video: use `subtitle-study`.

## Steps

1. **Collect the brief.** Use `ask_user` for the language and variety, level (or a sample of what they can read), topic, text type (story, dialogue, article, email), length and any words or grammar to include.
2. **Fix the constraints.** Decide the level rules: sentence length, tenses allowed, vocabulary range. Beginners get short present-tense sentences. Intermediate learners get connectors and past forms.
3. **Plan the text.** Write a two-line plan: who, what happens, the point. A story with a small surprise or a clear question keeps a learner reading.
4. **Write it naturally.** Use real, current language, not stilted drill sentences. Repeat key words two or three times so the context teaches them.
5. **Add new material sparingly.** Include about one new word per twenty running words, chosen so that the meaning can be inferred from context.
6. **Gloss.** List the 5 to 10 words most likely to block understanding below the text with meanings in the learner's language. Do not gloss what context makes clear.
7. **Check the level.** Reread as a learner would. Replace rare words, long sentences and tricky constructions that are above the level. Verify any doubtful usage with `search_web`.
8. **Write questions.** Include three kinds: factual (who, what), inferential (why, what does it suggest) and personal (what would you do). Put the answers separately.
9. **Add a recap task.** Ask for a three-sentence summary in the target language, or to retell the story to a friend.
10. **Save.** Write text, glossary, questions and answers with `create_file`, keeping answers in a separate section at the end.
11. **Plan the next one.** Ask how hard it felt and adjust the next text up or down a notch.

## Gotchas

- Over-simplified language sounds like no one speaks. Keep it natural and cut the length and rarity, not the grammar's realism.
- Too many glosses turn reading into a vocabulary test. Choose few.
- A text full of new words and grammar together is intensive study, not reading. Keep one challenge at a time.
- Cultural references may be unknown to the learner. Explain them or avoid them.
- Dialogues in textbooks are often stiff. Include fillers and short answers that people really use.
- Do not claim a CEFR level as exact. Say "aimed at roughly B1".
- Length matters: a text that takes 20 minutes may not get finished. Match the time the learner has.

## Output

Title, the text, the gloss list, the questions, then answers and the recap task in a separate section. Leave out commentary on how the text was built.
Offer one line on how to use it: read once for meaning, once for words.
