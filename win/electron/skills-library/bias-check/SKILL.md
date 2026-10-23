---
name: bias-check
description: Reads an article or post for slant by looking at word choice, framing, what is included and left out, who is quoted and who gains, then reports each finding with the passage that shows it. Use when the user asks if a text is biased, one-sided, or what it leaves out.
---

# Bias check

## Goal

Show the user how a text is steering the reader, with evidence from the text. The output helps them read it with open eyes. It does not tell them what to believe, and it does not call a text false because it leans.

## When to use

- The user pastes an article, op-ed, report or post and asks if it is slanted.
- The user wants to know what a one-sided piece leaves out.
- For whether the facts are right, use `use_skill` with `fact-check`. For trust in the outlet itself, use `source-evaluation`.

## Steps

1. **Load the text.** Use `read_url` or `read_file`. Note the type: news report, analysis, opinion, advertorial, press release. Opinion is allowed to lean, so judge it by honesty, not by neutrality.
2. **Find the main claim.** Write the thesis in one sentence, neutral in wording.
3. **Read the language.** Mark loaded verbs and labels, such as "slammed" against "criticised", or a group named by its enemies' term. List five at most with the quote.
4. **Read the framing.** Check the headline against the body, what comes first, what is in the last paragraphs, and which side is given the closing word.
5. **Count voices.** List who is quoted, how many words each get and whether any affected group speaks for itself.
6. **Check what is missing.** Use `search_web` for the same event from other outlets and from the primary documents. List relevant facts, context or counter-views that this text omits.
7. **Check numbers.** Look for missing baselines, cherry-picked periods, and percentages without totals.
8. **Check incentives.** Note ownership, sponsorship, author affiliations and links to products or campaigns mentioned.
9. **Sort findings.** Separate wording slant, selection slant (what is in or out) and incentive. Rate each as slight, clear or strong.
10. **Run the mirror test.** Imagine the same text with the sides swapped and ask if the wording and evidence standard would hold.
11. **Offer a fair rewrite.** If asked, rewrite the opening paragraph neutrally, with `edit_file` or in chat.

## Gotchas

- Balance is not neutrality. Giving equal space to a settled fact and a fringe claim is its own distortion.
- A text can lean and be accurate. Say both when both hold.
- Your own view affects what looks biased. Test the same standard on a piece you agree with before finishing.
- Omission is harder to see than wording. Run the comparison search instead of rereading.
- Do not guess the author's motives. Report effects and documented ties only.
- One article is a sample. Do not draw a verdict on the whole outlet from it.
- Headlines are often written by editors, not the author. Judge them separately from the body.
- Photo choice and captions steer readers. Check them when images are present.

## Output

A one-line overall read. Then findings under language, framing, voices, omissions and incentives, each with a quote or specific detail. End with two questions the reader could ask to balance the piece.
