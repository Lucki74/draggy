# Releasing Draggy

Draggy updates itself from GitHub Releases. A build is one run of the Release workflow: it builds the Tauri app for Windows, macOS and Linux, then publishes a release with the installers, the signed Tauri updater feeds and `SHA256SUMS.txt`.

## Cutting a build

Builds are numbered. The Release workflow takes the next number N from the highest `b-N` tag and
builds the app as version `3.0.N`. The release is named `build-N`, the tag is `b-N`, and the app
shows it as "build N". Version `3.0.5` in `package.json` is the development build and is never
released.

1. Check that `main` is green on Windows, macOS and Linux.
2. Write the notes (see below).
3. From the Actions tab, run Release on `main` with the notes, or from a terminal:

```bash
gh workflow run release.yml --ref main -f notes="$(cat notes.md)"
```

The workflow only runs from `main` and only by hand. The Windows job runs `npm run check` before it
builds, and the macOS and Linux jobs run the Rust tests in `app/src-tauri`. The publish job waits for all
three, so a failure on any system means nothing is published.

The release is created as a draft, the files are uploaded, and only then is it published and marked
Latest. A failed upload therefore never leaves a half-empty release that installed apps would pick up.
The publish job checks that every installer and feed is there before it creates the release. `SHA256SUMS.txt` lists every file in the release.

### Notes

Notes are Markdown with an `**Updates**` heading and a `**Fixes**` heading, each followed by a
bulleted list (`* `), one short line per change. Say what changed for the user, with no dashes in
the text. Leave out a heading with nothing under it, and refactors nobody would notice. The
workflow appends the `**Full Changelog**` line. The notes become the release body.
While a build is in preparation, the notes file is `RELEASE-NOTES-BUILD-X.md` at the repo root. Rename
it to `RELEASE-NOTES-BUILD-<n>.md` once the build number is known, and keep only one such file.

### Dry run

```bash
gh workflow run release.yml --ref main -f dry_run=true -f notes="dry run"
```

A dry run builds all three systems, skips the publish job, and keeps the installers as workflow artifacts. It creates no
tag and no release, so it does not use up a build number.

## The Windows build

The Windows job runs on `windows-latest` in `app/`. It:

1. Fetches the pinned `node.exe` into `vendor/node/` and checks its SHA-256 against `scripts/node-pin.json`.
2. Runs `npm run stage:sidecars`, which copies that `node.exe` into `src-tauri/binaries/`.
3. Runs `npm run check`.
4. Runs `npm run tauri:build`, which builds the NSIS installer with `src-tauri/tauri.release.conf.json`. That file adds the embedded sandbox launcher and turns on `createUpdaterArtifacts`, so the build also writes a `.sig` next to the setup.
5. Renames the setup to `draggy_setup.exe` and writes the Tauri updater feed, `latest-windows.json`.

Build inputs are the Rust crate in `src-tauri/`, the React app in `src/`, and the `node.exe` sidecar. The installer is per-user (`installMode: currentUser`).

## The macOS build

The macOS job runs on `macos-15` in `app/`. `scripts/fetch-sidecars-unix.sh mac` fetches `node`, `ffmpeg` and `ffprobe` for both Intel and Apple silicon and checks them against `scripts/node-pin-macos.json` and `scripts/ffmpeg-pin-macos.json`. The job then runs `npx tauri build --target universal-apple-darwin` with `tauri.release.conf.json` and `tauri.release.unix.conf.json` (the second drops the Windows-only resources). `scripts/stage-sidecars-mac.sh` joins each sidecar into one universal binary with `lipo`, so one app runs on both kinds of Mac. The app needs macOS 14 or newer.

The app is signed ad hoc (`codesign --force --deep --sign -`) and not notarized, which is why the first open needs the Gatekeeper step. Signing changes the bundle, so the job packs the signed app again as `.app.tar.gz` and signs that with `tauri signer sign`. The download is `Draggy-3.0.N-macos-universal.zip`; the updater gets the `.app.tar.gz` and its `.sig`.

## The Linux build

The Linux job runs on `ubuntu-24.04` in `app/`. `scripts/fetch-sidecars-unix.sh linux` fetches `node`, `ffmpeg` and `ffprobe` and checks them against `scripts/node-pin-linux.json` and `scripts/ffmpeg-pin-linux.json`. `scripts/stage-sidecars-linux.sh` stages them, and `npx tauri build` with the same two release configs builds the `.deb`, `.rpm` and AppImage, each with a `.sig` for the updater. The job renames them to `draggy_3.0.N_amd64.deb`, `draggy-3.0.N-1.x86_64.rpm` and `draggy_3.0.N_amd64.AppImage`, the names draggy.org looks for.

The ffmpeg builds for macOS and Linux come from ffmpeg.martin-riedl.de, pinned to a versioned URL and the SHA-256 of each archive. Its Intel macOS builds stop in January 2027, so a later ffmpeg bump on Intel needs another source.

## Signing the updater

The Tauri updater verifies each update against a minisign public key. The release jobs sign every updater artifact on all three systems with the private key in two repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The public key is `plugins.updater.pubkey` in `app/src-tauri/tauri.conf.json`. The private key and its password exist only in the repository secrets. A new key pair breaks updates for every install that has the old public key, so rotate it only after a compromise, and ship the new public key in a build signed with the old key first.

The signature is the trust boundary for the Tauri feeds: an update that does not match the public key is refused on every system. Older Electron and GTK installs still check only the SHA-256 in the release, so whoever can write to a release can ship code to them. That is why the workflow holds the only token that publishes, and why `SECURITY.md` says so.

## Where the updates go

Every `b-N` release carries the Tauri feed for each system next to the installers, and each feed links to files in that same release. The app asks for `releases/latest/download/<feed>`, and GitHub serves that file from whichever release is marked Latest, so there is no separate feed release to keep in step.

| Feed | Read by |
|---|---|
| `latest-windows.json` | `tauri.conf.json` |
| `latest-macos.json` | `tauri.macos.conf.json` |
| `latest-linux.json` | `tauri.linux.conf.json` |

The macOS feed lists the universal `.app.tar.gz` under `darwin-x86_64` and `darwin-aarch64`. The Linux feed lists the AppImage under `linux-x86_64` and `linux-x86_64-appimage`, and the packages under `linux-x86_64-deb` and `linux-x86_64-rpm`, the keys `tauri-plugin-updater` 2.14 looks up for each installer type.

Installs that predate Tauri read other files. Electron builds use electron-updater, which reads `latest.yml` on Windows and `latest-linux.yml` on Linux from the Latest release and checks the SHA-512 and size listed there. The Windows job writes `latest.yml` for `draggy_setup.exe`; the site also reads its `version:` line. The Linux job writes `latest-linux.yml` fresh for the AppImage, `.deb` and `.rpm`, and electron-updater picks the file that matches how it was installed. GTK Linux builds read no feed: they list the `b-N` releases through the GitHub API, take the first `.deb` or `.rpm`, and check it against `SHA256SUMS.txt`.

## Tags are permanent

The next build number comes from the existing `b-N` tags. Moving or deleting one would hand the same
number out twice, and an installed copy would then treat a different build as the one it already has.
A ruleset named "build tags" blocks updates and deletions of `b-*` tags. A bad build is
fixed by releasing the next number.

## Moving the image engine to a newer build

The image engine is pinned to one stable-diffusion.cpp release, with the SHA-256 of every archive built into the app. It never follows "latest". The pin lives in `core/crates/engine/src/sd_runner.rs`: the Windows and Unix release tags (`WINDOWS_RELEASE`, `UNIX_RELEASE`), the archive names, and their SHA-256 and size. Bumping it is a pull request of its own. Copy the new tag and the digests of every archive from GitHub's published release, update that file, and run `cargo test` in `core/` and `npm run check` in `app/`. Install each runner you can on real hardware before merging.

## The large-model engine

colibri is pinned too. `core/crates/engine/src/colibri_runtime.rs` holds the release (`RELEASE`, currently `v2.0.0`) and builds the download URLs from it. The archives are checked against that release's `SHA256SUMS.txt`. The Windows Python runtime is pinned in the same area (version, URL and SHA-256). Before a release, install colibri on a clean profile, load one catalog model, and confirm that the engine tests in `core/crates/engine/` still match the gateway's flags and its `/health` fields. A newer colibri that renames either is the usual way this breaks. Keep `NOTICE` current when the set of on-demand downloads changes.

## Website updates

The site at draggy.org lives in `websites/www` and the documentation at docs.draggy.org in `websites/docs`. A finished Release run redeploys draggy.org so it shows the new build. Both describe the released app, so update them on release day, not before.

Before running the workflow, make sure:
- the documentation and site pages reflect what changed, in English, French, Spanish, and Russian;
- screenshots and clips match the release interface. Retake them with `npm run shots` and `npm run clips` in `app/`, which write into the docs and website checkouts;
- the privacy policy date is updated if network behavior changed, listing any new endpoints.

For details on how updates apply after install, see the docs' [Installation](https://docs.draggy.org/installation) page.
