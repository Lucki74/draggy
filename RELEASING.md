# Releasing Draggy

Draggy updates itself from GitHub Releases. A build is one run of the Release workflow: it builds the Windows installer with Electron, the macOS app and the Linux packages natively, then publishes a release with the packages and the `latest.yml` file that `electron-updater` reads inside the app. The macOS build is signed ad hoc until a Developer ID certificate exists.

## Cutting a build

Builds are numbered. The Release workflow takes the next number N from the highest `b-N` tag and
builds the app as version `3.0.N`. The release is named `build-N`, the tag is `b-N`, and the app
shows it as "build N". Version `3.0.0` in `package.json` is the development build and is never
released.

1. Check that `main` is green on all three systems.
2. Write the notes (see below).
3. From the Actions tab, run Release on `main` with the notes, or from a terminal:

```bash
gh workflow run release.yml --ref main -f notes="$(cat notes.md)"
```

The workflow only runs from `main` and only by hand. The Windows job runs `npm run check` before it
builds, and the macOS and Linux jobs run the Rust tests for their system. The publish job waits for
all three, so a failure on any system means nothing is published.

The release is created as a draft, the files are uploaded, and only then is it published and marked
Latest. A failed upload therefore never leaves a half-empty release that installed apps would pick up.
If the build has no `latest-linux.yml`, the publish job copies it forward from an earlier release,
because Linux installs read that file from the newest `b-N` release and fail without it.

### Notes

Notes are Markdown with an `**Updates**` list and a `**Fixes**` list. Each bullet starts with what
changed for the user and has no trailing period. Leave out refactors nobody would notice. The
workflow appends the `**Full Changelog**` line. The notes become the release body and the "What's
new" text in the update dialog.

### Dry run

```bash
gh workflow run release.yml --ref main -f dry_run=true -f notes="dry run"
```

A dry run builds all three systems, skips the publish job, and keeps the installers as workflow artifacts. It creates no
tag and no release, so it does not use up a build number.

## Tags are permanent

The next build number comes from the existing `b-N` tags. Moving or deleting one would hand the same
number out twice, and an installed copy would then treat a different build as the one it already has.
A ruleset named "build tags" blocks updates and deletions of `b-*` tags. A bad build is
fixed by releasing the next number.

## What the updater trusts

Update signatures are off (`verifyUpdateCodeSignature: false`), and the checksum in `latest.yml`
comes from the same release as the installer. Whoever can write to a release can therefore ship code
to every installed copy. Release write access is the trust boundary, which is why the workflow
holds the only token that publishes, and why `SECURITY.md` says so. Signing the Windows build would
move that boundary to the certificate.

The app reads the highest `b-N` release itself (`electron/updater.cjs`). It ignores drafts and
pre-releases, never downgrades, and falls back to GitHub's own latest release when the list cannot
be read. `DRAGGY_UPDATE_FEED` points it at another folder of `latest.yml` files for testing.

## Moving the image engine to a newer build

The image engine is pinned to one stable-diffusion.cpp release, with the SHA-256 of every archive built into the app. It never follows "latest". Bumping it is a pull request of its own:

```bash
node scripts/updateSdRelease.mjs master-NNN-abcdef0
```

The script rewrites the tag, the archive names, and their hashes in `electron/sdBinaryManager.cjs` from GitHub's published digests, and refuses a release that is missing an archive a runner needs. Then run `npm run check`. `electron/sdServer.test.js` is the contract the new build has to keep, so read the release's API document for changes to `/sdcpp/v1/*` before trusting a green run. Install each runner you can on real hardware before merging.

## The large-model engine

colibri is not pinned. `electron/colibriBinary.cjs` installs the newest stable release of `JustVugg/colibri` and checks the archive against that release's `SHA256SUMS.txt`. The Windows Python runtime is pinned (version, URL and SHA-256 in the same file). Before a release, install colibri on a clean profile, load one catalog model, and confirm `electron/colibriProcess.test.js` still matches the gateway's flags and its `/health` fields. A newer colibri that renames either is the usual way this breaks. Keep `NOTICE` current when the set of on-demand downloads changes.

## Website updates

The site at draggy.org lives in its own repository (`../draggy-website`) and describes the released app, so update it on release day, not before.

Before running the workflow, make sure:
- the wiki and site pages reflect what changed, in English, French, Spanish, and Chinese;
- screenshots match the release interface, generated via `scripts/screenshots.cjs` and `scripts/wiki-shots.cjs` after `npm run build`;
- the privacy policy date is updated if network behavior changed, listing any new endpoints.

For details on how updates apply after install, see the docs' [Installation](https://docs.draggy.org/installation) page.
