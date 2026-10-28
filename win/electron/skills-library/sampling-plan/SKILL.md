---
name: sampling-plan
description: Plans how to sample a population and how large the sample must be for a question, stating bias risks and the margin of error. Use when the user asks how many responses they need, how to sample, or whether their sample is big enough.
---

# Sampling plan

## Goal

Choose a way of selecting units and a sample size that can answer the question at the precision the user needs, and say what the sample can and cannot claim. A good plan names the population, the sampling frame, the method, the size with its arithmetic, and the checks for bias.

## When to use

- A survey, audit, test of records or quality check where not everything can be examined.
- The user has a sample already and wants to know how much it can support.
- A request such as "ask 100 customers" needs turning into a defensible plan.
- For analysing the survey afterwards, use `use_skill` with `survey-analysis`.
- For reading an experiment with a planned split, use `use_skill` with `ab-test-reading`.

## Steps

1. Pin down the question and the quantity to estimate. Use `ask_user`. A share ("what percent of invoices have an error"), an average ("typical handling time") and a comparison between groups need different sizes.
2. Define the population and the frame. The population is who you want to speak about. The frame is the list you can sample from. Note the gap between them, such as customers with no email.
3. Choose the method:
   - Simple random sampling when the list is complete and units are alike.
   - Stratified sampling when groups differ and you need results for each, with a minimum per stratum.
   - Cluster sampling when units sit in groups and travelling or listing is costly, accepting a larger error.
   - Systematic sampling (every kth record) from a list in random order.
   - Convenience samples only as an exploration, labelled as such.
4. Set the target precision and confidence: for example a margin of error of 5 points at 95 percent confidence. Ask the user for the precision they need, and what decision rides on it.
5. Compute the size with `run_command`. For a proportion with an unknown rate use the worst case 0.5: n = z squared times p times (1 minus p) divided by e squared, with z about 1.96 for 95 percent. For a mean use the standard deviation from a pilot or earlier data. Apply the finite population correction when the sample is more than about 5 percent of a small population.
6. Adjust for losses. Divide by the expected response or valid-record rate, for example 40 percent, to get the number to contact or pull.
7. Size for the smallest subgroup you must report on. A total of 400 split five ways leaves 80 each and wider margins per group.
8. Write the selection steps so they can be repeated: a random seed, the sort order of the list, the code or spreadsheet formula used. Use `run_command` to draw the sample and `create_file` to save it.
9. Plan the bias checks: compare the achieved sample with known population shares, follow up on non-responders, and decide in advance whether to weight.

## Gotchas

- A larger sample does not fix a biased frame. Ten thousand responses from a self-selected group are still self-selected.
- The margin of error covers sampling variation only. It ignores nonresponse, wording and coverage errors.
- A sample size worked out for the total is too small for subgroup comparisons, which need their own calculation.
- Taking the first N rows of a file is not random. Files are often sorted by date, region or ID.
- Treating a 20 percent response as if everyone answered ignores that responders differ from those who stay silent.

## Output

- Population, frame, method and reasons.
- The sample size with its inputs and arithmetic, the number to contact, and the subgroup sizes.
- The selection procedure with the seed, and the bias risks with the plan to check them.
- The target population, the sampling frame and the known gaps between them.
- The sample size with the margin of error and confidence level it supports.
- The selection method, the random seed and where the selected list is saved.
- The plan for non-response and the review date for the plan.
