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

## Getting 1.x installs onto 2.0

Copies on 1.2.6 and 1.2.7 set `channel = "latest"` with `allowPrerelease` on. In
electron-updater's GitHub provider that combination only accepts a release whose
tag carries the prerelease id `latest`: `v2.0.0-latest` is offered to them, a
plain `v2.0.0` never is. Copies on 1.2.5 and older have no channel set and take
the newest release as usual.

So 2.0 goes out twice. The normal `v2.0.0` release for everyone else, and a
second release tagged `v2.0.0-latest` carrying the same installers and a
`latest.yml` that says `2.0.0`. The version inside is what gets compared, so a
1.2.7 copy moves to 2.0.0 and never sees the word `latest` again.

Two things to settle before that release:

- **2.x still pins the same channel.** `electron/updater.cjs` on v2 keeps
  `channel = "latest"`, so every 2.x release would need its `-latest` twin too.
  Changing it is safe for 2.x but needs testing against a real install first.
- **Test the path on a real machine.** Install 1.2.7, point it at a test release
  with both tags, and watch it take `v2.0.0-latest` and come back on 2.0.0 with
  every chat, setting and library index intact. The unit tests cover the data;
  only a real install covers the updater.

## Releasing from your own machine instead

If you would rather not use the workflow, build and publish locally. This needs
a GitHub personal access token with `repo` scope in `GH_TOKEN`:

```powershell
$env:GH_TOKEN = "your_token_here"
```

```bash
npm run release
```

`npm run release` builds the Windows installer and uploads it; `npm run
release:linux` does the same for the AppImage and `.deb`. Both require the tag
for that version to exist already.

To build an installer without touching GitHub at all, use `npm run
electron:build`. Every non-release build script passes `--publish never`, so a
local build can never upload anything by accident.

If that fails with `unable to verify the first certificate`, something on the
machine is intercepting TLS (antivirus, a proxy, a VPN) with a root Windows
trusts and Node does not. Node reads the system store when told to:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

The workflow runners have clean trust stores, so a tagged release is unaffected
either way.

## How the app behaves

`Settings → Updates` holds a single **Automatic updates** switch.

With it on, the app checks twenty seconds after launch and every six hours
afterwards, downloads a new version in the background, and installs it the next
time Draggy is quit. With it off nothing happens on its own; the same panel has
**Check now**, **Download** and **Restart and install** buttons.

Updates only work in a packaged build. In development the panel reports that
updates are disabled, which is expected.

## macOS

macOS is deliberately not part of the release workflow. Squirrel.Mac refuses to
apply an update to an app that is not signed and notarised, so an unsigned
`.dmg` would install fine and then never update itself again. `npm run
electron:build:mac` still produces one for manual distribution.

To add macOS properly you need an Apple Developer certificate, `CSC_LINK` and
`CSC_KEY_PASSWORD` as repository secrets, and notarisation credentials; then add
a `macos-latest` entry to the workflow matrix.
