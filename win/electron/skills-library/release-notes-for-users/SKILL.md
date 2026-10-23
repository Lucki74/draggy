---
name: release-notes-for-users
description: Turns commits, tickets or a changelog into release notes for end users, grouped by what people can now do, with breaking changes and required actions first and internal detail removed. Use when the user asks for release notes, a what's new announcement, or to explain an update to customers.
---

# Release notes for users

## Goal

Tell users what changed for them and what they must do. A good result opens with anything that requires action, describes each change as a benefit or behaviour in the user's terms, leaves out internal work, and links to detail where it exists.

## When to use

- A version is shipping and users need a clear account.
- The raw material is commit messages, pull request titles or tickets.
- For a developer-facing changelog in Keep a Changelog style, use `use_skill` with `changelog`.
- For the version number and tag, use `use_skill` with `release-tagging`.

## Steps

1. Get the changes. For a repo, run `git log --oneline <last-tag>..HEAD` with `run_command`, and read merged pull request titles if the host CLI is available. For a file of tickets, `read_file`. Read each change's diff or ticket when the title is unclear, with `git show --stat <hash>`.
2. Ask with `ask_user` who reads the notes: end users, admins, or developers using an API. Ask for the product's usual terms for features, and the previous notes to match their format.
3. Sort changes into: breaking or action required, new, improved, fixed, deprecated or removed. Drop internal items: refactors, test changes, dependency bumps, CI changes, unless they alter behaviour users can see.
4. Rewrite each kept change in the user's words. Describe the result, not the code: "Exports now include the date column" in place of "add date field to exporter". Name the screen, setting or command the user will touch.
5. For each breaking change give three things: what changes, who is affected, and what to do, with the exact steps or setting. Put these first, under a plain heading.
6. For fixes, say what used to go wrong in terms the user would recognise ("Large files no longer fail to upload"). Skip fixes to bugs no user could see.
7. Check each statement against the code or ticket, not the title. If a title says "faster" without a number, do not invent one. Say what is known.
8. Keep order by importance within each group. Keep the whole note to a screen or two. Add links to documentation or the full changelog for those who want depth.
9. Verify names: feature names, menu paths and flags match the current product. Use `search_files` in the repo for the strings if there is doubt. Save with `create_file` if requested.
10. Add upgrade notes when there is anything to do: backups, migrations, minimum versions, restart needs.
11. Keep a consistent tense and form across items so the list scans: past tense for fixes, present for new abilities.

## Gotchas

- Pasted commit subjects read as noise to users. "fix: handle null in parser" means nothing to someone who clicked a button.
- Breaking changes hidden in a list of fifteen items get missed. Put them first and make them stand out in plain words.
- Naming internal components or ticket numbers confuses users who never see them. Use product vocabulary.
- Claiming a performance gain, security fix or compatibility without evidence invites support tickets. Say only what was verified.
- A security fix needs care: say that users should update, but do not describe the weakness in detail before most have.
- Notes for several audiences in one list serve none. If admins and end users differ, split them.
- Features behind a flag or limited rollout should say who gets them and when, or users will report them as missing.
- Thanking contributors by name needs their consent in some projects. Check the project's custom.
- Removing a feature without a replacement path generates support load. Say what to use instead.
- Release dates slip. Write the date only when the release is out, or mark it as planned.
- Notes in several languages must be translated from the final English text, not from drafts.

## Output

- The release notes in the product's usual format, starting with the version and date if known.
- Sections in order: action required, new, improved, fixed, deprecated.
- A short list of changes you omitted as internal, and any item whose effect you could not confirm, for the user to check.
