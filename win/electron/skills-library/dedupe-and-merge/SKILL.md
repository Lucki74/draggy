---
name: dedupe-and-merge
description: Finds duplicate and near-duplicate records across one or several sources, picks survivors with stated rules and merges them while keeping an audit trail. Use when the user asks to dedupe a customer list, merge two lists, or find records that are the same person.
---

# Dedupe and merge

## Goal

Collapse records that describe the same real-world entity into one, without merging different entities or losing information. A good result has a match rule that was tested on a sample, a review step for uncertain pairs, a survivor rule for each field, and a log that makes every merge reversible.

## When to use

- A contact, customer, product or supplier list has repeated entries.
- Two lists from different systems must be combined into one.
- A CRM import needs matching against existing records.
- For basic cleanup such as trimming and standardising first, use `use_skill` with `csv-cleaner`.
- For checking that keys work before a join, use `use_skill` with `join-keys-check`.

## Steps

1. Establish what counts as the same entity with the user. Use `ask_user`. A person with two emails, two branches of one company, two products in different pack sizes: say which should merge.
2. Profile the sources with `run_code`: row counts, key fields, the share of blanks, and exact duplicates on each candidate key. Note which source is more trustworthy for which field.
3. Normalise for matching, in new helper columns and not over the originals: lowercase, strip accents and punctuation, collapse spaces, standardise phone numbers to digits, split email into local part and domain, expand common abbreviations in addresses (St and Street), and remove legal suffixes from company names.
4. Block to limit comparisons. Compare only records sharing a cheap key such as the first letters of the surname plus the postcode, or the email domain. All-pairs comparison does not scale beyond a few thousand rows.
5. Score pairs within blocks. Start with exact rules (same normalised email, same phone and surname), then fuzzy ones (a string similarity of names above a threshold combined with the same city or birth date). Record the rule that produced each match.
6. Sample the matches by score band and read them with the user. Count false merges and missed pairs per band. Set a high threshold for auto-merge, a middle band for manual review, and leave the rest.
7. Group matched pairs into clusters. Watch for chains where A matches B and B matches C but A and C differ, and send those clusters to review.
8. Define the survivor per field: the most recent non-blank value, the value from the trusted source, or the most complete record. Keep other values in an alias or history column.
9. Write the result to a new file with `create_file`: merged records with a stable new ID, and a mapping file from old IDs to new ones with the rule and the date. Never overwrite the sources.
10. Verify: row count equals the sources minus merges, no key is lost, and ten merged clusters read right by eye.

## Gotchas

- Similar names are often different people (a father and son, common names in one city). Names alone are weak evidence, so require a second field.
- Merging on a shared email or phone puts family members and shared mailboxes together. Check how often a key repeats across different names.
- Choosing the longest value as the survivor keeps typos and junk. Prefer trusted source and recency.
- A threshold tuned on one source behaves differently on another. Test on each.
- Without the mapping file, a wrong merge cannot be undone and downstream references break.
- Keep the original file untouched and write the merged result to a new file, so a wrong rule can be undone.

## Output

- Match rules, thresholds and the review results with error counts.
- Counts: input records, clusters, auto-merged, reviewed, left alone.
- The paths of the merged file and the mapping file, and the unresolved cases.
- The matching rules, thresholds and the count of pairs found at each level.
- The survivorship rule for merged records and the file of merged groups for audit.
- The pairs left for manual review, with the reason each was uncertain.
- The row counts before and after, reconciled to the number removed.
