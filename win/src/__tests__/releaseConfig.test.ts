import fs from "node:fs";
import { describe, expect, it } from "vitest";

/** The release workflow and the scripts it calls, which nothing else checks: a typo here is only
 * found when a tag has already been pushed. */

const workflow = fs.readFileSync("../.github/workflows/release.yml", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

/** The `script:` values in the matrix, which are npm script names. */
function matrixScripts() {
  return [...workflow.matchAll(/script:\s*"?([\w:]+)"?\s*\}/g)].map((m) => m[1]);
}

describe("the release workflow", () => {
  it("builds for Windows only; the native apps have their own pipelines", () => {
    expect(workflow).toContain("os: windows-latest");
    expect(workflow).not.toContain("os: macos-latest");
    expect(workflow).not.toContain("os: ubuntu-latest");
  });

  it("calls only scripts that exist", () => {
    const scripts = matrixScripts();
    expect(scripts.length).toBe(1);

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

  it("stops everything when a platform fails, so a release is every build or none", () => {
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

describe("the frozen Linux update feed", () => {
  /** The publish job, and one of its steps from its `- name:` line up to the next step. */
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  const carryName = "Carry the frozen Linux update feed";
  const carry = (() => {
    const start = publish.indexOf(`- name: ${carryName}`);
    if (start < 0) return "";
    const next = publish.indexOf("\n      - ", start);
    return publish.slice(start, next < 0 ? undefined : next);
  })();

  it("runs after the artifacts download and before the release is created", () => {
    const at = publish.indexOf(`- name: ${carryName}`);
    expect(at).toBeGreaterThan(publish.indexOf("uses: actions/download-artifact"));
    expect(at).toBeLessThan(publish.indexOf("- name: Create the release"));
  });

  it("names the frozen tag and the feed file it copies", () => {
    expect(carry).toContain("electron-crossplatform-final");
    expect(carry).toContain("latest-linux.yml");
  });

  it("does nothing when this build already has the feed", () => {
    const body = carry.slice(carry.indexOf("run: |"));
    const beforeFirstGh = body.slice(0, body.indexOf("gh "));
    expect(beforeFirstGh).toMatch(/if \[ -f out\/latest-linux\.yml \]; then[\s\S]*exit 0/);
  });

  it("runs under bash", () => {
    expect(carry).toContain("shell: bash");
  });

  it("still publishes the release as Latest, so Latest keeps pointing at a Windows build", () => {
    expect(publish).toContain("--draft=false --latest");
  });

  it("adds no inputs expression", () => {
    expect(carry).not.toContain("inputs.");
  });
});

describe("artifact names", () => {
  it("are fixed, so latest/download links never go stale", () => {
    expect(pkg.build.win.artifactName).toBe("draggy_setup.exe");
  });
});

describe("packaging", () => {
  it("builds without hunting for a signing certificate", () => {
    expect(pkg.scripts["electron:build"]).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
  });

  it("ships its icon", () => {
    for (const icon of [pkg.build.win.icon]) {
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

  it("never falls back to GitHub's own latest release", () => {
    // Native macOS and Linux releases share the repo, so Latest may not hold a Windows build.
    expect(updater).not.toContain('provider: "github"');
  });

  it("never allows downgrading to an older release", () => {
    // Resetting channel to null in electron-updater silently flips allowDowngrade
    // to true, which must be immediately forced back to false.
    const matches = [...updater.matchAll(/updater\.allowDowngrade\s*=\s*false/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

