---
name: blog-outline
description: Plans the structure of a blog post from the reader's question, with an angle, headings, the point of each section, sources to cite and a closing action, so the writer can draft without stalling. Use when the user asks for a blog outline, wants to structure an article, or has a topic but no plan for the post.
---

# Blog outline

## Goal

An outline a person can write from in one sitting. It has a clear promise to the reader, a reason this post differs from what exists, sections ordered to answer the question and a source for every claim that needs one.

## When to use

- The user has a topic or a target query and needs a post structure.
- The user stalls at the blank page or writes sprawling drafts.
- For the full draft of a post, use `use_skill` with `blog-post`.
- For a long technical article, use `use_skill` with `technical-blog`.
- For a brief meant for another writer, use `use_skill` with `seo-content-brief`.

## Steps

1. Ask with `ask_user` for the topic, the reader (who they are and what they know), the goal of the post (teach, persuade, rank, announce), the target length and the call to action. Read any notes with `read_file`.
2. State the reader's question in their words and the promise of the post in one sentence: "After reading, you can ...". Everything else must serve that promise.
3. Look at what exists. Search the topic with `search_web` and open two or three top results with `read_url`. Note what they cover, what they skip, what is outdated and what they get wrong.
4. Pick the angle: the unique thing this post offers, such as the user's experience, a worked example, current data, a clear decision rule or a counter-view. If the user has no edge, say so and choose depth or clarity as the edge.
5. Draft the title options (three) and the opening plan: the hook, why it matters now and what the reader will get. Do not write the intro itself.
6. Build the sections. Each gets an H2 stated as an answer or a promise, two to four bullet points of what it contains, the evidence or example it uses and a rough word count. Order by the reader's path: context, core answer, how to, pitfalls, next steps.
7. Mark sources. List facts that need citations and where each will come from. Do not invent statistics. If a number is wanted, find it with `search_web` and record its URL and date, or flag it as to be found.
8. Add the extras: a figure or table that would help, an example from the user's work, an FAQ block if readers ask follow-ups.
9. Plan the end: a short takeaway and one clear action (subscribe, try, read next). Add suggested internal links to related posts if the user lists them.
10. Test the outline: read only the H2s. They should tell the story. Cut sections that repeat or drift.

## Gotchas

- Copying the headings of the top results gives a post with nothing new. Build from the reader's questions and your own angle.
- Outlines with only topic labels ("Benefits", "Tips") hide the lack of content. State what each section will say.
- Too many sections make a shallow post. Fewer, deeper sections rank and read better.
- A post without an example reads as generic. Plan at least one concrete case.
- Facts from memory go stale. Verify and date anything that changes.
- Do not stuff the headings with keywords. Write for the reader.
- An outline that never names the reader invites a post for everyone. Write down who it is for before the sections.

## Output

Title options, the promise line, the angle, the section list (H2, points, evidence, word count), sources to fill, extras, the ending and internal links. About one page.
