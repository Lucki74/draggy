---
name: branch-strategy
description: Picks a branching and merge model that fits the team size and release rhythm, then writes the rules down as a short document with branch names, protection settings and merge method. Use when the user asks what branching strategy to use, how to set up trunk-based development or gitflow, or how branches should be named.
---

# Branch strategy

## Goal

Leave the team with one branching model they can follow without asking anyone. A good result names the long-lived branches (ideally one), says how short-lived branches are named and how long they may live, fixes the merge method, and lists the protection rules to switch on.

## When to use

- A new repo or team needs a branching model.
- Merges are painful and the user suspects the model is the cause.
- The user asks about trunk-based development, gitflow, release branches or naming rules.
- For one pull request that is too big, use `use_skill` with `stacked-prs`.
- For tagging a release once the model is in place, use `use_skill` with `release-tagging`.

## Steps

1. Inspect what exists. Run `git branch -a` and `git log --oneline --graph -n 40` with `run_command`. Note the default branch, the number of long-lived branches, and whether history is mostly merge commits or linear.
2. Read the signals of how the team ships: `read_file` on the CI config, any CONTRIBUTING.md, and the release scripts. Find out whether production deploys from a branch, a tag or a pipeline click.
3. Ask only what the files cannot tell you, with `ask_user`: team size, how many versions are supported at once, whether there is a review requirement, and how often it releases.
4. Choose a model with a reason tied to those answers:
   - One deployable version, frequent releases: trunk-based. Short branches off the default branch, merged within a day or two, unfinished work hidden behind a flag.
   - Several supported versions at once: trunk plus a release branch per supported version, with fixes landing on trunk first and cherry-picked back.
   - Scheduled releases with a long stabilisation phase: a develop branch and release branches can be justified, but say what it costs.
5. Decide the merge method. Squash gives one commit per pull request and a readable first-parent history. Rebase-and-merge keeps each commit and needs clean commits. A merge commit keeps the branch shape. Pick one and say why.
6. Write the naming rule with a short prefix list (`feature/`, `fix/`, `chore/` or the team's own) plus an optional ticket id. Give two real examples from the repo's current work.
7. List the settings to apply on the host: protected default branch, required review count, required status checks, linear history if you chose squash or rebase, branch deletion on merge. These are host settings, so tell the user where to set them. Check the host's current docs with `read_url` if you give exact menu names.
8. Write the result with `create_file` as a short section for CONTRIBUTING.md or docs/branching.md. Keep it under one page.

## Gotchas

- Gitflow is the default answer people reach for, yet it fits scheduled releases and several supported versions. For a web service deployed many times a week it adds a develop branch that only delays integration.
- A rule without enforcement decays. If the branch name format matters, say how it is checked (a hook or a CI step) or drop the rule.
- Changing the model on a repo with open branches strands them. Plan the cut-over: merge or close open branches first, then switch the default.
- Squash merging hides individual commits, so a branch that mixes unrelated changes loses the chance to revert one part. The model must say pull requests stay single-purpose.
- Renaming the default branch breaks CI filters, deploy scripts and local clones. List each place before suggesting it.
- Trunk-based without a way to hide unfinished work (flags, dark launches) forces long branches back in through the side door.

## Output

- One recommended model in two or three sentences, with the reason tied to what you found in the repo.
- The rules as a short list: branches, naming, merge method, protection settings.
- The file you wrote, if any, and the host settings the user must change by hand.
- Any open question you could not settle from the repo.
- A migration note if branches already exist: which to merge, which to close, and in what order.
- No generic essay on branching theory. The user needs rules for this repo.
- If two models fit equally well, name the cheaper one to adopt and say what would make you switch.
