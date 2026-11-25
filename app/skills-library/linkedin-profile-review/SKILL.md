---
name: linkedin-profile-review
description: Reviews a professional profile section by section against the user's goal and suggests specific rewrites that stay true to their record. Use when the user asks for a LinkedIn profile review, wants a better headline or about section, or asks if their profile is good enough.
---

# LinkedIn profile review

## Goal

Make the user's professional profile clear to the reader they want: a recruiter, a client or a peer. The skill checks that the profile says who the user is, what they do and what they want, and that every line is true and provable.

## When to use

- The user pastes profile text or shares a page for feedback.
- The user is changing direction and wants the profile to follow.
- A resume for a specific posting is `use_skill` with `resume-tailor`.

## Steps

1. Ask with `ask_user` for the goal: the type of role or client, the industry and the location. Ask who should find this profile.
2. Read the text from `read_file` or the user's paste. If the user gives a public link, use `read_url`, and tell the user if the page needs a sign-in and cannot be read.
3. Review the headline: does it say what the user does and for whom in the words a searcher would type? Offer three rewrites in different styles.
4. Review the about section: the first two lines show before the fold, so check that they carry the point. Look for a clear statement of what the user does, a proof point or two, and a pointer to what they want next.
5. Review each experience entry: results and scope over duties, consistent dates, and titles that match what the user really did.
6. Review skills, projects and education for relevance. Suggest the order, and flag skills the user would not want to be tested on.
7. Check consistency with the user's resume: dates, titles and claims should match.
8. Look at the photo, the banner and the contact settings only as questions to the user, since you cannot see them unless pasted.
9. List the five changes with the most effect, in order, with the exact new wording for each.
10. Ask the user to confirm that each rewritten claim is accurate before they use it.
11. Suggest a short plan for keeping the profile current, such as a review each quarter and after each big project.
12. Ask the user to compare the result with three profiles of people in the target role and note what they do differently.

## Gotchas

- Headlines such as passionate professional that describe no work.
- Claims the user cannot support in a conversation.
- Stuffing every keyword into the about section until it reads as a list.
- Rewriting into marketing language that does not sound like the person.
- Dates and titles that differ from the resume, which recruiters notice.
- Exposing details the user prefers to keep private, such as a current employer while searching quietly. Ask about visibility settings.
- Copying the resume line for line when the profile can use a more personal voice.
- Chasing connection counts instead of the readers the user wants.

## Output

A section-by-section review with the current text, the problem, a rewrite and the reason, then the top five changes. Do not apply anything to the live profile.
