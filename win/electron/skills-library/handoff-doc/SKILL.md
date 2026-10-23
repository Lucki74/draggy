---
name: handoff-doc
description: Writes a handoff document for work in progress so a successor can take over without asking the author, covering status, where things live, open threads, risks and who to contact. Use when the user is going on leave, changing roles, passing a project on, or asks for transition notes.
---

# Handoff doc

## Goal

A document the next owner can read in 15 minutes and then act on. It covers what exists, what is in flight, what is fragile and who to ask. A reader with no history should find the first thing to do.

## When to use

- The user is leaving, going on leave or moving to other work and must pass a project, role or area on.
- The user takes over something and wants the same document from the previous owner.
- For a one-off task given to someone, use `use_skill` with `delegation-brief`.
- For writing down a repeatable procedure, use `use_skill` with `process-documenter`.
- The user is the successor and wants to know which questions to ask the outgoing owner.

## Steps

1. Scope it. Ask with `ask_user` what is being handed over, to whom, the last working day, and whether the author can be reached after. The answer to the last question decides how much detail is needed.
2. Inventory what exists. Use `list_directory`, `search_files` and `read_file` on the project folder, notes and task lists the user points to. List each system, folder, account name (not passwords), dashboard and recurring task, with where it lives.
3. Write the status in a few lines: what is done, what is in flight and what is next, each with a date.
4. List open threads. For each: the person involved, what was promised, the last contact date and the next step. Check message history or notes rather than relying on memory.
5. Write recurring duties with schedule: what happens daily, weekly, monthly or yearly, and the consequence if missed.
6. Record decisions and their reasons, especially ones that look odd from outside. A one-line reason prevents someone reversing them by accident.
7. Name risks and fragile spots: things that break easily, deadlines close by, pending approvals, known bugs or complaints.
8. Add the people map: who does what, who has authority, who to ask about each area, and how each prefers contact.
9. Access: list which systems need access and who grants it. Never write secrets into the document. Point to the password manager or the admin.
10. Put a "first week" list at the top: three things the successor should do first. Read the document once as a stranger and fill gaps; ask the user about each gap with `ask_user`.
11. Save with `create_file` and note the date and author at the top.

## Gotchas

- Authors forget what is obvious to them. Walk through a normal week and list every touch point.
- Say where things are as well as what they are. "The Q3 budget" is useless without a path or link.
- Only listing successes hides the trouble spots. Include what is stuck and what you would fix.
- Passwords and keys do not belong in the document. Name the vault and the access owner.
- Links go stale. Open each with `read_url` or check the path with `read_file` when you can.
- The document ages fast. Put a date on it and say it reflects the state on that day.
- A handoff meeting beats a document alone. Suggest a 30-minute walkthrough and list its agenda.

## Output

A markdown document with sections: First week, Status, Open threads, Recurring duties, Decisions, Risks, People, Access, Where things live. Plain headings and short bullets. Mention in chat any gap you could not fill.
