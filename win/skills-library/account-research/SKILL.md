---
name: account-research
description: Collects public facts on a target company and contact, then reduces them to a short brief of hooks, risks and open questions. Use when the user wants to research a company before outreach or a call, asks for an account brief, or wants to know what is public about a prospect.
---

# Account research

## Goal

Hand the user a brief they can read in two minutes before talking to a prospect. Every fact has a source and a date, and the brief ends with angles the seller can use and questions still open.

## When to use

- Before a first email, call or meeting with a named company.
- The user has a company name and nothing else.
- Writing the email itself is `use_skill` with `cold-outreach-email`.

## Steps

1. Confirm the target with `ask_user`: exact company name, website, the contact's name and role, and what the seller offers. Ask for the country if the name is common.
2. Open the company's own site with `read_url`: what they sell, who they sell to, size hints, careers page, news page.
3. Use `search_web` for recent items: funding, launches, leadership changes, press, filings. Prefer the company's own releases and recognised outlets.
4. Check the contact: role, tenure and public writing. Use only professional, public material.
5. Cross-check identity. Confirm the website, location and sector match before relying on any result.
6. Write the brief: what they do, recent events with dates, likely priorities, who is involved, possible problems the seller could help with.
7. Add two or three hooks and the one question that would test each.
8. List what you could not find and what conflicts between sources.
9. Rank hooks by how directly they connect to the seller's offer, and drop the weak ones.
10. Offer to turn the best hook into a first message with `use_skill` and `cold-outreach-email`.

## Gotchas

- Mixing up two companies with similar names. Verify the domain and city.
- Presenting a three-year-old article as news. Date every item.
- Counting a job posting as a stated priority. It is a hint, say so.
- Guessing revenue or headcount from third-party sites that estimate. Label estimates.
- Collecting personal details about the contact beyond their working role. Leave them out.
- Padding with facts that give the seller no angle. Cut anything that changes no action.
- Treating a press release as an independent source. It is the company's own claim.
- Trusting search snippets. Open the page with `read_url` before citing it.

## Output

A brief of one page: snapshot, recent events with source and date, contact, hooks with a test question each, and gaps. Links go at the end.

Keep the brief to facts you can link; put guesses under a separate heading.
