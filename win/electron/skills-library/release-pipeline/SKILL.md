---
name: release-pipeline
description: Designs a release pipeline that builds one immutable artifact, versions and signs it, promotes the same artifact through staging to production with gates and approvals, and records what is deployed. Use when the user asks to automate releases, add versioning or tagging, or promote builds between environments.
---

# Release pipeline

## Goal

Make a release a repeatable, auditable event: the thing tested in staging is byte for byte the thing that runs in production.

A good pipeline is short, fails early, and tells you which version runs where.

## When to use

- Releases are manual, or built separately per environment.
- Nobody can say which commit is in production.
- The user wants tags, changelogs or approvals added.
- For basic test and lint workflows, use `use_skill` with `ci-workflow` first.

## Steps

1. Read the current process: workflows with `search_files` under CI folders, scripts, and the README release notes. Use `read_file` on each.
2. Decide the trigger: tag push, merge to main, or manual dispatch. Match it with the team's branching style.
3. Pick a versioning rule and apply it automatically: semantic version from tags, or commit hash plus date. Write the version into the artifact and the running app so it can be queried.
4. Build once. Produce one artifact (image, package, bundle) and push it to a registry with an immutable tag and a digest. Never rebuild for production.
5. Run gates in order of cost: lint and unit tests, build, integration tests, security scan of dependencies, then deploy to staging and run smoke tests.
6. Promote by reference: production deploys the digest that passed staging. Environment differences come from config, not code. See `use_skill` with `env-config-management`.
7. Add an approval step for production if the team wants it, using the platform's environment protection. Check current syntax in the docs with `read_url`.
8. Generate release notes from merged changes with `run_command` on git log, and attach them to the release.
9. Record deployments: version, time, who or what triggered it, in the registry, a deploy log or tags.
10. Add concurrency control so two pipeline runs cannot deploy to one environment at once, and cache dependencies for speed.
11. Add a rollback path: redeploy a previous digest by one command or button.
12. Write or edit the workflow files, then dry run on a branch and fix failures.

## Gotchas

- Rebuilding per environment means production runs code that was never tested. Promote the same digest.
- Mutable tags such as `latest` or `v1` make it impossible to say what is running or to roll back precisely.
- Secrets available to pull request builds from forks can be exfiltrated. Restrict secrets to trusted triggers.
- Pipelines that auto deploy on every merge need fast, trusted tests. Without them add a manual gate.
- A version bumped by hand in several files drifts. Derive it from one source.
- Smoke tests that only hit the health route pass while the main flow is broken.

## Output

- A diagram in words: trigger, build, gates, staging, approval, production.
- Workflow files created or edited and the dry run result.
- How to find what is deployed, and how to roll back.
