---
name: mind-map-outline
description: Turns a topic, a text or a pile of ideas into a branching outline with a central idea, a few main branches, short node labels and marked cross links, in a format a mind map tool can import or the user can draw. Use when the user asks for a mind map, wants ideas organised visually, or wants a topic laid out as branches.
---

# Mind map outline

## Goal

Give the user a clean map of a subject: one centre, three to seven main branches, short labels, and the links between branches that show how the ideas connect. The result is ready to paste into a mind map tool or sketch by hand.

## When to use

- The user has a topic, chapter or brainstorm and wants the structure to see.
- The user wants to plan an essay, talk or study session from a map.
- The user wants relationships between named concepts spelled out as statements: use `use_skill` with `explain-concept`.
- The user wants a revision page: use `cheat-sheet-maker`.

## Steps

1. **Get the subject and use.** Use `ask_user` for the topic or file, the purpose (study, planning, brainstorm) and the tool they will use, if any. Read files with `read_file`.
2. **Write the centre.** One short phrase or a question. A question centre such as "why did the market crash" gives a sharper map than a bare topic.
3. **Find the main branches.** Sort the material into three to seven groups. Name each with a noun or a short phrase. If you have more than seven, merge or move some under others.
4. **Fill the second level.** Under each branch, add two to five nodes. Use keywords, not sentences, and keep each under about five words.
5. **Add the third level sparingly.** Only where a node needs a concrete example, number or term. Stop at three levels. Deeper material becomes its own map.
6. **Mark cross links.** List pairs of nodes in different branches that influence or contradict each other, with a three-word label on each link ("causes", "conflicts with").
7. **Choose the format.** Indented Markdown list suits most tools. Use `create_file` for a `.md` or `.opml`-style outline if the tool needs it. For a drawing, give branch order clockwise from the top right.
8. **Check balance.** No branch should hold more than half of the nodes. If one does, split it.
9. **Verify against the source.** Every node traces to the text or the user's ideas. Remove anything you added from outside, or mark it.
10. **Ask for changes.** Invite the user to move or rename branches and update the outline.
11. **Add a reading path.** Suggest which branch to study first and which depends on others.

## Gotchas

- Sentences in nodes turn the map into a document. Keep keywords and put the sentences in notes.
- Too many top branches make the map a list with extra steps. Seven is a ceiling.
- Cross links are where the value is. A map with none is only an outline.
- Branch order carries no meaning unless you say it does. If order matters (a sequence), use a numbered outline instead.
- Do not invent categories to look complete. Leave a gap and flag it as a question.
- Colours and icons are tool details. Offer them last, if at all.
- Making the map for someone is half the value lost. Invite the user to redraw it from memory next day.

## Output

The outline in an indented list, then the cross links as a short list. Mention the file path if one was saved. No commentary beyond one line on how to use it.
