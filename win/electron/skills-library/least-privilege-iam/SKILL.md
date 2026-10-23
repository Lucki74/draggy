---
name: least-privilege-iam
description: Reviews IAM policies, service accounts and database or app roles for wildcards, unused grants and privilege escalation paths, then writes tighter policies based on what each identity actually does. Use when the user asks to review IAM, shrink an over-broad role, or write a minimal policy for a service.
---

# Least privilege IAM

## Goal

Give each person and workload only the actions and resources it needs, so a stolen credential does limited harm.

A good result keeps the service working and shows the evidence for every permission removed or kept.

## When to use

- A policy uses `*` for actions or resources.
- A new service needs a role and the user wants it minimal.
- An audit flags admin access.
- For Terraform wider than IAM, use `use_skill` with `terraform-review`.

## Steps

1. Collect the policies. Use `search_files` for `Action`, `Resource`, `"*"`, `AdministratorAccess`, `roles/owner` and `iam_` in infrastructure code, or ask for an exported policy document. Read each with `read_file`.
2. List identities (users, groups, roles, service accounts) and what each is used for. Note shared accounts and long-lived access keys.
3. Flag broad grants: wildcard actions, wildcard resources, admin or owner roles, and `iam:*`, `PassRole`, `sts:AssumeRole` combined with broad resources, which allow escalation.
4. Determine what the workload really calls. Read its code with `search_files` for SDK calls, or use the provider's access analysis (last-used data, access advisor). Check the provider's tool names with `read_url`.
5. Write the minimal action list per resource. Scope resources by ARN or name, and add conditions (source network, tags, MFA) where the provider supports them.
6. Split roles by function: read-only, deploy, runtime. A CI role should not have the runtime role's data access.
7. Check trust policies: who can assume each role, and that third-party access uses an external id or equivalent.
8. Prefer short-lived credentials from roles or workload identity over static keys. List any static keys found for removal and rotation.
9. Validate new policies with the provider's simulator or policy validator through `run_command` where a CLI exists, and test in a non-production account first.
10. Apply changes in steps: add the new tight policy, watch for access-denied errors in logs, then detach the broad one.
11. Edit the infrastructure files with `edit_file` and keep policies in code under review.
12. Report permissions removed, kept with the evidence, and risks.

## Gotchas

- Removing a permission that a rare job uses (monthly report, disaster recovery) breaks it months later. Check logs over a long window.
- `PassRole` or the ability to edit policies lets an identity grant itself more. Treat these as admin-equivalent.
- Resource wildcards inside an allowed action, such as all buckets, can be broader than the action list suggests.
- Last-used data is per service and may lag. Absence of recent use is a hint, not proof.
- Explicit deny and organisation guardrails override allows; read all layers before concluding what a role can do.
- Application-level roles count too: the database user for the app should not own the schema.

## Output

- Identity table: purpose, current access, needed access, change.
- The proposed minimal policies.
- Rollout steps with the access-denied watch, and the evidence used.
