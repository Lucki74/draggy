---
name: difficult-conversation-prep
description: Prepares the user for a tense workplace conversation by fixing the goal, the opening lines, the two or three key points, likely replies and a fallback. Use when the user says "I have to tell my boss something hard", "prepare me for a tough conversation" or "how do I give this feedback".
---

# Difficult conversation prep

## Goal

Walk into a hard talk with a clear aim, a first sentence that is ready and answers for the likely pushback. This is workplace communication prep. It is not counselling or mediation, and it does not diagnose anyone.

## When to use

- Giving critical feedback, asking for a raise, reporting a colleague's problem to a manager, ending a vendor deal, or telling a team about a change.
- The user is dreading a conversation and keeps rewriting an opening line.

For the written follow-up after the talk, use `status-update` or `use_skill` with `email-writer`. For a written apology, use `apology-message`. If the situation involves harassment, safety or a legal dispute, tell the user to bring in HR or a qualified professional and stop at logistics.

## Steps

1. **Get the situation.** Call `ask_user` for: who the other person is, the relationship, what happened, what the user wants afterward, and the date and setting. Ask for facts the user can observe, not guesses about motives.
2. **Define the outcome.** Write one sentence: "After this talk I want ___." Then ask for the minimum acceptable result and for what the user will do if it is not reached.
3. **Separate facts from stories.** List what happened as things a camera would record. Move interpretations ("he does not respect me") to a separate list and keep them out of the script.
4. **Write the opening.** Two sentences at most: state the topic and the intent, such as "I want to talk about the handover on Friday, and find a way to avoid a repeat." No small talk wind-up and no cushion that hides the point.
5. **Draft two or three key points.** Each is one specific example, its effect, and a request. Use "I" statements about impact.
6. **Predict responses.** Write the three likeliest replies (denial, counter-accusation, silence or emotion) and one short, calm line for each. Include what to do if the other person raises something valid.
7. **Plan the ask and the close.** Decide the exact request, the date for a check-in and who writes the summary afterward.
8. **Plan logistics.** Private place, enough time, no audience, a time that is not end of day. Suggest the user note the key facts on paper.
9. **Offer a rehearsal.** Offer to play the other person for the opening and one pushback, using chat turns. Keep it short.
10. **Prepare for silence and strong feeling.** Write one neutral line for each, such as "Take a moment, I am in no hurry" or "I can see this is hard to hear. Shall we continue?" Decide in advance when to pause the talk and resume later.
11. **Check the script for loaded words.** Remove labels like lazy, unprofessional or toxic. Replace each with the observable behavior.

## Gotchas

- A full script goes stale at the first interruption. Prepare the opening, the three points and the ask, then stay flexible.
- Leading with praise to soften the blow trains people to hear a "but" coming. Give the topic first.
- Words like "always" and "never" start a debate about frequency. Use one dated example.
- Asking for an outcome and assuming the other person agrees is the usual miss. Prepare what happens if they say no.
- Do not guess at the other person's mental state, health or intent. Stay with behavior and impact.
- Written notes after the meeting protect both sides. Plan a short recap message within a day.
- Rehearsing only the opening leaves the user with no plan for the middle. Prepare the response to the single hardest question.
- Having a third party present without telling the other person feels like an ambush. Say beforehand who will attend.
- Choosing the day before a holiday, a review or a deadline loads the talk with extra stress. Pick a calm slot.

## Output

A one-page prep sheet in plain text with these headings: Aim, Facts, Opening line, Key points, Likely replies, Ask, Logistics. Under 300 words. If the user wants to rehearse, say so in one line at the end.

If the user asks to rehearse, switch to short turns in chat and keep the sheet unchanged until they ask for a revision.
Keep the sheet to one page so the user can read it five minutes before the talk.
