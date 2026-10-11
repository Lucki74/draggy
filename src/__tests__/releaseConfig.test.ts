import fs from "node:fs";
import { describe, expect, it } from "vitest";

/** The release workflow and the scripts it calls, which nothing else checks: a typo here is only
 * found when a tag has already been pushed. */

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

/** The `script:` values in the matrix, which are npm script names. */
function matrixScripts() {
  return [...workflow.matchAll(/script:\s*"?([\w:]+)"?\s*\}/g)].map((m) => m[1]);
}

describe("the release workflow", () => {
  it("builds for all three platforms", () => {
    for (const os of ["windows-latest", "ubuntu-latest", "macos-latest"]) {
      expect(workflow).toContain(`os: ${os}`);
    }
  });

  it("calls only scripts that exist", () => {
    const scripts = matrixScripts();
    expect(scripts.length).toBe(3);

    for (const name of scripts) {
      expect(Object.keys(pkg.scripts)).toContain(name);
    }
  });

  it("builds without publishing, because the workflow makes the release itself", () => {
    for (const name of matrixScripts()) {
      expect(pkg.scripts[name]).toContain("--publish never");
    }
    expect(Object.keys(pkg.scripts).filter((name) => pkg.scripts[name].includes("--publish always"))).toEqual([]);
  });

  it("stops everything when a platform fails, so a release is all three or none", () => {
    expect(workflow).toContain("fail-fast: true");
  });

  it("only ever starts by hand, from main", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
  });

  it("never puts the notes input inside a run block", () => {
    const uses = workflow
      .split("\n")
      .filter((line) => /\$\{\{\s*inputs\./.test(line))
      .map((line) => line.trim());
    // The two env entries are the only places the notes text enters the job.
    expect(uses).toEqual(["NOTES: ${{ inputs.notes }}", "NOTES: ${{ inputs.notes }}"]);
  });
});

describe("artifact names", () => {
  it("are fixed, so latest/download links never go stale", () => {
    expect(pkg.build.win.artifactName).toBe("draggy_setup.exe");
    expect(pkg.build.mac.artifactName).toBe("Draggy-${arch}.${ext}");
    expect(pkg.build.linux.artifactName).toBe("Draggy-${arch}.${ext}");
  });
});

describe("packaging", () => {
  it("signs ad-hoc rather than hunting for a certificate it will not find", () => {
    // "-" is electron-builder's own sentinel for an ad-hoc signature: it never
    // touches CSC_LINK or a real keychain entry, so CI needs no certificate.
    // Apple refuses to launch an arm64 build with no signature at all, which
    // is why plain `null` here shipped a Mac build nobody on Apple Silicon
    // could open.
    expect(pkg.build.mac.identity).toBe("-");
    expect(pkg.build.mac.notarize).toBe(false);
    expect(pkg.scripts["electron:build:mac"]).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
    expect(pkg.scripts["electron:build"]).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
  });

  it("ships an icon for every platform it builds", () => {
    for (const icon of [pkg.build.win.icon, pkg.build.mac.icon, pkg.build.linux.icon]) {
      expect(fs.existsSync(icon)).toBe(true);
    }
  });

  it("describes itself", () => {
    expect(pkg.description.length).toBeGreaterThan(20);
  });
});

describe("a version with a prerelease tag still reaches people", () => {
  const updater = fs.readFileSync("electron/updater.cjs", "utf8");

  it("keeps every build in one manifest", () => {
    // electron-builder otherwise names the file after the prerelease word, so
    // 1.2.6-fix would publish fix.yml, which no installed app ever reads.
    expect(pkg.build.detectUpdateChannel).toBe(false);
  });

  it("never pins an explicit channel name", () => {
    // Explicit channel names force GitHub tag filtering by prerelease id;
    // null allows fetching latest.yml directly without filtering releases.
    expect(updater).not.toMatch(/updater\.channel\s*=\s*"/);
  });

  it("follows build tags and never prereleases", () => {
    // Every build is a full release named b-N; a prerelease flag would hide it from the picker.
    expect(updater).toContain("updater.allowPrerelease = false");
    expect(updater).toContain("^b-(\\d+)$");
  });

  it("never allows downgrading to an older release", () => {
    // Resetting channel to null in electron-updater silently flips allowDowngrade
    // to true, which must be immediately forced back to false.
    const matches = [...updater.matchAll(/updater\.allowDowngrade\s*=\s*false/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

