---
name: system-prompt-designer
description: Designs a system prompt for an assistant, covering its role, scope, rules with reasons, tone, tool use and what to do when it cannot help, then tests it against sample conversations and fixes the gaps. Use when the user asks for a system prompt, bot instructions or the setup text for an assistant.
---

# System prompt designer

## Goal

Write the standing instructions for an assistant so it behaves the same way across many users and conversations. The prompt is short enough to maintain, explains its rules, and has been tried on realistic inputs including awkward ones.

## When to use

- The user is building a chatbot, support assistant, tutor or internal helper.
- An existing system prompt has grown long and contradictory.
- For rewriting a single one-off prompt, use `use_skill` with `prompt-rewriter`.
- For instructions to a tool-using coding agent, use `use_skill` with `agent-instructions-writer`.
- For giving the assistant a distinct voice, use `use_skill` with `persona-prompt`.

## Steps

1. Ask with `ask_user` who the users are, what the assistant should do and must not do, which tools or data it can reach, where it runs, and what a good answer and a bad answer look like. Ask for five real or realistic user messages.
2. Check the target platform's current docs with `read_url` for how system prompts are supplied and any limits. Do not state model names, limits or features from memory.
3. Draft the sections in this order: role and purpose in two sentences; the audience; scope (what is in and out); how to answer (length, format, tone); how to use tools or documents and when to ask for clarification; what to do when the answer is unknown or outside scope; and safety or policy limits.
4. Write each rule with its reason in a clause: "Keep answers under ten lines because users read on phones." Reasons let the model handle cases the rule did not foresee.
5. Prefer positive instructions ("answer in plain text") over lists of prohibitions. Keep prohibitions for real limits and explain them.
6. Add one or two short example exchanges for the hardest behaviours, such as declining politely or asking a clarifying question. Keep them different from each other.
7. Remove conflicts. Read the draft once as the model: which two rules could clash? Give a priority order for those.
8. Test by walking the five sample messages and three hard ones through the prompt: an out-of-scope request, a vague request and a user pushing the assistant to ignore its rules. Run them against a model if one is available. Record failures.
9. Revise, then save with `create_file`. Add a short maintenance note: owner, date, and what to retest when the prompt changes.

## Gotchas

- Every added rule can conflict with an old one. Prune as you add.
- Prompts that restate general good behaviour spend attention for nothing.
- Secrets, keys and private data do not belong in a system prompt. Assume users can extract its text.
- A prompt cannot enforce security alone. Pair it with limits in code. See `use_skill` with `prompt-injection-defense`.
- Do not test only the friendly cases.
- Version the prompt. Without history you cannot tell what caused a regression.

## Output

- The system prompt, ready to paste.
- The test conversations and results.
- Known weak spots and the code-side limits they need.
- The maintenance note.
