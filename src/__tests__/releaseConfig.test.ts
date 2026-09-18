import fs from "node:fs";
import { describe, expect, it } from "vitest";

/** The release workflow and the scripts it calls, which nothing else checks: a typo here is only
 * found when a tag has already been pushed. */

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

/** The `build:` values in the matrix, which are npm script names. */
function matrixScripts() {
  return [...workflow.matchAll(/^\s+build:\s*(\S+)$/gm)].map((m) => m[1]);
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

  it("publishes from every platform", () => {
    for (const name of matrixScripts()) {
      expect(pkg.scripts[name]).toContain("--publish always");
    }
  });

  it("keeps a platform failing from cancelling the others", () => {
    expect(workflow).toContain("fail-fast: false");
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
    expect(pkg.scripts["release:mac"]).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
    expect(pkg.scripts.release).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
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

  it("lets the pre-release setting also pick up a plain release", () => {
    // Pre-release is meant to add prerelease tags on top of plain releases,
    // not swap one set for the other.
    expect(updater).toContain('updater.allowPrerelease = channel !== "release"');
  });
});
