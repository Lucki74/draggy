# Releasing Draggy

Draggy updates itself from GitHub Releases. `electron-builder` uploads the
installers together with a `latest.yml` (and `latest-linux.yml`) describing what
the newest version is and where to get it; `electron-updater` inside the app
reads that file and does the rest.

## Cutting a release

Everything is driven by a tag. From a clean `main`:

```bash
npm run check
```

```bash
npm version patch
```

`npm version` writes the new number into `package.json`, commits it, and creates
a matching `v1.0.1` tag. Use `minor` or `major` instead of `patch` as needed.

```bash
git push --follow-tags
```

That pushes the commit and the tag. The tag starts
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds on
Windows and Linux and publishes the artifacts to a GitHub Release named after the
tag. Nothing else is required: the workflow authenticates with the automatic
`GITHUB_TOKEN`, so there is no secret to configure.

The version in `package.json` is the single source of truth. An installed copy
compares its own version against the one in `latest.yml`, so a release whose tag
and `package.json` disagree will simply never be offered.

## Versions with a tag on the end

A version like `1.2.6-fix` or `1.3.0-rc.1` is a normal release here. Two
settings make that work, and both matter:

- `detectUpdateChannel: false` in the build config. Without it
  electron-builder names the manifest after the prerelease word, so a
  `1.2.6-fix` build uploads `fix.yml` instead of the `latest.yml` every
  installed copy reads.
- `allowPrerelease` and `channel` in `electron/updater.cjs`. A stable build
  otherwise refuses a prerelease outright, whatever the number says.

The one rule config cannot change is ordering. Semver puts a prerelease
**below** the version it is tagged from, so `1.2.6-fix` is newer than `1.2.5`
but `1.2.5-fix` is **older** than `1.2.5` and is never offered to anyone
already on it. Tag from the version you are heading for, not the one you are
on. `npm version 1.2.6-fix` writes it, the same as `patch` does.

## The channel, and who a release actually reaches

`electron/updater.cjs` pins `channel = "latest"` with `allowPrerelease` on,
which is what the **Pre-release** setting means and what every install defaults
to. In electron-updater's GitHub provider that combination only accepts a
release whose tag carries the prerelease id `latest`. A plain `vX.Y.Z` is never
offered to it; a `vX.Y.Z-latest` is.

**Every 2.x release so far has gone out as a plain tag.** Each is on the
releases page to download, and reaches a copy on 1.2.5 or older, which has no
channel pinned. None of them reach 1.2.6, 1.2.7, or each other. Nobody already
on 2.x has been offered an update.

Three ways out, none of them taken yet:

- **Publish the twin.** Tag `vX.Y.Z-latest` as well, carrying the same
  installers and a `latest.yml` that names the plain version. The version inside
  is what gets compared, so an install moves to X.Y.Z and never sees the word
  again. Every release needs its own twin, for as long as the channel is pinned.
- **Stop pinning.** Drop `channel = "latest"` so a plain tag reaches 2.x
  directly. It abandons anyone still on 1.2.6 or 1.2.7, and it wants testing
  against a real install before it ships.
- **Say so.** Leave it and tell people to download the installer, which is what
  is happening now.

Whichever it is, only a real install proves it. The unit tests cover the data a
version jump has to survive; none of them cover the updater.

## Releasing from your own machine instead

If you would rather not use the workflow, build and publish locally with a
GitHub personal access token (`repo` scope) in `GH_TOKEN`:

```bash
npm run release
```

`npm run release` builds the Windows installer and uploads it; `npm run
release:linux` does the AppImage and `.deb`. Both need the tag to exist
already. `npm run electron:build` builds locally without touching GitHub at
all; every non-release script passes `--publish never`.

`unable to verify the first certificate` means something on the machine is
intercepting TLS (antivirus, a proxy, a VPN). Point Node at the system trust
store instead of its own:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

The workflow runners are unaffected either way; their trust stores are clean.

How updates actually behave once installed is in the wiki's
[Installation](https://draggy.org/wiki/installation) page.

## macOS

macOS is deliberately not part of the release workflow. Squirrel.Mac refuses to
apply an update to an app that is not signed and notarised, so an unsigned
`.dmg` would install fine and then never update itself again. `npm run
electron:build:mac` still produces one for manual distribution.

To add macOS properly you need an Apple Developer certificate, `CSC_LINK` and
`CSC_KEY_PASSWORD` as repository secrets, and notarisation credentials; then add
a `macos-latest` entry to the workflow matrix.
