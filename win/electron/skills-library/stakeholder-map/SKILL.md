---
name: stakeholder-map
description: Lists the people and groups affected by or able to affect a project, grades their influence and interest, and plans how to engage each one, including the quiet blockers. Use when the user asks who the stakeholders are, wants a stakeholder map, or needs a plan for getting buy-in.
---

# Stakeholder map

## Goal

A clear view of who matters to a project and what each of them needs. The user knows whom to involve early, whom to keep informed, whom to watch, and what to say to each.

## When to use

- A project, change or proposal depends on approval or cooperation from several people.
- The user is preparing to pitch, reorganize or roll out something and expects pushback.
- For a message to a single decision maker, use `use_skill` with `strategy-memo`.
- For a pitch to another company, use `use_skill` with `partnership-pitch`.
- For tracking project risks, use `use_skill` with `risk-register`.
- A change is coming that will affect many teams and the user must sequence the conversations.

## Steps

1. Ask with `ask_user` for the project, its goal, its timeline and what the user needs from others (budget, approval, time, adoption).
2. Brainstorm broadly, then narrow. Walk through the chain: who pays, who decides, who builds, who uses, who maintains, who is affected, who audits, who could stop it. Ask who the user has not thought about, such as a team that inherits support or a department that owns a needed system.
3. List each stakeholder with role, what they care about (goals, fears, current workload) and what they can do to the project (approve, block, delay, advocate). Use roles when names are sensitive.
4. Grade influence (can they change the outcome) and interest (do they care or are they affected) as high or low. Place each in one of four groups: manage closely (high, high), keep satisfied (high influence, low interest), keep informed (low influence, high interest), monitor (low, low).
5. Mark their current stance toward the project: champion, supportive, neutral, doubtful or opposed. Mark what you know and what you assume. Do not assume support from silence.
6. For the top group, find what each one needs in order to say yes: evidence, a say in the design, a guarantee on workload, credit, a pilot first. Ask the user what they know of these people.
7. Plan engagement per group: who talks to whom, how (one-on-one, update, workshop), how often, what is asked and what is offered. Sequence them: who should hear first, who should not hear second-hand.
8. Plan for opposition. For each opposed or doubtful stakeholder, list their likely objection in their own terms and a response that addresses it.
9. Set review dates. Stances shift, so schedule a re-check at each milestone.
10. Keep it private. Remind the user to store the map where only they can see it.

## Gotchas

- Titles are not influence. Executive assistants, finance analysts and long-time operators often hold more practical power than their rank suggests.
- Leaving out the people who maintain or use the result means they find out too late.
- Stance guessed from rumor is risky. Mark it "assumed" and check by talking to them.
- Treating opponents as enemies hardens them. Their objection often points at a real flaw.
- A stakeholder map written for a shared drive can leak and hurt relationships. Keep notes factual and respectful.
- The map ages quickly in a reorganization. Update after each change in staff.
- Engaging only the supporters feels easy and leaves the real risk untouched. Schedule at least one talk with a doubter.

## Output

A table of Stakeholder, Role, Cares about, Influence, Interest, Stance, Needs to say yes, Engagement and Owner. Add a short sequencing plan and a review date. Mark the file private if saved with `create_file`.
