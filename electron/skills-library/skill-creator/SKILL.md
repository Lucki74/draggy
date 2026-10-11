---
name: skill-creator
description: "Helps the user write a new skill in the SKILL.md format: a precise name and trigger description, clear step-by-step instructions, examples and optional bundled files, saved where Draggy will find it. Use when the user wants to create, improve or test a skill, or teach Draggy how they like a job done."
---

# Skill creator

A skill is a folder containing SKILL.md: front matter with a name and a description, then Markdown instructions. Draggy lists only names and descriptions to the model, and loads the instructions when a request matches, or when the user types / and the skill's name. Other files in the folder (templates, examples, reference notes) can be read on demand.

## 1. Understand the job

Ask the user, briefly, if not already clear:
- What job the skill covers, and two or three example requests that should trigger it.
- What a great result looks like: format, tone, length, must-include items. An example of a past result they liked is ideal.
- Rules and pitfalls: what the model tends to get wrong without the skill.
- Whether it is for Chat, Code or both, and whether it needs tools (web, files, commands).

## 2. Write the front matter

- **name:** lowercase letters, digits and hyphens, up to 64 characters, and the same as the folder name: `weekly-report`.
- **description:** up to 1024 characters, written in the third person, saying both what the skill does and when to use it, with the words users are likely to type. This is the only part the model sees when choosing, so be specific: "Writes the Friday status report for the platform team from Jira exports, in the team's four-section format. Use when the user asks for the weekly report or status update." beats "Helps with reports."
- Optional: `disable-model-invocation: true` if the skill should only run when the user types its slash command.

## 3. Write the instructions

- Start with the goal in one or two lines.
- Then numbered steps the model can follow, in order, naming the Draggy tools involved when relevant (search_web, read_url, create_file, search_library in Chat; read_file, edit_file, write_file, run_command, git_diff, update_plan in Code).
- The exact output format, with a short example.
- Rules and pitfalls as a short list.
- Keep SKILL.md under about 500 lines. Move long reference material, templates or examples into separate files and mention them by name, so they are read only when needed.
- Write for a capable model with no context: no "as discussed", and define internal terms.

Use template.md (use_skill with file "template.md") as a starting point.

## 4. Save it

- **In Code**, for a skill that belongs to this project: write it with write_file to `.draggy/skills/<name>/SKILL.md`, plus any extra files in the same folder. It will be offered in this project only.
- **For all chats and projects:** the skill must go in Draggy's own skills folder. In Chat, create the SKILL.md with create_file, then tell the user to open Settings, Extensions, Skills, choose Open folder, create a folder named exactly like the skill, and move SKILL.md into it.

After saving, the skill appears in Settings, Extensions, Skills, switched on.

## 5. Test it

Suggest two or three test requests: one that should trigger it, one borderline, one that should not. If the model picks it at the wrong times, sharpen the description; if results are off, sharpen the steps or add an example.
