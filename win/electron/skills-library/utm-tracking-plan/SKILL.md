---
name: utm-tracking-plan
description: Creates a UTM naming convention and a tagged link sheet for campaigns, with fixed lowercase values, a controlled vocabulary, a link builder and rules that keep reports clean and free of personal data. Use when the user asks for UTM tracking, campaign link tagging or a naming convention for analytics.
---

# UTM tracking plan

## Goal

A short convention and a ready link list that make campaign traffic readable in analytics. Names are consistent, tags go only on external links and nothing personal appears in a URL.

## When to use

- The user runs email, social, ads, partners or print codes and cannot tell which brought visitors.
- Reports show messy duplicates such as "Facebook", "facebook" and "fb".
- For the campaign itself, use `use_skill` with `campaign-brief`.
- For test setups that need tagged variants, use `use_skill` with `a-b-test-plan`.
- For the post schedule that uses these links, use `use_skill` with `content-calendar`.

## Steps

1. Ask with `ask_user` for the analytics tool, the channels in use, the campaigns planned, who creates links and where links are stored. Check the tool's documentation with `read_url` if the user is unsure which parameters it reads.
2. Choose the parameters. The standard five are source (where the traffic is from), medium (the kind of channel), campaign (the initiative), term (paid keyword, optional) and content (the variant, optional). Use only what the team will fill in.
3. Fix the rules: all lowercase, hyphens instead of spaces, no special characters, no personal data, short but readable values, dates in a single format.
4. Define a controlled vocabulary. List allowed values for source (for example the platform names) and for medium (for example email, social, cpc, referral, affiliate). Map each channel to one pair only. Put it in a table so no one invents new ones.
5. Define the campaign naming pattern, such as `year-month_topic_goal`, and give two worked examples. Keep content values to describe variants like `hero-a` or `video-short`.
6. Write the do-not list: never tag internal links on your own site (it resets sessions and attribution in many tools), never tag organic search, and avoid tagging links that already carry another tool's parameters unless the tool supports it.
7. Build the link sheet with `create_file`. Columns: base URL, source, medium, campaign, content, term, final URL, owner, date, status. Generate final URLs with `run_code` to avoid typos, encoding values correctly. Check that existing query strings in the base URL are preserved.
8. Test one link: open it, confirm the landing page loads, and check in the analytics real-time view that source, medium and campaign appear as planned.
9. Document the process: who adds links, where the sheet lives, how new values get approved and how often it is reviewed for stray values.
10. Plan the report: which view or dashboard groups by campaign and medium, and the check for unexpected values each month.

## Gotchas

- Inconsistent case splits one channel into several rows. Enforce lowercase.
- Tagged internal links overwrite the original traffic source in many tools. Use event tracking for internal clicks.
- Personal data in a URL, such as emails or names, leaks through logs and referrers and may breach privacy law. Never include it.
- Link shorteners can hide the tags; test the final destination.
- Redirects can strip parameters. Check that the landing page keeps them.
- Too many custom values make reports unreadable. Keep the vocabulary small.
- Some email and social apps open links through their own wrapper. Confirm the tags survive in a real test.

## Output

The convention, the vocabulary table, the do-not list, the link sheet (offer a file via `create_file`), the test result and the review routine.
