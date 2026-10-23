---
name: design-doc
description: Writes a technical design document covering goals, architecture, data model, interfaces, alternatives, rollout and risks, grounded in the existing codebase. Use when the user asks for a design doc, technical design, architecture write-up or RFC for a system or large change.
---

# Technical design document

## Goal

Explain how a change will be built so that reviewers can find flaws before code exists. It is grounded in the real codebase, compares at least one real alternative, and says how the change reaches users safely. What the product does belongs in `spec-writing`; this is how it is built.

## When to use

- A change spans several components, or alters data, APIs or deployment.
- A reviewer or team needs to agree on an approach before work starts.
- The user says "design doc", "technical design", "write up the architecture", "RFC".
- Only one decision needs recording: use `adr-writer`.
- A spec is missing and requirements are unclear: write it first with `spec-writing`.

## Steps

1. Gather inputs: the spec or request with `read_file`, any earlier decisions, and the constraints the user names. Ask `ask_user` for missing goals, scale expectations they care about, and the review audience.
2. Study the current system. Use `explore`, `search_files` and `read_file` to find the modules, data stores, entry points and conventions the change touches. Write a short "current state" section from what you saw, with file paths.
3. State goals and non-goals in a few lines each, and any measurable target the user gave. Do not invent numbers.
4. Describe the proposed design at the right level: components and their responsibilities, how data flows between them, and where the new code lives. Add a simple diagram as text or a mermaid block when it clarifies flow.
5. Specify the data: new or changed tables, fields, file formats, and how existing data moves to the new shape. Include ownership of each piece of state.
6. Specify interfaces: function signatures, endpoints, events or messages, with inputs, outputs and error cases. Keep to what other components depend on.
7. Cover the cross-cutting concerns that apply: failure modes and recovery, concurrency, security and permissions, performance, observability, testing strategy. Skip the ones that do not apply and say so.
8. Write the alternatives. Describe each fairly in its best form, and give the concrete reason it lost. Verify claims about third-party tools with `read_url` rather than memory.
9. Write the rollout: order of changes, feature flags, migration steps, how to roll back, and what is monitored after release. Link to a plan from `writing-plans` if one exists.
10. List open questions and risks. Save with `create_file` in the docs folder using the project's naming. Re-read as a reviewer who has not seen the code.

## Gotchas

- An architecture picture with no data model or interfaces hides the hard parts. Reviewers find bugs in the contracts, so spell them out.
- Strawman alternatives ("do nothing, which is bad") convince nobody. Give the runner-up its best case.
- A doc with no current-state section describes a design for a codebase that does not exist. Anchor it in real paths.
- Leaving out rollout and rollback. Many outages come from the migration, not the final design.
- Treating the doc as final. State what is undecided and who decides, so review has a target.
- Length for its own sake. Cover what a reviewer needs to judge the design, and stop.

## Output

A markdown file with: Summary, Context and current state, Goals and non-goals, Proposed design, Data, Interfaces, Cross-cutting concerns, Alternatives, Rollout, Risks, Open questions. In chat, give the path, a three-line summary and the questions needing an answer.
