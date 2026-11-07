// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { clampDepth } from "../research/run";
import { activeRun } from "../research/session";
import { RESEARCH_TOOLS } from "../tools/research";
import { type ToolContext, type ToolEnvironment } from "../tools/registry";
import { defaultSettings } from "../app/settings";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = require("../../electron/researchLibrary.cjs") as any;
const sources = require("../../electron/sources.cjs") as any;
const { createSearchKey } = require("../../electron/searchKey.cjs") as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const DAY = 24 * 60 * 60 * 1000;
const env = (extra: Partial<ToolEnvironment> = {}) =>
  ({ webMode: "on", codeExecution: false, libraryReady: false, ...extra }) as ToolEnvironment;
const offered = (e: ToolEnvironment) => RESEARCH_TOOLS.find((spec) => spec.name === "start_research")!.available!(e);

describe("research defaults", () => {
  it("start on, deepest allowed, kept forever", () => {
    expect(defaultSettings.researchModelStart).toBe(true);
    expect(defaultSettings.researchMaxDepth).toBe("deep");
    expect(defaultSettings.researchKeep).toBe("forever");
  });
});

describe("depth clamp", () => {
  it("lowers a depth above the limit and leaves the rest", () => {
    expect(clampDepth("deep", "quick")).toBe("quick");
    expect(clampDepth("deep", "standard")).toBe("standard");
    expect(clampDepth("quick", "standard")).toBe("quick");
    expect(clampDepth("deep", undefined)).toBe("deep");
    expect(clampDepth("deep", "bogus")).toBe("deep");
  });

  it("applies to the drafted plan and to an edited one", async () => {
    const plan = { question: "Q?", sub_questions: "A\nB", depth: "deep", sources: "web" };
    const edited = { subQuestions: ["A"], depth: "deep", sources: ["web"] };
    const ctx = {
      t: (key: string) => key,
      newId: () => "id",
      pushStep: vi.fn(),
      patchStep: vi.fn(),
      syncSteps: vi.fn(),
      memo: new Map(),
      signal: new AbortController().signal,
      environment: env({ researchMaxDepth: "standard" }),
      askUser: vi.fn(async () => ({ choices: ["approve"], text: JSON.stringify(edited) })),
    } as unknown as ToolContext;
    const start = RESEARCH_TOOLS.find((spec) => spec.name === "start_research")!;
    await start.run(plan, ctx);
    expect(activeRun(ctx)?.plan.depth).toBe("standard");
    const card = (ctx.pushStep as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(card.researchPlan.depth).toBe("standard");
  });
});

describe("start_research gate", () => {
  it("is offered by default and when the model may start research", () => {
    expect(offered(env())).toBe(true);
    expect(offered(env({ researchModelStart: true }))).toBe(true);
  });

  it("is hidden when the model may not start research", () => {
    expect(offered(env({ researchModelStart: false }))).toBe(false);
  });

  it("stays hidden with the web off", () => {
    expect(offered(env({ webMode: "off" }))).toBe(false);
  });
});

describe("pruning", () => {
  it("drops runs older than the setting and keeps newer ones", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    lib.init(db);
    const make = (id: string, at: number) => ({
      id,
      status: "done",
      startedAt: at,
      contactedHosts: [],
      plan: { question: id, subQuestions: [], depth: "quick", sources: ["web"] },
      sources: [],
      notes: [],
    });
    const now = Date.now();
    lib.saveRun(make("old", now - 100 * DAY));
    lib.saveRun(make("mid", now - 60 * DAY));
    lib.saveRun(make("new", now - DAY));
    expect(lib.applyRetention("forever", now)).toBe(0);
    expect(lib.applyRetention("90", now)).toBe(1);
    expect(lib.applyRetention("30", now)).toBe(1);
    expect(lib.listRuns().map((run: { id: string }) => run.id)).toEqual(["new"]);
  });
});

describe("keys", () => {
  const response = { status: 200, ok: true, text: async () => "{}" };
  const base = { version: "1", now: () => 0, sleep: async () => {} };

  it("OpenAlex key reaches the paper search and is absent without one", async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => response);
    await sources.searchSource("graphs", "papers", { ...base, fetch, openAlexKey: "oa-secret" });
    const calls = fetch.mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes("openalex.org") && url.includes("api_key=oa-secret"))).toBe(true);
    fetch.mockClear();
    await sources.searchSource("graphs", "papers", { ...base, fetch });
    expect(fetch.mock.calls.every((call) => !String(call[0]).includes("api_key"))).toBe(true);
  });

  it("the GitHub token goes to api.github.com only", async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => response);
    await sources.searchSource("graphs", "code", { ...base, fetch, githubToken: "gh-secret" });
    for (const [url, init] of fetch.mock.calls as unknown as [string, { headers: Record<string, string> }][]) {
      const host = new URL(url).hostname;
      expect(Boolean(init.headers.Authorization)).toBe(host === "api.github.com");
    }
    expect(fetch.mock.calls.some((call) => String(call[0]).includes("api.github.com"))).toBe(true);
  });

  it("each service keeps its key under its own owner", () => {
    const store = new Map<string, { apiKey?: string }>();
    const secrets = {
      available: () => true,
      get: (owner: string) => store.get(owner) ?? {},
      set: (owner: string, value: { apiKey?: string }) => (store.set(owner, value), true),
    };
    const storage = { getValue: () => null, setValue: () => {} };
    const github = createSearchKey({ secrets, storage, owner: "search:github" });
    const alex = createSearchKey({ secrets, storage, owner: "search:openalex" });
    github.set("ghp_abc");
    expect(github.get()).toBe("ghp_abc");
    expect(alex.get()).toBe("");
    expect(store.has("search:github")).toBe(true);
  });
});
