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

## The channel

`electron/updater.cjs` never pins an explicit channel name; only
`allowPrerelease` changes between the two settings. **Releases** takes
GitHub's own latest non-prerelease tag. **Pre-release** adds a prerelease tag
on top of that, not instead of it; an explicit name would make electron-updater
look only for a tag carrying that word as its prerelease id, which nothing
published here has.

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

macOS is deliberately not part of the release workflow. The `.dmg` is signed
with an ad-hoc identity (`identity: "-"` in the build config), which is
required just to let it launch on Apple Silicon at all, but it is not
notarised. Squirrel.Mac refuses to apply an update to an app that is not
notarised, so a copy installed this way never updates itself again. `npm run
electron:build:mac` still produces one for manual distribution.

Because of that, Gatekeeper blocks the first launch of a downloaded copy
("Apple could not verify..."). Since macOS 15 the right-click → Open bypass is
gone; users have to click **Open Anyway** in System Settings → Privacy &
Security, or run `xattr -dr com.apple.quarantine /Applications/Draggy.app`.
The README's install section explains this; keep it in step if the build
changes.

To add macOS properly you need an Apple Developer certificate, `CSC_LINK` and
`CSC_KEY_PASSWORD` as repository secrets, and notarisation credentials; then add
a `macos-latest` entry to the workflow matrix.
