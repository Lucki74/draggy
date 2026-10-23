---
name: candidate-scorecard
description: Builds a scorecard from role criteria and uses it to compare candidates on interviewer notes, keeping evidence beside each score. Use when the user wants to compare candidates, make a hiring scorecard, or rate finalists.
---

# Candidate scorecard

## Goal

Make a hiring comparison rest on the same criteria and on written evidence. The scorecard sets the criteria and weights before interviews, collects scores with proof, and shows where interviewers disagree.

## When to use

- Several candidates are at the same stage and a decision is due.
- The team wants a record of why someone was chosen.
- Writing the questions first is `use_skill` with `interview-question-set`.

## Steps

1. Read the job description with `read_file`, or ask with `ask_user` for the main needs. Pull four to six criteria, matching the competencies used in interviews.
2. Set the weights now, before looking at any candidate, and have the hiring manager approve them. Write them in the file.
3. Define a rating scale with anchors, such as one for no evidence, three for meets the need and five for clearly above it, with a line for each level.
4. Build the table with `create_file`: one row per criterion, columns for each candidate's score, the evidence note and the interviewer.
5. Collect notes from each interviewer separately and ask for scores before the group meets, so one voice does not set the others.
6. Enter scores with a quote or observed example in the evidence cell. Leave a cell blank when there was no evidence, and do not fill it with a guess.
7. Compute weighted totals with `run_code` if there are more than a few cells. Show the arithmetic.
8. Mark criteria where interviewers differ by two or more points, and list them for discussion.
9. Review the evidence for traits unrelated to the work, such as accent, school prestige or shared hobbies, and flag them for removal.
10. Summarize each candidate in three lines: strengths with evidence, concerns with evidence, and open questions for references.
11. Record the decision and the reasons, and note that the totals inform the choice and do not make it.
12. Archive the filled scorecard with the decision, following the company's retention rules.

## Gotchas

- Scoring on likeability or similarity to the interviewer.
- Weights chosen after meeting the candidates.
- Using traits unrelated to the work as criteria.
- Averaging away a real disagreement instead of discussing it.
- Scores with no evidence beside them.
- Treating a small gap in totals as a clear winner.
- Keeping notes that include personal details unrelated to the job. Confirm retention rules with HR.
- Letting the most senior voice speak first in the debrief.

## Output

The scorecard table, weighted totals with arithmetic, a list of disagreements and a short written comparison per candidate.
