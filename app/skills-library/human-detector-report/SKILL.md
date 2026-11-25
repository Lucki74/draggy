---
name: human-detector-report
description: Measures a text with the bundled metrics script and reports where it looks machine-written, without changing it. Use when the user wants a score, an audit or a before and after comparison instead of a rewrite.
---

# Human detector report

## Goal

Report measured structure and the patterns that read as machine text, and nothing else. The text stays untouched.

## When to use

- The user asks how AI-like a text is, or what a detector would pick up.
- The user wants numbers before deciding whether to rewrite.
- The user has a detector score and wants it explained.

## Steps

1. Read `metrics.cjs` in the `human` skill and run it with `run_command`, text inside a template literal above the script. If a voice profile or a sample exists, run it on that too.
2. Report the metrics as a short table: value, the sample value if there is one, and which direction reads more machine-like.
3. List the tell phrases and structural habits found in the text, each with a quote. Use the catalogue in `tells.md` of the `human` skill.
4. State the limits: heuristics, short texts are noisy, and no detector's result can be predicted from these numbers.
5. Offer a rewrite with the `human` skill only if the user wants one.

## Gotchas

- Never state a probability that a detector will flag the text. The metrics do not give one.
- Under 100 words the numbers are close to meaningless. Say so.
- A formal human text also scores machine-like. Compare with the user's own sample when it exists.

## Output

A table of measured values, a list of quoted patterns, one line of limits. No rewritten text.
