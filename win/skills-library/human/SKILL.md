---
name: human
description: Writes new prose, or rewrites a draft, so it reads like a specific person and is less likely to be flagged as machine text. Matches the user's own voice from a sample, fixes structure instead of swapping words, and measures the result with a bundled script. Use when the user asks to humanize text, make it sound like them, remove the AI feel, or lower an AI-detector score.
---

# Human

## Goal

Produce text that sounds like one particular person wrote it, and report honestly what changed. This lowers how machine-like the text looks to readers and to detectors. It does not make text undetectable, and no detector result can be promised.

## When to use

- The user pastes a draft and wants it to sound human or sound like them.
- The user wants new writing (email, post, essay, story, report) that does not read as model output.
- The user wants a before and after measurement of a text.

Not for code, data, front matter or link targets. Leave those exactly as they are. For a plain proofread, use `use_skill` with `proofreader`.

## Steps

1. **Get a voice sample.** Ask for 300 words or more that the user wrote themselves, with no AI help. Look at sentence length (short and long), punctuation habits, favorite plain verbs, how paragraphs open and end, and what they never do. No sample: continue, and say once that the result carries the model's default voice.
2. **Get the facts.** Rewriting keeps every fact, number, name and quote from the source. Writing new text uses only what the user supplied. If a detail is missing, ask for it or leave a visible gap. Never invent one to add life.
3. **Measure the starting point.** Read the bundled file `metrics.cjs` through this skill.
   Run it with `run_command`, language javascript: put `const TEXT = \`...\`;` above the script body, with the text inside the template literal. Measure the voice sample the same way. The sample sets the targets. A universal norm does not exist.
4. **Write or rewrite under structural rules.**
   - Vary sentence length the way the sample does. Put a short sentence next to a long one. Let a one-line paragraph stand when it lands a point.
   - Vary paragraph shape. Not every paragraph is claim, support, takeaway.
   - Start with the thing itself (a scene, a number, a document), not general context.
   - Use plain `is`, `has`, `wrote`, `moved`. Repeat a noun instead of cycling through synonyms.
   - Name real specifics from the material: people, places, amounts, dates.
   - Do not explain a point that was just made. End where the substance ends.
   - Allow at most one aphorism. Leave one or two sentences at half pressure: plain, flat, a little underdeveloped.
   - Do not insert typos, filler words or fake casualness. They read as costume.
5. **Measure again and fix the worst number.** Compare `lenCV`, `shareNearMean`, `repeatedOpeners`, `paraShapes` and `tellHitsPer1000` with the sample. Fix the worst one, then re-measure. Stop after two passes. More passes drift from the source.
6. **Check against the source.** Every fact, number, name and quote still matches. Anything that does not is restored.
7. **Score it** with the rubric below. Under 8 of 10: one more pass, once.
8. **Report** in a few plain sentences: what changed, the before and after numbers, and the limits.

## Rubric

Score each from 0 to 2: specificity, rhythm, tells removed (see `tells.md`), claims preserved, fit with the voice sample. Pass is 8 or more. Without a sample, score voice fit as 1 and say so.

## Gotchas

- Swapping words does not fix structure. Replacing one stock word with another changes nothing a detector looks at. Rhythm, paragraph shape and specifics do.
- The metrics are heuristics from sentence counts. A very short text (under 100 words) gives noisy numbers, so say so.
- A tidy, even human text will measure like a model. Judge against the user's own sample, not against a rule.
- Do not claim a text will pass GPTZero, Turnitin or any other detector. If the user pastes in a detector score, record it next to the measured numbers and treat it as one data point.
- Academic or assessed work: say once that a submission policy may forbid undisclosed AI help. That is the user's decision.
- Rewriting for another named person's style is out of scope. Use the user's own sample only.
- Do not run the script on code blocks or tables. The script skips fenced code but not tables.
- Translated text keeps the source's rhythm. Rewrite in the target language from the sample of that language.

## Output

The finished text first, with no preamble. Then a short note: the measured before and after values for the five metrics, the rubric score, and any gaps the user must fill. In chat, no bold labels or headings in the note.
