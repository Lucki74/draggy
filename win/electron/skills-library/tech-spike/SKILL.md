---
name: tech-spike
description: Answers one technical unknown with a time-boxed experiment, throwaway code and written evidence, and ends with a clear recommendation. Use when the user asks whether something is feasible, wants to try a library or approach before committing, or asks for a spike.
---

# Technical spike

## Goal

Replace a guess with evidence. A spike answers one written question within a fixed budget and delivers a recommendation: go, no-go, or go with changes. The code produced is for learning, not for shipping.

## When to use

- "Can we do X with library Y", "is this feasible", "try this before we commit".
- An estimate or plan has a large unknown that dominates the risk.
- Two approaches need a quick head-to-head on the thing that matters.
- The question is about product direction, not technology: use `brainstorming`.
- The unknown is already answered by docs: just read them with `read_url`.

## Steps

1. Write the question as a single sentence that can be answered yes or no, or with a number. "Can the parser handle files over the largest size we have?" is a question. "Look into parsers" is not. Confirm it with `ask_user` if it is ambiguous.
2. Set the time box with the user (a few hours is typical) and a success rule: what result means go, and what means no-go. Write both down before starting.
3. Read what is known. Use `read_url` and `search_web` for official docs, release notes and known issues, and check the version in use. Use `search_files` and `read_file` for how the project already handles similar things.
4. Choose the cheapest experiment that can fail. Prefer a small script, a test or a one-file prototype over wiring into the real app. Create it in a scratch folder with `create_file`, outside shipped source.
5. Run it with `run_command` using realistic input, not toy data. Record exact commands, versions and results as you go, including failures.
6. Probe the edges that decide the answer: the largest input, the slowest path, the platform quirks, the auth or licence limits. Measure real figures from your runs instead of quoting claims from marketing pages.
7. Stop at the time box or at the first decisive result, whichever comes first. If the box ends with the question open, say what is still unknown and what the next experiment would be.
8. Write up: the question, what was tried, results with evidence, what surprised you, the recommendation, and the effort remaining if it is a go. Save it with `create_file` where the team keeps notes.
9. Clean up. Delete or clearly label the prototype, so it is not mistaken for production code. Do not merge it.
10. Feed the result back: update the plan, estimate or decision record that the spike was meant to inform. Use `adr-writer` if it settles an architecture choice.

## Gotchas

- Without a written question the spike wanders and ends in "interesting findings" and no decision.
- Spike code gets promoted to production because it works. Mark it as throwaway and keep it out of the main tree.
- Testing the happy path with small data proves nothing. The decision lives in the edge: scale, failure, platform.
- Trusting a README claim without running it. Docs describe intent; the experiment shows behaviour on your version.
- Reporting findings with no recommendation hands the work back. State go, no-go or conditions.
- Overrunning the time box silently. Stop and ask the user whether to extend, with a reason.

## Output

A one-page note: Question, Time box, Method, Results (with commands and numbers), Recommendation, Remaining unknowns. In chat, lead with the recommendation in one sentence and give the file path.
