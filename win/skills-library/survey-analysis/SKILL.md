---
name: survey-analysis
description: Cleans survey responses, handles rating scales and open text, applies weights where needed and reports results with sample sizes and margins. Use when the user asks to analyse survey results, summarise responses by group, or find themes in free-text answers.
---

# Survey analysis

## Goal

Say what respondents said, to what extent that speaks for the wider group, and which differences are large enough to matter. A good analysis reports every percentage with its base, treats scales properly, separates open text themes from counts, and states who did not answer.

## When to use

- An export from a survey tool (CSV or sheet) needs summarising.
- The user wants results by segment such as department, region or customer type.
- Free-text answers need grouping into themes.
- For choosing how many respondents are needed, use `use_skill` with `sampling-plan`.
- For writing the final report, use `use_skill` with `findings-writeup`.

## Steps

1. Ask about the survey: the target population, how people were invited, how many were invited, the dates, and whether answers are anonymous. Use `ask_user`. This sets the response rate and the bias risks.
2. Load the export with `run_command`. Read the question text and the coding of each answer (1 to 5 meaning what). Build a small codebook that maps columns to question wording and labels.
3. Clean without distorting. Remove test responses and duplicates, and flag speeders (finished in a fraction of the median time) and straight-liners (the same answer on a whole grid). Decide on partial responses and state the rule.
4. Report the base for each question: how many were asked and how many answered. Keep "don't know" and "not applicable" as separate categories.
5. Summarise single-choice questions as percentages of valid responses. Summarise rating scales as the distribution across points, and give a top-two-box figure (share choosing the top two options) beside the mean if a mean is shown at all.
6. Compare groups only where each group has enough responses. Use a chi-square test for category differences or a rank-based test for ordinal scales, and give the size of the difference with its interval. Mark groups under about 30 as indicative.
7. If the respondents differ from the population (for example, too few young people), apply weights based on known population shares, state the variables used, and show weighted and unweighted results side by side.
8. Analyse open text with a repeatable method: read a random sample of at least 50 answers, propose themes, code every answer (a response can have several), and count. Use `run_command` to apply keyword rules, then check 30 coded answers by hand. Quote two short, anonymised examples per theme.
9. Look at who did not respond: compare early and late responders, and the profile of respondents with the invited list.
10. Save tables and charts with `create_file`, with the question wording in each title.

## Gotchas

- An average of a 1 to 5 agreement scale treats the gaps as equal and hides polarisation. Show the distribution.
- Percentages without a base mislead: 50 percent of 8 people is not a finding.
- Self-selected surveys over-represent people with strong views. Do not describe them as the opinion of everyone.
- Leading or double-barrelled question wording limits what answers mean. Report the exact wording.
- Free-text quotes can identify a person in a small team. Remove names and details, or aggregate.
- Small subgroups produce noisy percentages. Show the count beside each and hide cells below a stated minimum.

## Output

- Response rate, base sizes and the cleaning rules.
- Results by question with percentages and bases, and group comparisons with intervals.
- The theme table for open text with counts and examples, and the limits of the data.
- The response count, response rate if known, and the weighting used or the reason none was applied.
- The questions with the highest non-response, since they weaken the reading.
- The path of the cross-tab and chart files produced.
- Open-text themes with counts and two quoted examples each.
