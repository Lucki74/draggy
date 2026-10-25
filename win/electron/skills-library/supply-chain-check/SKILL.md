---
name: supply-chain-check
description: Vets packages before adoption (maintainers, age, install scripts, typosquat names, provenance) and reviews the build pipeline for lockfile integrity, pinned actions and token scope. Use when the user asks if a package is safe to add, wants to check dependencies for malicious code, or needs to harden CI against tampering.
---

# Supply chain check

## Goal

Reduce the chance that code the team did not write runs with the team's privileges.

A good check gives a clear adopt, avoid or replace call on each package with the evidence, and closes the common pipeline gaps.

## When to use

- The user is about to add a new dependency or GitHub Action.
- A strange package name appears in the lockfile.
- The team wants build and release hardening.
- For known CVEs in packages already used, use `use_skill` with `dependency-vulnerability-triage`.

## Steps

1. Name the package and registry. Read its registry page with `read_url`: owner, first publish date, recent release history, download trend, linked repository.
2. Compare the registry name with the repository and with the name the user meant. Look for lookalikes and swapped letters.
3. Read the source repository with `read_url`: activity, number of maintainers, open security issues, whether the published package matches a tag.
4. Inspect install-time code. For npm check `scripts` (`preinstall`, `install`, `postinstall`) in the manifest. For Python look at `setup.py` side effects.
5. Download the package without running it, such as `npm pack` in an empty directory through `run_command`, and read what it contains with `list_directory` and `search_files` for network calls, `eval`, obfuscated blobs and credential reads.
6. Count the transitive dependencies the package would bring in and prefer smaller trees. Ask whether the standard library or a few lines of code would do.
7. Check the project's lockfile with `read_file`: it is committed, and CI installs from it with a command that fails on drift (`npm ci`, `pip install --require-hashes`).
8. Check CI configuration: third party actions pinned to a full commit hash, minimal token permissions, no secrets exposed to pull requests from forks, and a protected release branch.
9. Check registry settings: publish tokens scoped and short lived, two-factor on maintainer accounts, and provenance attestations if the ecosystem supports them. Confirm current features with `search_web`.
10. Check that private package names are claimed on the public registry or scoped, to prevent dependency confusion.
11. Write the decision per package and the pipeline fixes with `edit_file` where simple.
12. State what was not reviewed, such as compiled binaries.

## Gotchas

- Download counts are easy to inflate and prove nothing about safety.
- A trusted package can be compromised by a maintainer account takeover. Pin versions and review updates to sensitive packages.
- The repository on the registry page may differ from the published tarball. Read the tarball.
- A tag like `@v3` on a GitHub Action can move. Only a commit hash is fixed.
- Running the package's install script to inspect it executes its code on your machine. Inspect first, in an isolated environment.
- Auto-merge of dependency bump pull requests passes any malicious release straight into production.

## Output

- Per package: adopt, avoid or replace, with evidence lines.
- Pipeline hardening list with changes made.
- Residual risks and what was not checked.
