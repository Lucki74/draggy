---
name: terraform-review
description: Reviews Terraform code and plan output for destructive changes, forced replacement, state handling, hard coded secrets and over broad access, then lists what to fix before apply. Use when the user asks to review Terraform, judge whether a plan is safe, or check a module.
---

# Terraform review

## Goal

Stop a bad `terraform apply` before it runs, by reading the code and the plan the way an operator who owns the outage would.

A good review names each resource that will be destroyed or replaced and why, and what protects the data.

## When to use

- The user pastes or points to a plan, a module or a pull request touching `.tf` files.
- A plan shows replacements the user did not expect.
- State backend or workspace layout needs a check.
- For IAM policy depth, use `use_skill` with `least-privilege-iam`.

## Steps

1. Find the files with `list_directory` and `search_files` for `resource "` and `module "`. Read the backend and provider blocks first with `read_file`.
2. Check provider and module version constraints. Look up current provider docs with `read_url` when an argument looks renamed or deprecated.
3. Run `terraform fmt -check` and `terraform validate` with `run_command`. Run `terraform init -backend=false` first if the project is not initialised.
4. If a plan file or output exists, read it. If not, ask the user before running `terraform plan`, because it reads real credentials and real state.
5. List every line marked destroy or replace (`-/+`). For each, find the argument that forces it and say whether it is a rename, an immutable field or a tag change.
6. Check stateful resources (databases, buckets, disks, keys) for `prevent_destroy`, deletion protection, and backup settings.
7. Search for secrets with `search_files` on `password`, `secret`, `token` and `access_key`. Values should come from variables marked `sensitive` or a secrets manager.
8. Check security groups, bucket policies and IAM for `0.0.0.0/0`, `*` actions and public access flags.
9. Check state: remote backend, locking, encryption, and that state is not committed to git.
10. Check that variables have types and validation, outputs do not leak secrets, and `count` or `for_each` keys are stable values, not list positions.
11. Check environments for copy paste drift: names, regions and account ids that are hard coded instead of variables.
12. Write the findings with the resource address, the risk and the fix.

## Gotchas

- Reordering a list used with `count` makes Terraform replace resources whose index shifted. `for_each` with stable keys avoids it.
- A plan reads state at one moment. Applying later with another change merged can differ from what was reviewed, so save the plan with `-out`.
- `terraform state rm` and `import` change what Terraform believes without touching real infrastructure.
- Sensitive values are hidden in plan output but still stored in plain text in state.
- `ignore_changes` can hide drift that matters, such as a security group edited by hand.
- Renaming a resource block plans a destroy and create unless a `moved` block is added.

## Output

- Findings ranked by risk with resource address, cause and fix.
- A list of resources the plan destroys or replaces, with a safe or unsafe call on each.
- A verdict, and what was not checked because no plan or credentials were available.
