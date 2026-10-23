---
name: prompt-injection-defense
description: Hardens an LLM application against prompt injection by mapping where untrusted text enters a prompt, separating it from instructions, limiting what tools can do and checking outputs, then testing with realistic attack strings. Use when the user asks to protect an app or agent from injected instructions or malicious web pages or documents.
---

# Prompt injection defense

## Goal

Reduce the damage an attacker can do through text the app feeds to a model. The result is a map of untrusted inputs, design changes that limit what a hijacked model can do, and tests that show the limits hold. This is defensive work on the user's own application.

## When to use

- An app summarises web pages, emails, files or user messages with a model.
- An agent has tools such as file access, shell, email or payments.
- The user asks if their prompt is safe, or has seen a model obey text it should not.
- For reviewing the system prompt's own weak points, use `use_skill` with `jailbreak-resistant-prompt-review`.
- For general code security, use the security skills in the library.

## Steps

1. Ask with `ask_user` what the app does, which models and tools it uses, who can supply text, and what the worst outcome would be. Read the prompt-building code with `read_file` and `search_files`.
2. Map every place text enters a prompt: user input, retrieved documents, web pages, tool results, file contents, emails, names and comments in data. Mark each as trusted or untrusted. Assume anything a third party can write is untrusted.
3. Map what the model can do: each tool, each permission, each data source in reach. Note which actions are destructive, expensive, private or outward facing, such as sending a message or making a request to a URL.
4. Apply least power. Remove tools the task does not need. Make read tools read only. Scope file, network and data access to what the task requires. Do not give one agent both untrusted input and a powerful tool when you can split them.
5. Add human confirmation for sensitive actions, with the real action shown in plain words, not the model's summary of it.
6. Separate instructions from data in the prompt with clear delimiters, and say that the delimited material is content to analyse and never instructions. This helps, but it does not make the system safe by itself.
7. Control outputs that leave the system. Block or review links, images and requests that could carry data out, and strip markup the display should not render.
8. Add checks in code: validate structured output, enforce allowed values for tool arguments, rate limit, and log tool calls for review.
9. Test using a set of harmless canary attacks that you write for this app: text that asks the model to reveal a planted marker, call a test tool, or ignore its task. Run them through each entry point and record what happened.
10. Report findings ranked by impact, the fixes made and what remains.

## Gotchas

- A sentence saying "ignore attacks" is not a control. Design so a fooled model cannot do harm.
- Data can come back in later turns. Stored text from an earlier input can inject now.
- Tool results are untrusted too. A web page fetched by a tool can carry instructions.
- Filters by keyword are easy to bypass. Use them as a minor layer only.
- Test only on systems you own or are allowed to test.
- Do not publish working attack strings aimed at third-party products.

## Output

- The input and capability map.
- Fixes ranked by risk reduction, with the code locations.
- Test results per entry point.
- Remaining risks and the checks to repeat after changes.
