// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectHooks, PROJECT_HOOKS_PATH } from "../agent/projectHooks";
import { hookFileDigest } from "../agent/hooks";

const CONFIG = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "write_file", command: "node check.js" }] } });

function fakeFiles(text: string | null) {
  (window as unknown as { draggy: unknown }).draggy = {
    files: {
      read: async (_workspace: string, path: string) =>
        text === null || path !== PROJECT_HOOKS_PATH ? { success: false } : { success: true, text },
    },
  };
}

afterEach(() => {
  delete (window as unknown as { draggy?: unknown }).draggy;
});

describe("project hooks", () => {
  it("reads nothing when the project has no hooks file", async () => {
    fakeFiles(null);
    const loaded = await loadProjectHooks("/p", undefined);
    expect(loaded).toMatchObject({ digest: null, entries: [], trusted: false });
  });

  it("is trusted only when the digest matches the trusted one", async () => {
    fakeFiles(CONFIG);
    const digest = await hookFileDigest(CONFIG);
    const trusted = await loadProjectHooks("/p", digest);
    expect(trusted.trusted).toBe(true);
    expect(trusted.entries[0]).toMatchObject({ event: "PreToolUse", command: "node check.js" });

    const untrusted = await loadProjectHooks("/p", undefined);
    expect(untrusted.trusted).toBe(false);
    expect(untrusted.entries.length).toBe(1);
  });

  it("stops trusting a file that changed since it was trusted", async () => {
    fakeFiles(CONFIG + " ");
    const oldDigest = await hookFileDigest(CONFIG);
    expect((await loadProjectHooks("/p", oldDigest)).trusted).toBe(false);
  });

  it("reports invalid JSON and runs nothing", async () => {
    fakeFiles("{ not json");
    const loaded = await loadProjectHooks("/p", undefined);
    expect(loaded.entries).toEqual([]);
    expect(loaded.errors).toEqual(["hooks.json is not valid JSON"]);
    expect(loaded.trusted).toBe(false);
  });
});
