# Skills library release notes

## What changed

The skills catalogue was rebuilt. It now has 572 skills in 32 categories, up from 67. All of them are written for Draggy's own tools: they call `read_file`, `run_command`, `ask_user`, `use_skill` and the other tools Draggy actually has, and a lint script rejects tool names it does not have.

Fifty skills are on by default (writing, research, documents, planning and everyday coding). The other 522 are off until you switch them on in the skills settings, where they are grouped by category. The old default set is gone, so check your skills page after updating.

Descriptions are translated into French, Spanish and Chinese.

## New skills worth knowing

- **draggy-help** is always on and cannot be switched off. When you hit a problem with the app, the model reads the official docs at draggy.org/wiki before answering. The system prompt now also tells the model which model it is and that it runs on the Draggy harness, developed by lucki74.
- **human** rewrites or drafts text to remove common signs of machine writing. It comes with `tells.md`, a list of patterns to look for, and `metrics.cjs`, a script that measures sentence-length spread, repeated openers and tell phrases in a text.
- **find-skills** matches a task to the enabled skills and tells you which disabled one to switch on.

## What the human skill does not do

We make no detector claim. We did not test against any external AI detector, and no result here says the output passes one.

What we did measure is the metrics script on a 60-text corpus (30 human, 30 AI, five genres), kept in `win/scripts/skills/human-eval/`. Four of the six metrics score close to chance at telling the two sides apart (0.5 means no separation): sentence-length spread 0.55, share of sentences near the mean length 0.53, repeated openers 0.62, tell phrases per 1,000 words 0.57. Vocabulary variety in the first 100 words (0.12) and paragraph shapes (0.21) do separate the sides, but the human texts are older public-domain prose, so that likely reflects era and not authorship.

So the script is a way to compare a draft before and after a rewrite. It is not a detector, and its numbers should not be read as detector accuracy.

## Scope

There are no legal or health skills in this release. Skills that touch money give information and do not give personal financial advice.
