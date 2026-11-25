---
name: primary-source-hunt
description: Finds the original document, dataset, filing, ruling, speech or study behind secondary coverage, then confirms it is the current and complete version. Use when the user asks to find the original, the actual study, the source document, or the real text behind a news story.
---

# Primary source hunt

## Goal

Put the user in front of the original item, not someone's description of it. The result is a working link or file, a note on which version it is and the exact passage that matters.

## When to use

- A news item, post or summary mentions a report, law, case, study or dataset the user wants to read.
- The user suspects the coverage stretches what the original says.
- To follow a claim through many hops, use `use_skill` with `claim-tracing`. For making sense of the original once found, use `summarize-paper`.

## Steps

1. **Name the target.** Write down what kind of item it is: journal article, court ruling, regulation, company filing, statistics release, transcript, patent, press statement. The type decides where it lives.
2. **Read the coverage for clues.** Use `read_url` and pull out titles, authors, case numbers, docket or reference codes, agency names and dates. Follow any link given.
3. **Go to the issuer.** Use `search_web` with the exact title or reference code plus the issuing body. Prefer the issuer's own site, an official register or a recognised archive over a repost.
4. **Open and verify.** Use `read_url` on the candidate. Check title, date, authors and issuer match the coverage. For documents with a number, check the number.
5. **Check the version.** Look for draft, preprint, amended, superseded or withdrawn marks. Search for a newer version and for corrections.
6. **Locate the passage.** Find the exact words behind the claim in the coverage. Copy the location (section, page, table).
7. **Compare.** State whether the coverage matches the original, stretches it or gets it wrong. Name the difference.
8. **Save a stable link.** Give the issuer URL, and an archived copy if one exists, since pages move.
9. **Try the register.** When the item is a law, case or filing, search the official register or docket by number rather than by headline.
10. **Say what you could not reach.** If the item is behind a login or fee, give its citation and the nearest open description.

## Gotchas

- Sites that repost documents drop pages, appendices or later amendments. Use the issuer copy when it exists.
- A press release or abstract is not the primary item. Keep going to the full text or data.
- Preprints get revised after review. Say which version you read and look for the final one.
- Paywalled or restricted items: say so, report what the open abstract or metadata gives and do not guess the rest.
- Official sites reorganise. If a link is dead, search the title and reference code before concluding the item is gone.
- Excerpts shared online are often cut to flip meaning. Read the paragraphs around the quoted passage.
- Datasets get revised silently. Record the release date or version tag you read.
- A document title in the news is often shortened. Search with the distinctive words, not the whole headline.
- Leaked or unofficial copies may be altered. Prefer the issuer, and flag any copy you cannot match to it.

## Output

Item title, issuer, date, version status and link. Then the key passage located by section, and a two-line comparison against the coverage the user started from. Note anything you could not reach.
