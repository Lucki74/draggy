---
name: content-calendar
description: Builds a realistic content calendar for a chosen period with topics tied to goals, formats, channels, owners, draft and review dates, and a buffer for slips. Use when the user asks for a content calendar, wants to plan posts for next month, or asks what to publish and when.
---

# Content calendar

## Goal

A schedule the team can actually keep. Each slot has a topic, a purpose, a format, a channel, an owner and dates for draft and review. The volume matches the capacity of the people involved.

## When to use

- The user publishes on a blog, newsletter or social channels and wants a plan for the next weeks or months.
- The user has ideas but no rhythm.
- For planning one campaign with a goal and budget, use `use_skill` with `campaign-brief`.
- For topics to cover, use `use_skill` with `keyword-research-plan`.
- For turning one piece into several, use `use_skill` with `content-repurpose`.

## Steps

1. Ask with `ask_user` for the period, the goals (readers, leads, sales, authority), the channels in use, who creates and approves, the hours available per week and any fixed dates (launches, events, holidays). Read existing plans or past posts with `read_file`.
2. Compute capacity. Estimate hours per piece by format (a short post, a long article, a video, an email) from the user's own experience. Divide weekly hours by those figures. That number is the most the calendar can hold, less a quarter for slips and review.
3. Choose a few themes tied to the goals and the audience's questions, three to five at most. Pillars keep the plan coherent.
4. Generate topic ideas under each theme. For each idea write the reader's question, the goal it serves and the format. Drop ideas that serve no goal.
5. Check fixed dates. Place content that must land on a date first (launch posts, seasonal pieces) and work backward to set the draft and review dates.
6. Fill the rest. Spread themes and formats so channels do not get the same topic on the same day. Mix pieces that take time with short ones.
7. Assign owners and dates for four stages: brief, draft, review, publish. Add a buffer week at the end of each month for slips.
8. Add the measure for each piece or theme: what you will look at after publishing (reads, replies, sign-ups, clicks) and when. Do not set targets from other companies' figures; use the user's baseline or measure first.
9. Set rules for the calendar: how late items are moved, who can add urgent items and what drops out when they do.
10. Present as a table or save a spreadsheet through `create_file`, with columns for date, channel, theme, topic, format, owner, status and measure.

## Gotchas

- A calendar full of every platform every day collapses in week two. Start with fewer channels and a rhythm that survives a busy week.
- Topics without a goal become filler. Tie each slot to something the user wants.
- Review time is often forgotten, especially when someone else must approve. Put it in the dates.
- Holidays and school terms change engagement and staffing. Check them for the audience's country.
- Evergreen and timely content need different lead times. Mark which is which.
- A calendar is a plan to update. Review it at the end of each month and re-plan.
- A calendar nobody reviews goes stale within a month. Put a recurring review slot in the plan itself.

## Output

A table covering the period, a short list of themes and rules, and a note on capacity and the buffer. Offer a spreadsheet with `create_file`.
