---
name: writing-correction
description: Corrects a learner's text in the target language, shows the fixed version, and explains each change with its rule, ranked by how much it affects meaning, so the learner stops repeating the error. Use when the user asks to correct, check or fix writing in a foreign language and wants the reasons.
---

# Writing correction

## Goal

Return a corrected text that still sounds like the learner, and a short explanation for each meaningful change. The learner finishes knowing which three habits to fix next, instead of only holding a cleaner paragraph.

## When to use

- The user pastes an email, essay, message or diary entry in a language they are learning.
- The user wants to know why something was wrong, beyond the right version.
- The user wants a native-sounding translation of an idea: use `use_skill` with `translator`.
- The user wants a full conversation: use `conversation-practice`.

## Steps

1. **Get the context.** Use `ask_user` for the language and variety, the learner's level, the audience and purpose (friend, boss, exam), and how heavy the correction should be: errors only, or errors plus style.
2. **Read the whole text.** Use `read_file` if it is a file. Make sure you understand the intended meaning before changing anything. Ask if a sentence has two readings.
3. **Mark each issue.** List errors by type: grammar, word choice, spelling, punctuation, register, word order, missing words. Note the location.
4. **Rank them.** Mark those that change or block meaning as major, the rest as minor. Learners can absorb about three lessons per text.
5. **Correct minimally.** Fix what is wrong and keep the learner's structure and vocabulary where it works. Do not rewrite sentences that are correct but plain.
6. **Show the changes.** Present the corrected text and, beside it or below, a list of changes in the form: original, corrected, rule in one line, an extra example.
7. **Separate style.** Put optional improvements (more natural phrasing, a better connector) in their own list, labelled as suggestions.
8. **Verify the uncertain.** For usage you are not sure about, check a reputable reference through `search_web` and `read_url`, and say when natives vary.
9. **Name the patterns.** If the same error repeats, group it and give one explanation, such as the recurring gender slip on a noun class.
10. **Assign a mini task.** Give two short sentences to rewrite using the pattern, and offer to check them.
11. **Apply to the file.** If the learner wants the file updated, use `edit_file` on a copy, and keep the original.

## Gotchas

- Rewriting everything in the corrector's voice robs the learner of their own. Change only what needs changing.
- Listing 30 equal corrections overwhelms. Highlight the three that matter most.
- A correction without the reason will return as the same error next week.
- Natives disagree on borderline usage. Mark such points as preference, not error.
- Formal writing and chat have different norms. Judge against the stated audience.
- Do not correct a deliberate choice, such as dialect or quoted speech, unless asked.
- Accents, apostrophes and punctuation rules vary by language and are easy to miss. Check them last, one by one.

## Output

The corrected text first, then the numbered changes with rules, then suggestions and the mini task. Keep the explanations in the learner's language at beginner level.
At higher levels use the target language for the rules.
