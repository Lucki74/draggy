# Contributing

This folder holds content, so most changes are text: a page that no longer matches the app, a translation that reads wrong, a broken link. Open an issue first if you are unsure whether something is wrong.

## Making a change

1. Fork the repo and create a branch.
2. Each page is a Markdown file in `src/{en,fr,es,ru}/`. The sidebar is `nav.json`, and numbers shared across pages are in `site.json`.
3. Write the English first. When you change an English string, change the French, Spanish and Russian ones too, or say in the pull request that they still need a translation.
4. Run `npm run build`, `npm test` and `npm run tokens:check`.
5. Open a pull request with a short title that says what changed.

## Style

- Plain, concrete sentences in sentence case. No em dashes and no exclamation marks.
- Check what you write against the current release of the app. If you cannot confirm a claim, leave it out.
- Screenshots and clips come from the real app, captured by the scripts in [Lucki74/draggy](https://github.com/Lucki74/draggy). Please do not submit edited or drawn images.

## Bugs in the app

Report those on [the app's issue tracker](https://github.com/Lucki74/draggy/issues).
