import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const secrets = require("./secrets.cjs");

/**
 * The credential store. What it has to guarantee: a token never lands on disk
 * in a form anything else can read, and a store that cannot be decrypted costs
 * the user a re-entry rather than a broken app.
 */

let workdir;

/** Stands in for Electron's safeStorage, reversibly but not readably. */
function fakeVault(availableNow = true) {
  return {
    isEncryptionAvailable: () => availableNow,
    encryptString: (text) => Buffer.from(text, "utf8").toString("base64"),
    decryptString: (buffer) => Buffer.from(String(buffer), "base64").toString("utf8"),
  };
}

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-secrets-"));
  secrets.init(workdir, fakeVault());
});

afterEach(() => {
  secrets.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

const storeFile = () => path.join(workdir, "secrets.bin");

describe("keeping a credential", () => {
  it("reads back what it was given", () => {
    secrets.set("github", { GITHUB_TOKEN: "ghp_secret" });

    expect(secrets.get("github")).toEqual({ GITHUB_TOKEN: "ghp_secret" });
  });

  it("does not leave it readable on disk", () => {
    secrets.set("github", { GITHUB_TOKEN: "ghp_secret" });

    expect(fs.readFileSync(storeFile(), "utf8")).not.toContain("ghp_secret");
  });

  it("survives the app being restarted", () => {
    secrets.set("github", { GITHUB_TOKEN: "ghp_secret" });
    secrets.close();
    secrets.init(workdir, fakeVault());

    expect(secrets.get("github").GITHUB_TOKEN).toBe("ghp_secret");
  });

  it("drops a field that was emptied", () => {
    secrets.set("github", { GITHUB_TOKEN: "ghp_secret" });
    secrets.set("github", { GITHUB_TOKEN: "" });

    expect(secrets.get("github")).toEqual({});
    expect(secrets.owners()).toEqual([]);
  });

  it("forgets a server that was removed", () => {
    secrets.set("github", { GITHUB_TOKEN: "x" });
    secrets.remove("github");

    expect(secrets.get("github")).toEqual({});
  });

  it("hands a server its own secrets and nobody else's", () => {
    secrets.set("github", { GITHUB_TOKEN: "one" });
    secrets.set("gitlab", { GITLAB_TOKEN: "two" });

    expect(secrets.withSecrets("github", { PATH: "/usr/bin" })).toEqual({
      PATH: "/usr/bin",
      GITHUB_TOKEN: "one",
    });
  });
});

describe("when the operating system will not help", () => {
  beforeEach(() => {
    secrets.close();
    secrets.init(workdir, fakeVault(false));
  });

  it("says so rather than writing in the clear", () => {
    expect(secrets.available()).toBe(false);

    secrets.set("github", { GITHUB_TOKEN: "ghp_secret" });

    expect(fs.existsSync(storeFile())).toBe(false);
  });
});

describe("a store it cannot read", () => {
  it("starts empty rather than failing", () => {
    fs.writeFileSync(storeFile(), "not encrypted by us");
    secrets.close();
    secrets.init(workdir, fakeVault());

    expect(secrets.get("github")).toEqual({});
    expect(secrets.owners()).toEqual([]);
  });
});

describe("taking over credentials kept somewhere else", () => {
  const records = {
    github: {
      enabled: true,
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_old", GITHUB_HOST: "github.com" },
      arguments: { roots: ["C:\\projects"] },
    },
    filesystem: { enabled: true, env: {}, arguments: { roots: ["C:\\projects"] } },
  };

  const isSecret = (field) => field.toUpperCase().includes("TOKEN");

  it("moves the secret fields into the store", () => {
    secrets.adopt(records, isSecret);

    expect(secrets.get("github")).toEqual({
      GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_old",
    });
  });

  it("hands back the records with the secrets taken out", () => {
    const { moved, records: cleaned } = secrets.adopt(records, isSecret);

    expect(moved).toBe(1);
    expect(cleaned.github.env).toEqual({ GITHUB_HOST: "github.com" });
    // Everything that was not a credential is left exactly as it was.
    expect(cleaned.github.arguments).toEqual({ roots: ["C:\\projects"] });
    expect(cleaned.filesystem).toEqual(records.filesystem);
  });

  it("changes nothing when there is nothing to move", () => {
    const { moved } = secrets.adopt({ filesystem: records.filesystem }, isSecret);

    expect(moved).toBe(0);
    expect(secrets.owners()).toEqual([]);
  });

  it("leaves the records alone when the store is unavailable", () => {
    secrets.close();
    secrets.init(workdir, fakeVault(false));

    const { moved, records: cleaned } = secrets.adopt(records, isSecret);

    expect(moved).toBe(0);
    expect(cleaned).toBe(records);
  });
});
