import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The release workflow and the scripts it calls, which nothing else checks:
 * a typo here is only found when a tag has already been pushed.
 */

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
  it("does not go looking for a signing identity it will not find", () => {
    // Without this electron-builder hunts for a certificate and fails the
    // build rather than producing an unsigned app.
    expect(pkg.build.mac.identity).toBeNull();
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
    expect(updater).toContain('updater.channel = "latest"');
  });

  it("accepts one as an update", () => {
    // Without this a stable build refuses a prerelease outright, whatever the
    // number says.
    expect(updater).toContain("updater.allowPrerelease = true");
  });
});
