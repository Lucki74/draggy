---
name: skill-creator
description: Helps the user write a new Draggy skill in the SKILL.md contract: a precise name and trigger description, Goal, When to use, Steps, Gotchas and Output sections, optional bundled files, saved where Draggy will find it. Use when the user wants to create, improve or test a skill, or teach Draggy how they like a job done.
---

# Skill creator

## Goal

Turn a job the user does repeatedly into a skill Draggy loads at the right moment and follows correctly. A skill is a folder holding SKILL.md, a front matter block with a name and a description, then Markdown instructions. Draggy shows only names and descriptions to the model, and loads the instructions when a request matches or when the user types / and the skill's name. Other files in the folder (templates, examples, reference notes) are read on demand. The [template](template.md) is the starting point.

## When to use

- The user wants to create, improve or test a skill.
- The user wants to teach Draggy how they like a recurring job done.

## Steps

1. Understand the job. Ask briefly for what is not clear:
   - What the skill covers, and two or three example requests that should trigger it.
   - What a great result looks like: format, tone, length, must-include items. A past result they liked is ideal.
   - What the model tends to get wrong without the skill.
   - Whether it is for Chat, Code or both, and what tools it needs.
2. Write the front matter. It has two keys only:
   - `name`: lowercase letters, digits and hyphens, up to 64 characters, equal to the folder name, for example `weekly-report`.
   - `description`: under 1,024 characters, in the third person. Say what the skill does, then "Use when ..." with phrases a person would type. It is the only part the model sees when choosing, so be specific. "Writes the Friday status report for the platform team from Jira exports, in the team's four-section format. Use when the user asks for the weekly report or status update." beats "Helps with reports."
3. Write the body with a `# Title` line, then these `##` sections in this order:
   - Goal: one short paragraph on the outcome and what a good result looks like.
   - When to use: situations that call for the skill, one line each, naming near misses that belong to another skill and which one.
   - Steps: numbered, concrete and checkable. Name tools in backticks, using only Draggy tools such as `read_file`, `search_files`, `list_directory`, `run_command`, `search_web`, `read_url`, `explore`, `use_skill`, `create_file`, `write_file`, `edit_file`, `git_diff` and `update_plan`.
   - Gotchas: three to six real failure modes of this task, from experience, with no filler.
   - Output: what the answer looks like, including format, length and where a file goes.
4. Write for a capable model with no context. Avoid "as discussed" and define internal terms. Use plain verbs and concrete wording.
5. Keep SKILL.md under 500 lines. Move long reference material, templates or examples into separate files one folder level deep, and link them by relative path. The model reads them with `use_skill` and the file name.
6. Read [template.md](template.md) with `use_skill` and file "template.md" as a starting point.
7. Save it.
   - In Code, for a skill that belongs to this project, write it with `write_file` to `.draggy/skills/<name>/SKILL.md`, plus any extra files in the same folder. It is offered in this project only.
   - For all chats and projects, the skill must live in Draggy's own skills folder. In Chat, create SKILL.md with `create_file`, then tell the user to open Settings, Extensions, Skills, choose Open folder, create a folder named exactly like the skill, and move SKILL.md into it.
   - After saving, the skill appears in Settings, Extensions, Skills, switched on.
8. Test it with two or three requests: one that should trigger it, one borderline, one that should not. If it is picked at the wrong times, sharpen the description. If results are off, sharpen the steps or add an example.

## Gotchas

- A vague description is the main reason a skill never fires or fires at the wrong time. Include the words users type.
- The folder name and the `name` value must match exactly, or Draggy will not find the skill.
- Extra front matter keys are not part of the contract. Keep to `name` and `description`.
- Tool names the model does not have (another harness's Read or Bash, for example) make a step impossible to follow. Use Draggy tool names.
- A Gotchas section padded with generic advice defeats its purpose. Write only failures you know happen.

## Output

The finished SKILL.md and any bundled files, saved where Draggy will find them. Tell the user the path or the manual steps to install it, and suggest the test requests from step 8.
