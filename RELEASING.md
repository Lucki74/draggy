# Releasing Draggy

Draggy updates itself from GitHub Releases. A build is one run of the Release workflow: it builds the Windows installer with Tauri, the macOS app and the Linux packages natively, then publishes a release with the packages, the `latest.yml` files and `SHA256SUMS.txt`, which the app reads or checks against. The macOS build is signed ad hoc until a Developer ID certificate exists.

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
If the build has no `latest-linux.yml`, the publish job copies it forward from the newest `b-N` release that points at the frozen `electron-crossplatform-final` tag,
because Linux installs read that file from the newest `b-N` release and fail without it. `SHA256SUMS.txt` is copied forward the same way.

### Notes

Notes are Markdown with an `**Updates**` list and a `**Fixes**` list. Each bullet starts with what
changed for the user and has no trailing period. Leave out refactors nobody would notice. The
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

The Windows job runs on `windows-latest` in `win/`. It:

1. Fetches the pinned `node.exe` into `vendor/node/` and checks its SHA-256 against `scripts/node-pin.json`.
2. Runs `npm run stage:sidecars`, which copies that `node.exe` into `src-tauri/binaries/`.
3. Runs `npm run check`.
4. Runs `npm run tauri:build`, which builds the NSIS installer with `src-tauri/tauri.release.conf.json`. That file adds the embedded sandbox launcher and turns on `createUpdaterArtifacts`, so the build also writes a `.sig` next to the setup.
5. Renames the setup to `draggy_setup.exe` and writes the Tauri updater feed, `latest-windows.json`.

Build inputs are the Rust crate in `src-tauri/`, the React app in `src/`, and the `node.exe` sidecar. The installer is per-user (`installMode: currentUser`).

## Signing the updater

The Tauri updater verifies each update against a minisign public key. The release job signs the installer with the private key in two repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The public key goes in `plugins.updater.pubkey` in `win/src-tauri/tauri.conf.json`. **That value is still the placeholder `PLACEHOLDER_UPDATER_PUBKEY`.** Until it is replaced with the public half of the signing key, the updater cannot verify a signature, so the in-app Windows updater must be treated as not working. Replace it before the first Tauri build is released, and keep the private key and its password in the repository secrets only.

The Windows signature is the trust boundary for the Tauri feed. The macOS and Linux checksums come from the same release as the packages, so whoever can write to a release can still ship code to those platforms. That is why the workflow holds the only token that publishes, and why `SECURITY.md` says so.

## Where the Windows updates go

The publish job puts two things on the Windows side:

- The Tauri feed, `latest-windows.json`, and `draggy_setup.exe` go to the rolling `updater-windows` release. That release is created once, is never marked Latest, and is replaced on every Windows release. The app reads the feed URL set in `tauri.conf.json`.
- The bridge `latest.yml` for the installer goes into the `b-N` release. Installs of the Electron build read that file, so they can update into the Tauri build.

The bridge step calls `./scripts/bridge-latest-yml.ps1`. That script is not in the repository yet (see Known gaps).

macOS and Linux share the Rust code in `core/crates/draggy-core/src/update.rs`, which picks the highest `b-N` release, selects the asset by file name and checks its SHA-256 against `SHA256SUMS.txt`.

## Known gaps

These are open items in the release path. Fix them before relying on a release run.

- `win/src-tauri/tauri.conf.json` still has the placeholder updater public key (see above).
- The Windows job runs `npm run fetch:python`, but `win/package.json` has no such script. The embeddable Python runtime is not fetched by that name.
- The bridge step runs `./scripts/bridge-latest-yml.ps1`, which is not in the repository.

## Tags are permanent

The next build number comes from the existing `b-N` tags. Moving or deleting one would hand the same
number out twice, and an installed copy would then treat a different build as the one it already has.
A ruleset named "build tags" blocks updates and deletions of `b-*` tags. A bad build is
fixed by releasing the next number.

## Moving the image engine to a newer build

The image engine is pinned to one stable-diffusion.cpp release, with the SHA-256 of every archive built into the app. It never follows "latest". The pin lives in `core/crates/engine/src/sd_runner.rs`: the Windows and Unix release tags (`WINDOWS_RELEASE`, `UNIX_RELEASE`), the archive names, and their SHA-256 and size. Bumping it is a pull request of its own. Copy the new tag and the digests of every archive from GitHub's published release, update that file, and run `cargo test` in `core/` and `npm run check` in `win/`. Install each runner you can on real hardware before merging.

## The large-model engine

colibri is pinned too. `core/crates/engine/src/colibri_runtime.rs` holds the release (`RELEASE`, currently `v2.0.0`) and builds the download URLs from it. The archives are checked against that release's `SHA256SUMS.txt`. The Windows Python runtime is pinned in the same area (version, URL and SHA-256). Before a release, install colibri on a clean profile, load one catalog model, and confirm that the engine tests in `core/crates/engine/` still match the gateway's flags and its `/health` fields. A newer colibri that renames either is the usual way this breaks. Keep `NOTICE` current when the set of on-demand downloads changes.

## Website updates

The site at draggy.org lives in its own repository (`../draggy-website`) and describes the released app, so update it on release day, not before.

Before running the workflow, make sure:
- the documentation and site pages reflect what changed, in English, French, Spanish, and Russian;
- screenshots match the release interface. The screenshot scripts that older notes name are not in this repository, so retake them by hand from a `npm run tauri:build` run;
- the privacy policy date is updated if network behavior changed, listing any new endpoints.

For details on how updates apply after install, see the docs' [Installation](https://docs.draggy.org/installation) page.
