---
name: review-feedback-response
description: Works through reviewer comments on a pull request or patch, one at a time, applying the valid ones, pushing back with evidence on the others, and writing a reply per comment. Use when the user pastes review comments, asks to address review feedback, or says a reviewer requested changes.
---

# Review feedback response

## Goal

Every comment gets a decision (apply, adjust, decline with reason, or ask) and a reply the reviewer can check. The branch ends with the changes made, tests passing and no comment left unanswered.

## When to use

- The user pastes reviewer comments or points to a PR with requested changes.
- A reviewer's suggestion looks wrong and the user wants help deciding.
- To review code from scratch, use `use_skill` with `code-review`.
- To check your own diff before review, use `use_skill` with `pr-self-review`.
- A comment thread is stale after a rebase and the user needs to know which comments still apply.

## Steps

1. Collect the comments into a numbered list with file, line and text. If they are on a web page, use `read_url`. If the user pasted them, restate each in one line.
2. Group them: bugs, requested behaviour changes, style, questions, and praise or FYI. Handle bugs first.
3. For each comment, read the code it points at with `read_file`, plus its callers via `search_files`. Decide before editing:
   - Valid: apply it.
   - Valid but better fixed another way: apply your version and say why.
   - Unclear: draft a question for the reviewer and ask the user to send it.
   - Wrong or out of scope: decline with evidence such as a test, a doc line or a caller.
4. When a comment names a pattern ("this should not mutate the input"), run `search_files` for the same pattern across the diff and fix every instance, including those the reviewer did not quote.
5. Make edits with `edit_file`. Keep each change small enough to map to one comment so the reviewer can re-check it.
6. Run the relevant tests with `run_command` after the batch. Run `git_diff` to confirm nothing outside the comments moved.
7. Write one reply per comment, quoting the number, stating what changed or why not, and pointing at the line or commit.
8. Push the branch only when the user asks. Show the summary table first so they can confirm which comments you declined.

## Gotchas

- Two reviewers can ask for opposite things. Surface the conflict to the user with `ask_user` instead of satisfying the loudest one.
- A suggestion that fixes the quoted line can break another caller. Read callers before accepting a snippet as written.
- Declining needs evidence or a clear reason. "I prefer mine" invites a second round.
- Do not reformat or rename beyond the request while you are in there. It hides the requested changes in the re-review diff.
- Replies that say "done" with no detail force the reviewer to re-read the whole diff.
- Do not resolve a thread when the reviewer asked a question. They resolve it.
- Bots and linters also leave review comments. Treat them like any other, but check them against the current lint config before obeying.

## Output

- A table: comment number, decision, change or reason.
- Draft replies, one per comment, short and neutral in tone.
- The test result after the changes and any comment still waiting on the reviewer.
- Open questions for the user, if any comment needs a product decision.
