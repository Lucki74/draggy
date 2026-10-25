---
name: threat-model
description: Builds a lightweight threat model: what is being protected, who can touch it, where trust changes, what can go wrong at each boundary, and which mitigations come first. Use when the user asks to threat model a feature or design, find where an app is exposed, or review security before building.
---

# Threat model

## Goal

Find the security problems in a design while they are still cheap to change.

A good model is small enough to finish, names concrete attacks against concrete parts, and ends with a short ranked list of fixes.

## When to use

- A new feature handles logins, money, uploads, personal data or third party access.
- The user wants a security look at an architecture before coding.
- A review needs a map of entry points and data flows.
- For checking code that already exists, use `use_skill` with `security-review`.

## Steps

1. Ask with `ask_user` what the system does, who uses it, and what would hurt most if lost or abused. Skip questions the repository already answers.
2. Read the code or docs with `read_file`, and use `explore` or `search_files` for routes, queues, scheduled jobs, webhooks and outbound calls to list entry points.
3. List assets: data (credentials, personal data, payment data), capabilities (admin actions, sending email) and availability.
4. List actors: anonymous visitor, signed in user, other tenant, admin, internal service, third party, a compromised dependency.
5. Draw the data flow in text: actor to component to store, and mark each trust boundary where the data crosses between privilege levels or networks.
6. At each boundary ask the six STRIDE questions: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege. Write only threats that apply.
7. State each threat as a sentence with an actor, an action and a result, for example a tenant guessing another tenant's id to read invoices.
8. Check what controls exist already by reading the code: authentication, authorisation checks, validation, rate limits, logging.
9. Rate each open threat by impact and likelihood in three levels. Explain the rating in one clause. Do not use made up scores.
10. Propose mitigations and order them by risk reduced per effort. Mark which are design changes and which are code fixes.
11. Record assumptions and what is out of scope so the reader knows the limits.
12. Offer to save the model with `create_file` as `docs/threat-model-<feature>.md`.

## Gotchas

- A threat list with fifty equal items is ignored. Rank and cut to what matters.
- Models drawn from the diagram on a slide miss the admin tools, cron jobs and debug endpoints that exist in the code.
- Authorisation is the most common gap: the user is logged in, but may they touch this object. Check it at every boundary.
- Treating the internal network as trusted hides lateral movement. Ask what happens when one service is compromised.
- Third party integrations and webhooks are inputs. Their payloads need the same checks as user input.
- A model is a living record. Note the date and what change should trigger a rewrite.

## Output

- A short document: scope, assets, actors, data flow, threat table (threat, boundary, rating, mitigation), assumptions.
- The top three fixes called out.
- Open questions for the owner.
