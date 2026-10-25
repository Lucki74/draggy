---
name: compare-sources
description: Lines up several sources on one question and shows where they agree, where they differ and the reason for each difference, such as definition, date, method or interest. Use when the user asks if articles agree, how sources differ, or which of several accounts to believe.
---

# Compare sources

## Goal

Replace a pile of tabs with a clear picture of one question: what each source says, how far they truly conflict and what explains the conflict. The user can then judge, with the reasons in front of them.

## When to use

- The user has two or more sources on the same point and wants them reconciled.
- Numbers or conclusions differ and the user does not know why.
- To rate one source alone, use `use_skill` with `source-evaluation`. For choosing between products or options, use `compare-options`.

## Steps

1. **State the question.** Write it as one sentence. Every source gets read for that question only.
2. **Load the sources.** Use `read_url` for links and `read_file` for documents. Note author, outlet, date and type for each (primary, report, commentary).
3. **Extract each position.** For every source, write the answer to the question in its own terms, with a short quote and location. Keep quotes brief.
4. **Extract the basis.** Record what each source rests on: its own data, a cited study, an interview, an assumption.
5. **Align definitions.** Check that the key terms, units, population and time period mean the same thing in each source. Rewrite them in a shared form where you can.
6. **Build the matrix.** Rows are sources, columns are position, basis, definition, date. Fill every cell.
7. **Sort differences.** For each gap, decide the cause: different definition, different period, different method, different data, different interest or plain error. If a cause cannot be found, label it unexplained.
8. **Check independence.** Trace whether two sources use the same underlying data. If so, count them once.
9. **Conclude.** Say where the evidence points and how firm that is, or say that it does not settle.
10. **Check recency.** Note which source saw the latest data, and whether older ones were later corrected.
11. **List what no source covers.** Name the part of the question that none of them answers.

## Gotchas

- Most apparent conflict comes from different definitions. "Unemployment" or "users" can mean three things. Align terms before judging.
- Sources that agree may share one origin. Agreement is only worth counting between independent bases.
- Reading only conclusions hides the method. Open the part that explains how the figure was reached.
- The newest source is not the most correct. It may use a revised or narrower measure.
- Do not average conflicting numbers. Report the range and the reason.
- Keep your own view out of the matrix. Put it in the conclusion, labelled as yours.
- A source that hedges looks weaker than one that states flatly. Confidence in tone is not confidence in evidence.
- Two sources from the same publisher or wire service count as one voice.

## Output

The matrix first, as a table. Then a short list of differences with their causes, then a conclusion of two to four sentences stating the confidence. Quote sparingly and always give the source.
