---
name: incident-response
description: Guides a live production incident in order: confirm impact, mitigate before diagnosing, communicate, find the change that caused it, verify recovery and keep a timeline for the review. Use when the user says production is down, errors are spiking, or asks for help triaging an outage.
---

# Incident response

## Goal

Restore service as fast as safely possible, then understand why. The order matters: stop the harm, then find the cause.

A good response keeps a written timeline and a short status message ready for people who are waiting.

## When to use

- Users are affected right now: errors, slowness, data issues or an outage.
- An alert fired and the user does not know how serious it is.
- For the written review afterwards, use `use_skill` with `postmortem-writer`.

## Steps

1. Confirm impact in one pass. Ask with `ask_user`: what users see, since when, how many, and whether anyone has changed anything. Do not start with theory.
2. Set a severity from impact, not from cause: full outage, partial, degraded, or internal only. State it and keep it visible.
3. Start the timeline with `update_plan` entries or a file: each time, action and result. Record the time of every action you take.
4. Check what changed first. Run `git log --since` and `git_status` with `run_command`, and ask about deploys, config pushes, flag flips, certificate expiry and provider status pages.
5. Mitigate before diagnosing when a recent change is the likely cause: roll back, disable the flag, scale up, or fail over. Use `use_skill` with `rollback-runbook` when a release is the suspect.
6. Read recent errors. Use `run_command` to tail logs or query the log tool, and `search_files` for the exact error string in the code.
7. Check the dependencies in order: database, cache, queue, third party APIs, DNS, certificates. Use `search_web` or `read_url` on provider status pages.
8. Form one hypothesis at a time and test it with a read-only command. Do not run write or delete commands on production without the user's explicit yes.
9. Draft the status message: what is affected, what we know, what we are doing, next update time. Keep it free of guesses about cause.
10. After the fix, verify with a real request and the error rate, and wait a full observation window before declaring recovery.
11. Hand over the timeline and open questions for the review.

## Gotchas

- Restarting everything erases the evidence (memory state, logs on ephemeral disks). Capture logs and a heap or thread dump first when it is cheap.
- Chasing the root cause while users are still down extends the outage. Mitigate first.
- Several people changing things at once makes cause unknowable. Name one person who makes changes.
- A recovered graph is not recovery if queues are backed up or retries are still draining.
- Status messages that promise a time to fix and then miss it hurt more than saying when the next update comes.
- Never paste secrets or customer data from logs into a chat, a ticket or a status post.
- Several alerts firing at once usually share one cause. Find the lowest layer that is broken before chasing each symptom.

## Output

- Current severity, impact, suspected change and mitigation in under ten lines.
- The running timeline with timestamps.
- A ready status message.
- Open questions and the next safe check.
