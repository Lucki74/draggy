import { describe, expect, it, vi, afterEach } from "vitest";
import {
  TALK_TIERS,
  installedMatch,
  planTalkModel,
  provideTalkModel,
  tierFor,
  tierOf,
} from "../voice/talkModel";

afterEach(() => {
  vi.unstubAllGlobals();
});

const E4B = TALK_TIERS.find((tier) => tier.model === "gemma-4-e4b-it")!;

describe("sizing the talk model to the machine", () => {
  it("climbs the ladder as memory grows", () => {
    expect(tierFor(0).model).toBe("lfm2.5-1.2b-instruct");
    expect(tierFor(1.5).model).toBe("lfm2.5-1.2b-instruct");
    expect(tierFor(2).model).toBe("lfm2.5-2.6b");
    expect(tierFor(3).model).toBe("ministral-3-3b-instruct");
    expect(tierFor(4).model).toBe("gemma-4-e2b-it");
    expect(tierFor(6.5).model).toBe("gemma-4-e4b-it");
    expect(tierFor(8).model).toBe("ministral-3-8b-instruct");
    expect(tierFor(12).model).toBe("gemma-4-12b-it");
    expect(tierFor(24).model).toBe("ministral-3-14b-instruct");
  });

  it("offers no model that reasons before it answers", () => {
    // A model that deliberates for six hundred characters before its first
    // word is a fine chat model and an unusable voice.
    for (const tier of TALK_TIERS) {
      expect(`${tier.model} ${tier.reference}`, `${tier.model} is a reasoning model`).not.toMatch(
        /qwen3|deepseek-r1|magistral|reasoning|thinking|gpt-oss/i,
      );
    }
  });

  it("gives every rung something the downloader can resolve, never a bare name", () => {
    for (const tier of TALK_TIERS) expect(tier.reference).toMatch(/^[\w.-]+\/[\w.-]+:\w+$/);
  });

  it("falls to the smallest rung when the card cannot be read", () => {
    expect(tierFor(0).model).toBe(TALK_TIERS[0].model);
    expect(tierFor(Number.NaN).model).toBe(TALK_TIERS[0].model);
    expect(tierFor(-4).model).toBe(TALK_TIERS[0].model);
  });

  it("stops climbing before the model costs more than it returns", () => {
    const top = TALK_TIERS[TALK_TIERS.length - 1];
    expect(tierFor(96).model).toBe(top.model);
    // A spoken answer is two sentences: nothing above this rung is offered
    // automatically however much memory the machine has.
    expect(top.model).toBe("ministral-3-14b-instruct");
  });

  it("only rises, never falls, as memory grows", () => {
    let last = -1;
    let size = 0;
    for (const tier of TALK_TIERS) {
      expect(tier.vram).toBeGreaterThan(last);
      expect(tier.downloadGB).toBeGreaterThan(size);
      last = tier.vram;
      size = tier.downloadGB;
    }
  });

  it("names the rung a model belongs to", () => {
    expect(tierOf("gemma-4-e4b-it")?.label).toBe("Gemma 4 E4B");
    expect(tierOf(E4B.reference)?.label).toBe("Gemma 4 E4B");
    expect(tierOf("mistral")).toBeNull();
  });
});

describe("recognising a model already on disk", () => {
  it("matches the exact file", () => {
    expect(installedMatch("a.gguf", ["b.gguf", "a.gguf"])).toBe("a.gguf");
  });

  it("matches any build of the family a rung is named after", () => {
    expect(installedMatch("gemma-4-e4b-it", ["gemma-4-E4B-it-Q4_K_M.gguf"])).toBe("gemma-4-E4B-it-Q4_K_M.gguf");
    expect(installedMatch("gemma-4-e4b-it", ["gemma-4-E4B-it-Q8_0.gguf"])).toBe("gemma-4-E4B-it-Q8_0.gguf");
  });

  it("ignores case and stray spacing", () => {
    expect(installedMatch("Gemma-4-E4B-IT", [" gemma-4-e4b-it-q4_k_m.gguf "])).toBe(" gemma-4-e4b-it-q4_k_m.gguf ");
  });

  it("does not match a different size in the same family", () => {
    expect(installedMatch("gemma-4-e4b-it", ["gemma-4-E2B-it-Q4_K_M.gguf", "gemma-4-12b-it-Q4_K_M.gguf"])).toBeNull();
  });

  it("has nothing to say about an empty name", () => {
    expect(installedMatch("", ["a.gguf"])).toBeNull();
  });
});

describe("planning what Talk will run", () => {
  it("uses the sized model when it is already installed", () => {
    const plan = planTalkModel({ installed: ["gemma-4-E4B-it-Q4_K_M.gguf"], vram: 6 });

    expect(plan.model).toBe("gemma-4-E4B-it-Q4_K_M.gguf");
    expect(plan.source).toBe("sized");
    expect(plan.download).toBeNull();
  });

  it("asks for a download when the sized model is missing", () => {
    const plan = planTalkModel({ installed: ["some-other-model.gguf"], vram: 6 });

    expect(plan.model).toBe("gemma-4-e4b-it");
    expect(plan.download?.model).toBe("gemma-4-e4b-it");
    expect(plan.download?.reference).toBe("unsloth/gemma-4-E4B-it-GGUF:Q4_K_M");
    expect(plan.download?.downloadGB).toBeGreaterThan(0);
  });

  it("honours a model the user pinned", () => {
    const plan = planTalkModel({
      override: "my-model.gguf",
      installed: ["my-model.gguf", "gemma-4-E4B-it-Q4_K_M.gguf"],
      vram: 6,
    });

    expect(plan.model).toBe("my-model.gguf");
    expect(plan.source).toBe("chosen");
    expect(plan.download).toBeNull();
  });

  it("reverts to automatic when the pinned model has been removed", () => {
    // Deleting a model is not a request to download it again.
    const plan = planTalkModel({
      override: "my-model.gguf",
      installed: ["Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"],
      vram: 3,
    });

    expect(plan.model).toBe("Ministral-3-3B-Instruct-2512-Q4_K_M.gguf");
    expect(plan.source).toBe("sized");
    expect(plan.download).toBeNull();
  });

  it("treats blank and whitespace as automatic", () => {
    for (const override of ["", "   ", undefined]) {
      const plan = planTalkModel({ override, installed: [], vram: 2 });
      expect(plan.source).toBe("sized");
      expect(plan.model).toBe("lfm2.5-2.6b");
    }
  });
});

/** The bridge as the downloader sees it; `onDisk` is what the models folder holds afterwards. */
function bridge(onDisk: string[], download: () => Promise<unknown> = async () => ({ success: true })) {
  let progressCallback: (progress: { phase: "downloading" | "done"; completed: number; total: number; percent: number }) => void = () => {};
  vi.stubGlobal("window", {
    electronAPI: {
      resolveModelUrl: async () => ({ url: "https://host/m.gguf", filename: "m.gguf" }),
      gguf: {
        onProgress: (cb: typeof progressCallback) => {
          progressCallback = cb;
          return () => {};
        },
        downloadModel: async () => {
          progressCallback({ phase: "downloading", completed: 50, total: 100, percent: 50 });
          progressCallback({ phase: "done", completed: 100, total: 100, percent: 100 });
          return download();
        },
        listModels: async () => onDisk.map((filename) => ({ filename })),
      },
    },
  });
}

describe("fetching the planned model", () => {
  it("does nothing when there is nothing to fetch", async () => {
    const provided = await provideTalkModel(
      { model: "gemma-4-E4B-it-Q4_K_M.gguf", tier: null, source: "sized", download: null },
      { fallback: "chat.gguf" },
    );

    expect(provided).toEqual({ model: "gemma-4-E4B-it-Q4_K_M.gguf", substituted: false });
  });

  it("downloads the rung's repository and answers with the file that landed", async () => {
    bridge(["chat.gguf", "gemma-4-E4B-it-Q4_K_M.gguf"]);
    const seen: number[] = [];

    const provided = await provideTalkModel(
      { model: E4B.model, tier: E4B, source: "sized", download: E4B },
      { fallback: "chat.gguf", onProgress: (p) => seen.push(p.percent) },
    );

    expect(provided).toEqual({ model: "gemma-4-E4B-it-Q4_K_M.gguf", substituted: false });
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("falls back to the chat model when the download fails", async () => {
    bridge([], async () => ({ success: false }));

    const provided = await provideTalkModel(
      { model: E4B.model, tier: E4B, source: "sized", download: E4B },
      { fallback: "chat.gguf" },
    );

    // A failed download loses the better model, not the conversation.
    expect(provided).toEqual({ model: "chat.gguf", substituted: true });
  });

  it("falls back when the download says it worked but the file is not there", async () => {
    bridge(["chat.gguf"]);

    const provided = await provideTalkModel(
      { model: E4B.model, tier: E4B, source: "sized", download: E4B },
      { fallback: "chat.gguf" },
    );

    expect(provided).toEqual({ model: "chat.gguf", substituted: true });
  });

  it("gives up when there is no chat model to fall back to", async () => {
    bridge([], async () => ({ success: false }));

    await expect(
      provideTalkModel({ model: E4B.model, tier: E4B, source: "sized", download: E4B }, { fallback: "" }),
    ).rejects.toThrow();
  });
});
