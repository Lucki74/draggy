---
name: subtitle-study
description: Turns a subtitle file or transcript of a show, film or video into a study set for a language learner, with picked vocabulary, phrases, a few grammar points, comprehension questions and a replay plan. Use when the user has an SRT, VTT or transcript in a target language and wants to learn from it.
---

# Subtitle study

## Goal

Convert an episode or clip into a short lesson the learner can do before, during and after watching. The material comes from the real text, so the words and phrases are ones native speakers actually said.

## When to use

- The user has a subtitle file, transcript or pasted dialogue in a language they are learning.
- The user wants to learn from a series, film or video they enjoy.
- The user wants a simplified reading text: use `use_skill` with `text-simplifier`.
- The user wants words from scratch with no source: use `vocabulary-builder`.

## Steps

1. **Get the source.** Use `ask_user` for the file path, the language, the learner's level and the study time they have. Read the file with `read_file`.
2. **Clean the text.** Remove timestamps, index numbers, sound tags and speaker markers for analysis. Keep a copy of the line order so phrases can be located.
3. **Understand the scene.** Summarise the plot of the segment in three lines. Note the register, slang and accents, since screen dialogue is not textbook speech.
4. **Select vocabulary.** Choose 15 to 25 words and phrases that recur, are useful beyond the show, or block understanding. Skip names, rare jargon and one-off jokes.
5. **Capture chunks.** Pick whole phrases and fillers as spoken, such as ways to agree, hesitate or disagree. Quote the line each one comes from.
6. **Pick two grammar points.** Choose structures that appear several times and match the level. Show two examples from the text and a one-line rule. Offer `use_skill` with `grammar-explainer` for more.
7. **Write the pre-watch task.** Give five key words to expect and one question to listen for.
8. **Write the post-watch questions.** Ask factual, inferential and opinion questions, with answers kept separately.
9. **Add a shadowing plan.** Select three short lines to replay and repeat aloud, at normal speed, after hearing them twice with subtitles.
10. **Check unsure items.** Verify slang and regional words with `search_web`. Mark anything that is rude or very informal.
11. **Save.** Write the study set with `create_file`: vocabulary table with line quotes, grammar notes, questions, shadowing lines.

## Gotchas

- Subtitles often condense speech or differ from the audio. Tell the learner to trust their ears when the two disagree.
- Subtitle files may be copyrighted. Use them only for the learner's own study, and do not republish whole scripts. Keep quotes short.
- Slang and swearing in shows are heavier than the learner expects. Label the register of each item.
- Fan or machine-made subtitles contain errors. Flag lines that look wrong instead of teaching them.
- An episode holds more words than anyone can learn. Fewer, better chosen items beat a full glossary.
- Character voices are not always standard speech. A dialect line is worth knowing but not copying.
- Encodings break accented characters. If text looks garbled, try reading the file again as UTF-8 before analysis.

## Output

Scene summary, vocabulary and phrase table with the source line, two grammar notes, pre- and post-watch questions, and the shadowing list. Answers are at the end.
Give the saved file path.
