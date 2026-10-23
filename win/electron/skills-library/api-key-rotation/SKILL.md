---
name: api-key-rotation
description: Rotates an API key, token or password in the right order: find every consumer, create the new credential, deploy it, confirm use, revoke the old one, and check access logs for misuse. Use when a key leaked, an employee left, or the user wants a routine rotation process.
---

# API key rotation

## Goal

Replace a credential so that the old one is dead and nothing that matters broke.

A good rotation is ordered so there is no gap, and treats a leak as an incident with a look at what the key did.

## When to use

- A secret was committed, pasted, logged or shown in a screenshot.
- Someone with access left or a device was lost.
- Policy requires periodic rotation.
- To find where secrets are exposed first, use `use_skill` with `secrets-scan`.

## Steps

1. If it leaked, say so plainly: assume the value is already used by others. Start the work now, and keep a timeline with `update_plan`.
2. Identify the credential: provider, scope, who owns it, what it can do. Ask with `ask_user` if the provider or account is unknown. Never ask for the secret value itself.
3. Find every consumer with `search_files` on the variable name across code, CI files, infrastructure code, deploy configs and docs. Also ask about people's local machines and third party tools.
4. Check how consumers get the value (environment, secret manager, file) with `read_file`, so you know where the new one must be placed.
5. Check the provider docs with `read_url` for whether two keys can be active at once. If yes, use the overlap method. If not, plan a short maintenance window.
6. Create the new credential with least privilege. The user does this in the provider console. Do not handle the value in chat.
7. Put the new value into the secret store and deploy consumers one at a time. Use `run_command` for read-only health checks after each.
8. Confirm the old key is no longer used: check the provider's last-used data or access logs before revoking.
9. Revoke the old credential. Verify revocation by a failing test call from a safe place, and confirm services still work.
10. For a leak, review the provider's audit log for the exposure window: unfamiliar addresses, resource creation, data reads. Escalate if found.
11. Remove the old value from code, but note history still holds it. It is only safe because it is revoked.
12. For routine rotation, record the interval, owner and automation, and set a reminder.

## Gotchas

- Revoking first and deploying after causes the outage that rotation should avoid. Overlap if possible.
- Forgotten consumers (cron hosts, old staging, a teammate's script) fail silently after revocation. Search wide.
- Deleting the key from git is not rotation. The value stays valid until the provider revokes it.
- Database passwords also live in connection pools. Old connections keep working until restarted.
- Signing keys and encryption keys need different handling: tokens signed with the old key must stay verifiable for a while.
- Do not paste old or new values in chat, tickets or commit messages while working.

## Output

- A numbered rotation plan with consumers, order, verification and revocation.
- For a leak, a misuse-check summary.
- Follow-ups: shorter lifetime, scoping, automation.
