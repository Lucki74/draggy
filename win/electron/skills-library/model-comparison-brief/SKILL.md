---
name: model-comparison-brief
description: Writes a brief for choosing between AI models for a task, setting criteria, a test plan and a decision rule, and collecting current model facts, limits and prices from live provider docs instead of memory. Use when the user asks which model to use, wants to compare AI models for a task, or needs help choosing an LLM.
---

# Model comparison brief

## Goal

Pick a model for a job on evidence. The brief says what the job needs, which facts must come from live documentation, how candidates will be tested on the user's own cases, and what rule decides the winner.

## When to use

- A team must choose a model for a feature, an agent or a batch job.
- The user wonders if a cheaper or faster option is good enough.
- Before testing, build cases with `use_skill` with `prompt-eval-set`.
- For a fair head-to-head of prompts, use `use_skill` with `prompt-ab-test`.

## Steps

1. Ask with `ask_user` about the task, the volume, the latency the product can bear, the budget, privacy and data location needs, the languages and the tools or features required. Ask what a failure costs.
2. Write the requirements as must-have and nice-to-have. Examples: accepts the needed input type, supports tool calls, handles the context length needed, available in the user's region, meets the data policy.
3. Identify candidates with `search_web` and `read_url` on the providers' own pages. Do not name models, versions, prices or limits from memory. They change often, so read the current pages and record the page address and the date read for every fact.
4. Build a fact table: for each candidate, the features, stated limits, pricing model, availability and any deprecation notices, each with its source and date. Mark facts you could not confirm.
5. Design the test. Use the user's real or realistic cases, covering typical, hard and risky inputs. Fix the prompt, the settings and the scoring rubric, and run each candidate with the same inputs. Use `run_code` to script the runs if a key is available to the user. Never ask for or type keys yourself; the user supplies their own tooling.
6. Measure the things that matter: quality score on the rubric, failure types, response time, cost per task at the planned volume, and consistency across repeated runs.
7. Look at behaviours the benchmarks miss: refusing valid requests, following format rules, handling long inputs, hallucinating sources, and tool-calling reliability.
8. Set the decision rule before seeing results: for example, pick the cheapest candidate that reaches the quality bar on held-out cases and meets latency.
9. Write the brief with `create_file`: requirements, fact table with sources, test design, results and recommendation. State the date and say which facts need rechecking before launch.
10. Add an exit plan: how to swap the model later, what to retest, and how to watch for regression when the provider updates a model.

## Gotchas

- Public benchmark scores rarely match your task. Test on your cases.
- Price per token is not cost per task. Output length and retries change the total.
- Facts about models go out of date within weeks. Date every claim.
- A small test with a handful of cases hides variance. Repeat runs.
- Vendor claims are marketing until you test them.
- Check data handling terms for private data before sending any real text.

## Output

- The brief file path.
- The fact table with sources and dates.
- Test results and the decision rule applied.
- The recommendation and the items to recheck.
