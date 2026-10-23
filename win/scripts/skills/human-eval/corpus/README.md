# Human-eval corpus

This directory holds 60 short texts for evaluating humanizing and AI-detection tools: 30 human-written and 30 AI-written, with 6 texts per side in each of five genres (email, essay, social, academic, fiction). Each file is 150 to 350 words.

The human texts are public-domain excerpts, mostly from Project Gutenberg, trimmed to paragraph boundaries with the wording unchanged. The AI texts were written by claude-sonnet-5-5 in its default voice, with no humanizing and no attempt to sound artificial.

manifest.json lists every file with its side, genre, word count (simple whitespace split) and source.

Known bias: the human side is older in style than modern web writing. Its sentences tend to be longer and more varied than what people write in emails, posts and essays today, so a detector can separate the two sides partly on era and sentence length rather than authorship. Treat results on this corpus as a rough baseline.

To make it more representative, add your own writing as plain UTF-8 files in human/ (for example email-07.txt) and add a matching entry to manifest.json.

Run `node scripts/skills/human-eval/eval.mjs` from `win/` to score both sides with the human skill's metrics script.

First result (30 texts per side, chance a human text scores above an AI text, 0.5 means no separation): lenCV 0.55, shareNearMean 0.53, ttr100 0.12, repeatedOpeners 0.62, paraShapes 0.21, tellHitsPer1000 0.57. Only ttr100 and paraShapes separate the sides, and both in the direction of the era bias above. The other metrics are close to chance. Do not read any of these as detector accuracy.
