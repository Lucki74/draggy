# Draggy AI agent instructions

Read [AGENTS.md](AGENTS.md) first. It holds the commands, the invariants the tests enforce, the house style and the release flow. This file only adds what is specific to Claude Code.

## Repository layout

Windows code lives in `win/`, so run every `npm` command there. `macos/` (Swift) is compiled only by macOS CI. `core/` and `linux/` are Rust: run `cargo test -p <crate> -q` from `core/` or `linux/` (cargo is at `~/.cargo/bin`). Shared fixtures in `shared/fixtures/` must pass in vitest and cargo. See AGENTS.md for the table.

## Development and test workflow

- Run `npm run check` (typecheck, lint and tests) before finishing a task.
- During iteration run one file: `npx vitest run src/__tests__/<file>.test.ts` or `-t "test name"`. Vitest takes `--reporter=dot` for short output, not `-q`.
- The development server is `npm run electron:dev` on port 5173. Kill a stale Vite process if the port is taken.
- On Windows without Developer Mode, 48 tests in `toolsFiles.test.ts` fail with EPERM because they create symlinks. Treat them as environmental, not as regressions.
- An untracked `win/chat` file may be lying around; leave it out of commits.

## Editing

- Source files use CRLF in the working copy. A script that rewrites a file must normalize to LF, edit, and write CRLF back.
- Write helper scripts to a file instead of a shell heredoc, which mangles backslash escapes.
- A new English translation key needs the French, Spanish and Chinese entries, and a key nothing uses fails the translations test.
- Icon names must exist in `src/ui/icons/glyphs.generated.ts`.

## macOS and Rust work

- Swift files and `.xcstrings` use CRLF in the working copy. Edit `Localizable.xcstrings` as text, since a JSON re-dump rewrites the whole file.
- After a Swift change, watch the "Build and test" macOS job, which is the only compile check.
- Commits and PRs carry a subject or title only, no body and no attribution. Squash merge with `gh pr merge N --squash --subject "<title> (#N)" --body ""`.

## Compact instructions

When compacting, keep test output, changed file paths and open decisions.

## Cloud sessions

The cloud VM is Linux with no display. Run only `npm run typecheck`, `npm run lint` and `npm test` (or `npm run check`). Do not run `electron:dev` or any electron-builder target.

The VM runs Node 22, not the 24 in `.nvmrc`. Typecheck, lint and tests pass on it, so treat them as the gate and expect `EBADENGINE` warnings.
