---
name: complexity-hotspots
description: Ranks files and functions by complexity combined with how often they change, to show where refactoring or extra review pays off first. Use when the user asks where the most complex code is, to find hotspots, or what to refactor first.
---

# Complexity hotspots

## Goal

Find the small set of places where hard-to-read code meets frequent change, since that is where bugs and slow work concentrate. The result is a ranked shortlist with the reason each entry hurts, not a score dump.

## When to use

- The user wants to know where to start refactoring or where bugs are likely.
- A team plans a cleanup sprint and needs a defensible order.
- To record the findings as managed debt, use `use_skill` with `tech-debt-ledger`.
- To actually restructure a chosen function, use `use_skill` with `refactor`.
- A manager asks where bugs come from and the answer should rest on repository history.
- A new maintainer needs a map of the risky parts of an unfamiliar repo.

## Steps

1. Set the scope with `list_directory`: source folders only. Exclude generated code, vendored code, build output, fixtures and lockfiles.
2. Measure churn with `run_command`: `git log --since="12 months ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -40`. If the repo has no history, say so and rank on complexity alone.
3. Measure complexity. Use a tool if the project has one (eslint `complexity` rule, radon, gocyclo, scc). Otherwise approximate with `run_command`: count lines per function, nesting depth and branch keywords for the top churned files.
4. Cross the two lists. A file high on both is a hotspot. High complexity with no churn is stable and usually safe to leave. High churn with low complexity is just active.
5. Read the top five with `read_file`. For each, name what makes it hard: long function, deep nesting, mixed responsibilities, many parameters, hidden global state, repeated near copies.
6. Check test coverage of each hotspot with `search_files` for its tests, or the project's coverage command. Low coverage plus high churn moves it up the list.
7. Propose one concrete first move per hotspot, such as extract this block, split this file by responsibility, or add characterisation tests.
8. Check ownership with `git log --format=%an` on each hotspot via `run_command`. A hotspot touched by one person is a bus-factor risk as well as a code risk.
9. Re-run the measurement for the top three after any refactor, to show whether the score moved. A change with no movement was not worth the churn.
10. Write the findings into the answer with the commands used, then ask the user with `ask_user` which hotspot to pursue, rather than starting a refactor unprompted.

## Gotchas

- Lines of code measures size, not difficulty. A long flat switch can be easier than a short tangled function.
- Churn from bulk renames, formatting passes or dependency bumps inflates a file's count. Skim the log for those commits.
- Generated files, migrations and translation tables top every list. Exclude them before ranking.
- A file churned by many authors may be a shared registry that grows by design, not a design flaw.
- Do not present a metric as the finding. The reader needs the reason in words.
- Very recent files have little history. Do not read low churn as stability for code that is two weeks old.
- Small teams see noisy churn. With under a dozen commits per file, treat the ranking as a prompt for a conversation, not a result.

## Output

- A ranked table of at most ten entries: location, complexity signal, churn, test coverage, what makes it hard.
- One recommended first move per entry.
- The method and period used, so the ranking can be repeated.
- The exact commands used, so the ranking can be rerun next quarter.
- Files excluded and why, so nobody asks about them later.
