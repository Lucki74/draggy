---
name: argument-strengthener
description: Tests an argument by stating its claim, premises and hidden assumptions, finds the weakest link and the strongest objection, and repairs the case with real evidence or a narrower claim. Use when the user asks if an argument is convincing, wants holes found in an essay, or wants a case strengthened.
---

# Argument strengthener

## Goal

A claim that survives a smart sceptic. A good result states what is being argued, shows which premises carry the weight, names the best objection fairly, and either fixes the gap with sourced evidence or shrinks the claim to what the evidence supports.

## When to use

- An essay, proposal, opinion piece or pitch needs to persuade.
- The user suspects a hole and cannot find it.
- Before a debate, review or decision meeting.
- For fixing sentence-level clarity, use `use_skill` with `clarity-edit`.
- For a structured outline of the case, use `use_skill` with `outline-builder`.

## Steps

1. Read the text with `read_file`. Write the main claim in one sentence, in the author's terms. If the text makes several claims, list them and pick the one the rest depend on.
2. Lay out the argument: the premises given, the evidence for each, and the step from premises to claim. Add the premises the author assumed without saying. These hidden assumptions are where most arguments fail.
3. Rate each link: supported by evidence, supported by authority, supported by plausibility only, or unsupported. Note which premises, if false, would sink the claim.
4. State the strongest objection, in a form its holder would accept, not a weakened version. Try also the common failure modes: correlation read as cause, a sample that does not represent, a comparison with no baseline, a false choice between two options, and a conclusion larger than the premises.
5. Decide for each weakness what repairs it. Options: add a piece of evidence, an example, or a source; answer the objection in the text; narrow the claim; or concede the point and move the argument.
6. Look for evidence with `search_web` and `read_url`. Check what a source says before relying on it, and record its title, author, date and what it supports. If nothing good turns up, say so. Do not invent a source or a figure.
7. Rewrite only the passages that change, with `edit_file` when the text is in a file, or show them in chat. Keep the author's position unless the user agrees to change it.
8. Remove hedging that is there out of fear, and keep hedges that match the evidence. A claim that says "may" where the data says "does" is weaker than needed; one that says "does" where the data says "may" is wrong.
9. Re-read the repaired text as the sceptic and check the objection is answered.
10. Rank the repairs by effect: fix the premise that carries the most weight first, then the rest.
11. Tell the user which problems remain unsolved and what evidence would settle them.

## Gotchas

- Fake evidence is the worst repair. A plausible statistic that does not exist ruins the author when checked.
- Attacking a weaker version of the claim, or the author's worst example, feels productive and proves nothing.
- Piling on hedges until nothing is claimed makes the piece safe and useless. Aim for a smaller claim, said plainly.
- Authors read their own premises as obvious. Test the ones that readers outside the author's circle would not accept.
- A source that agrees on a headline may disagree in its details. Read the part that matters.
- Strengthening an argument does not mean making it right. If the claim is false on the evidence, say that.
- Appeals to authority count only when the authority has expertise in this exact question. Check that the person is qualified here.
- Examples prove nothing alone. One vivid case should illustrate a pattern shown by other means.
- Emotional force is a legitimate tool when it points at a real fact, and a weak one when it replaces the fact.
- Definitions carry arguments. If the key term is used in two senses, fix its meaning at the start.
- A strong reply to an objection may require conceding part of it. Do that openly.

## Output

- The claim and the argument map in a few lines.
- The weakest links ranked, each with the repair chosen.
- The strongest objection with a reply, ready to insert.
- Sources found, with what each supports and how reliable it is, plus gaps with no support.
