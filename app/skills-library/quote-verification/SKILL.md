---
name: quote-verification
description: Checks whether a quote is real by finding its earliest reliable appearance, the exact original wording, the speaker and the context in which it was said. Use when the user asks if someone really said something, who said a quote, or whether a famous line is misattributed.
---

# Quote verification

## Goal

Say whether a quote is genuine, misattributed, altered or invented, and back the verdict with the earliest traceable source. The user also gets the exact words and the setting, since context often changes the meaning.

## When to use

- A quote circulates on a poster, post or article and the user doubts it.
- The user needs a quote for a speech, paper or caption and wants the attribution right.
- To trace a non-quote claim or number, use `use_skill` with `claim-tracing`. For a general fact, use `fact-check`.

## Steps

1. **Copy the exact text.** Note the wording, the named speaker and where the user saw it. Ask with `ask_user` for the link if there is one.
2. **Search the phrase.** Use `search_web` with the exact words in quotes, then with the first and last half separately. Add the speaker's name in a second pass.
3. **Skip the quote farms.** Sites that list quotes without a source are not evidence. Look for books, transcripts, recordings, letters, official records and news reports from the time.
4. **Find the earliest appearance.** Sort hits by date. Open the oldest with `read_url` and check it gives a primary location: speech, page, interview, date.
5. **Check the original wording.** Compare the viral version with the earliest. Note edits, shortening, merged sentences and changed words.
6. **Check the language.** If the speaker used another language, find the original and note that the English is a translation, with who translated it.
7. **Check the context.** Read the lines before and after in the original. State whether the quote means the same thing in context.
8. **Check for a known history.** Search the quote with words like misattributed, apocryphal, falsely. Open what reference works say.
9. **Give a verdict.** Genuine, genuine but trimmed, misattributed (with likely true source if known), unverified, or invented.
10. **Look for the audio or video.** For spoken quotes, find the recording and note the timestamp so the user can hear the words.
11. **Suggest safe wording.** If the quote is unverified, offer a paraphrase attributed to what the source does support.

## Gotchas

- Famous names attract quotes. A line that sounds like the person is the usual sign of attribution drift.
- A quote on a video may be a paraphrase in the subtitles. Check the audio or a transcript from the speaker's side.
- Books quoting each other repeat errors for decades. The earliest source must be a first-hand record.
- Different translations of one line are not different quotes, and not proof of invention either. Find the source language.
- "Unverified" is a valid result. Do not stretch weak evidence into a verdict.
- Trimmed quotes can reverse a point ("I did not say..." becomes "I said..."). Always read the surrounding text.
- Quotes from fiction, films or songs get pinned on real people. Search the phrase against scripts and lyrics sources too.
- Dates matter: a quote tied to an event before its supposed speaker was active is a strong sign of invention.

## Output

Verdict first, in one line. Then the best source with date and location, the exact original wording, the context in two sentences, and a safe way to cite it. If misattributed, name the likely true source or say it is unknown.
