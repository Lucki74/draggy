---
name: customer-persona
description: Builds a customer persona from real inputs such as interviews, support tickets and sales notes, covering goals, context, pains, how they decide and where to reach them, and marks every guess as a guess. Use when the user asks for a customer persona, wants to define an ideal customer, or needs to describe a target user.
---

# Customer persona

## Goal

A one-page description of a typical buyer or user that guides real decisions about product, message and channels. Every claim traces to evidence or is labeled as an assumption to check.

## When to use

- The user is defining who a product or campaign is for.
- The user has interview notes, survey results or customer messages and wants them turned into a profile.
- For the underlying need in situation form, use `use_skill` with `jobs-to-be-done`.
- For testing whether the guesses in a profile hold, use `use_skill` with `assumption-test-plan`.
- A new team member needs a quick picture of who the customer is.

## Steps

1. Ask with `ask_user` what the product is, who buys today (if anyone), and what evidence exists: interview notes, tickets, reviews, sales call notes, survey data. Open files they name with `read_file` and `search_files`.
2. Decide how many personas. One primary persona is the default. Add a second only when two groups need different things, and say which one wins when they conflict.
3. Pull facts from the evidence into five areas: role and context (what they do, team, constraints), goals (what success looks like for them), pains (what blocks them now, in their words), how they decide (who else is involved, what they compare, what they fear), and where they spend time (tools, communities, media).
4. Copy two or three real quotes from the material. Mark them as quotes and remove names.
5. Leave out unrelated detail such as age, hobbies and a stock photo unless it changes a decision. A trait belongs only if it affects what you build, say or where you show up.
6. Mark each line as evidence (with the source), inference, or guess. Count them. If most lines are guesses, say the persona is a hypothesis and propose five interview questions to fill the gaps.
7. Add the buying trigger: the event that makes them look for a solution now. And the blocker: the reason they would not buy.
8. Write the implications: three things the team should do differently because of this persona (message, feature, channel).
9. Check the profile against a real customer: does it fit and what would they correct? Ask the user.

## Gotchas

- A persona invented from imagination invites bias. Without evidence, label it a hypothesis.
- Demographic filler (name, age, hometown) feels vivid and decides nothing. Keep only traits that change choices.
- Combining buyer and user into one person fails when they differ. Split them if they do.
- Averages describe nobody. Prefer a sharp example over a blend.
- Teams treat a finished persona as fact. Keep the evidence labels visible so it stays open to correction.
- Personas go stale as the customer base shifts. Date it.
- Keep personal data of real customers out of the document.
- Quotes from interviews may identify people. Anonymize and ask whether the user has consent to reuse them.

## Output

A one-page profile: Summary line, Context, Goals, Pains with quotes, Decision process, Trigger and blocker, Where to reach them, Evidence level per section, and Implications. List open questions at the end.
