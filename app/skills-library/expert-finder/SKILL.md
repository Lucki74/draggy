---
name: expert-finder
description: Identifies people with real standing on a narrow topic, such as researchers, practitioners and authors, and backs each name with public evidence of their work. Use when the user asks who the experts on a subject are, who to interview, who to cite, or who could review their work.
---

# Expert finder

## Goal

Return a short list of credible people for a specific topic, each with proof of why they qualify and what they are best placed to speak on. The list helps the user choose whom to read, cite or contact.

## When to use

- The user needs an interviewee, a reviewer, a speaker or an authority to cite.
- The user wants to know who leads the work in a niche.
- For background on one named person before meeting them, use `use_skill` with `interview-prep-research`. For judging a single source, use `source-evaluation`.

## Steps

1. **Narrow the topic.** Rewrite it as a specific question or subfield. "AI" is too wide, "evaluation of retrieval systems" is workable. Use `ask_user` for the purpose: to cite, to interview or to hire.
2. **Search publications.** Use `search_web` for academic and trade publications on the subtopic. Note authors who appear repeatedly, especially as first or corresponding author.
3. **Search practice.** Look for conference talks, standards bodies, official documentation, books and maintainers of the main tools or programmes.
4. **Open the evidence.** Use `read_url` on each candidate's institutional or professional page. Record role, organisation and two concrete works with years.
5. **Test fit.** Check the works are about the subtopic, not the wider field. Prefer work from the last five years unless the topic is historical.
6. **Check standing.** Look for peer recognition: invited talks, panel roles, review work, citations by other experts. Note any conflicts of interest, such as vendor ties.
7. **Check balance.** Make sure the list is not all one lab, one company or one viewpoint. Add at least one person who disagrees with the common view.
8. **Find the public channel.** Record only an official public route: institutional page, published contact for media or speaking. Do not hunt for private addresses.
9. **Match to the need.** For each person note what you would ask them, so a theorist is not proposed for a hands-on question.
10. **Record the gaps.** If the list lacks a region, gender mix or career stage the user cares about, say so and search again for it.

## Gotchas

- Fame is not expertise. The most quoted person is often a generalist. Look for the person who did the work.
- Name clashes are common. Check the affiliation and the field before attributing a paper.
- A job title can be self-assigned. A published body of work or a verified role is stronger.
- Do not list private emails, phone numbers or home details, even if a search shows them.
- Experts retire, move or change employers. Date your list and check the current affiliation.
- A paid consultant may be an expert and also an advocate. Disclose the tie if you find one.
- Social media follower counts say reach. They do not say whether the person has done the work.
- A famous senior researcher may not answer. A junior author of the key paper is often the better contact.
- Honorary titles and "advisor" roles on company sites are weak evidence. Look for the work itself.

## Output

Five to eight entries, each with name, role and organisation, two or three lines of evidence with links, the exact area they suit, any conflict noted and the public contact route. Add one line on how the list was built.
