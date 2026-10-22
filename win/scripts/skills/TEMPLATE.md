---
name: skill-id
description: One or two sentences on what the skill does, then "Use when the user asks for ..." with the phrases a person would actually type. 1,024 characters at most.
---

# Skill title

## Goal

One short paragraph: the outcome the user wants and what a good result looks like.

## When to use

- The situations that call for this skill, one line each.
- Name the near misses that belong to another skill and say which one.

## Steps

1. Gather: what to read or ask first. Use only draggy tools: `read_file`, `search_files`, `list_directory`, `run_command`, `search_web`, `read_url`, `explore`, `use_skill`.
2. Do the work. Keep each step concrete and checkable.
3. Verify against the Goal before answering.

## Gotchas

- The non-obvious failure modes. This section is why the skill exists. Three to six lines, no filler.

## Output

What the answer looks like: format, length, where a file goes (`create_file`), what is left unsaid.
