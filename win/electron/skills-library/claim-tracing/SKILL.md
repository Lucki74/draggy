---
name: claim-tracing
description: Follows a claim, statistic or story back through the pages that repeat it to the first place it was stated, and records every change on the way. Use when the user asks where a claim comes from, who first said it, or whether a number was altered as it spread.
---

# Claim tracing

## Goal

Find the origin of a claim and show the path from there to the page the user saw. The result is a chain of links with the wording at each step, so changes in meaning are visible.

## When to use

- The user has a claim or number with no clear source and wants its origin.
- Many sites repeat the same line and the user suspects a single root.
- To decide if the claim is true, continue with `use_skill` and `fact-check`. For one number's sample and denominator, use `stats-claim-check`.

## Steps

1. **Capture the exact wording.** Copy the claim as the user saw it, plus where they saw it and the date. Ask with `ask_user` if only a paraphrase exists.
2. **Open the page that carries it.** Use `read_url`. Look for a link, footnote or phrase like "according to" near the claim.
3. **Follow each link back.** For every cited page, open it with `read_url` and find the passage that supports the claim. Note whether it states the claim, hints at it, or only mentions the topic.
4. **Search for distinctive phrases.** When no link exists, use `search_web` with a quoted exact phrase or the unusual number. Sort what comes back by date and look at the earliest.
5. **Look for the root.** The root is a study, dataset, filing, speech, recording or statement by a named person. Open it and read the actual passage.
6. **Build the chain.** Write each step as: page, date, wording, what it cites. Mark where the wording changes.
7. **Compare root to claim.** Put the root's words next to the claim the user saw. Name each difference: number, scope, time frame, certainty, who it applies to.
8. **State what you could not trace.** If the trail ends at a page with no source, say it is the earliest found, not the origin.
9. **Record dead ends.** Note links that no longer load and look for archived copies with `search_web`, so the user knows which hops could not be read.
10. **Name the first clean statement.** Mark the earliest step where the claim appears in the exact form the user saw.

## Gotchas

- The oldest search hit is not always the origin. Search indexes miss old pages, so call it "earliest found".
- Many sites cite each other in a circle. If A cites B and B cites A, neither is a root.
- A number often drifts: "up to 40%" becomes "40%", a range becomes a point, a survey of one group becomes everyone. Compare the words as well as the digits.
- Translated claims change in translation. Search in the source language too.
- A press release is a claim by the organisation, not the study it describes. Keep going to the paper.
- Screenshots of posts can be edited. Look for the live post or an archive copy before treating one as the root.
- Quote tweets and reposts show the sharer's framing, which may be where the claim changed. Read what was added.
- Paywalled hops break the chain. Say which link you could not open instead of assuming it matches.
- Old statistics get "refreshed" with a new year and no new data. Check the data year in the root.

## Output

A numbered chain from root to user's version, each line with link, date and the wording. Below it, a short list of changes in meaning and a one-line conclusion: root found, root likely, or trail ends here.
