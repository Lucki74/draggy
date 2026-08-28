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

describe("sizing the talk model to the machine", () => {
  it("climbs the ladder as memory grows", () => {
    expect(tierFor(0).model).toBe("smollm2:360m");
    expect(tierFor(1.5).model).toBe("smollm2:360m");
    expect(tierFor(2).model).toBe("llama3.2:1b");
    expect(tierFor(4).model).toBe("qwen3:1.7b");
    expect(tierFor(6.5).model).toBe("llama3.2:3b");
    expect(tierFor(12).model).toBe("qwen3:4b");
    expect(tierFor(24).model).toBe("qwen3:8b");
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
    expect(top.model).toBe("qwen3:8b");
  });

  it("only rises, never falls, as memory grows", () => {
    let last = -1;
    for (const tier of TALK_TIERS) {
      expect(tier.vram).toBeGreaterThan(last);
      last = tier.vram;
    }
  });

  it("names the rung a model belongs to", () => {
    expect(tierOf("qwen3:4b")?.label).toBe("Qwen 3 4B");
    expect(tierOf("mistral")).toBeNull();
  });
});

describe("recognising a model already on disk", () => {
  it("matches the exact tag", () => {
    expect(installedMatch("qwen3:4b", ["llama3.2:1b", "qwen3:4b"])).toBe("qwen3:4b");
  });

  it("matches a re-quantised build of the same weights", () => {
    expect(installedMatch("qwen3:4b", ["qwen3:4b-instruct-q5_K_M"])).toBe(
      "qwen3:4b-instruct-q5_K_M",
    );
  });

  it("ignores case and stray spacing", () => {
    expect(installedMatch("Qwen3:4B", [" qwen3:4b "])).toBe(" qwen3:4b ");
  });

  it("does not match a different size in the same family", () => {
    expect(installedMatch("qwen3:4b", ["qwen3:1.7b", "qwen3:8b"])).toBeNull();
  });

  it("does not match on family alone", () => {
    expect(installedMatch("qwen3:4b", ["qwen3"])).toBeNull();
    expect(installedMatch("qwen3", ["qwen3:4b"])).toBeNull();
  });

  it("has nothing to say about an empty name", () => {
    expect(installedMatch("", ["qwen3:4b"])).toBeNull();
  });
});

describe("planning what Talk will run", () => {
  it("uses the sized model when it is already installed", () => {
    const plan = planTalkModel({ installed: ["qwen3:4b"], vram: 10 });

    expect(plan.model).toBe("qwen3:4b");
    expect(plan.source).toBe("sized");
    expect(plan.download).toBeNull();
  });

  it("asks for a download when the sized model is missing", () => {
    const plan = planTalkModel({ installed: ["llama3.1:70b"], vram: 10 });

    expect(plan.model).toBe("qwen3:4b");
    expect(plan.download?.model).toBe("qwen3:4b");
    expect(plan.download?.downloadGB).toBeGreaterThan(0);
  });

  it("honours a model the user pinned", () => {
    const plan = planTalkModel({
      override: "mistral:7b",
      installed: ["mistral:7b", "qwen3:4b"],
      vram: 10,
    });

    expect(plan.model).toBe("mistral:7b");
    expect(plan.source).toBe("chosen");
    expect(plan.download).toBeNull();
  });

  it("reverts to automatic when the pinned model has been removed", () => {
    // Deleting a model is not a request to download it again.
    const plan = planTalkModel({
      override: "mistral:7b",
      installed: ["qwen3:1.7b"],
      vram: 4,
    });

    expect(plan.model).toBe("qwen3:1.7b");
    expect(plan.source).toBe("sized");
    expect(plan.download).toBeNull();
  });

  it("treats blank and whitespace as automatic", () => {
    for (const override of ["", "   ", undefined]) {
      const plan = planTalkModel({ override, installed: [], vram: 2 });
      expect(plan.source).toBe("sized");
      expect(plan.model).toBe("llama3.2:1b");
    }
  });
});

function pullStream(lines: unknown[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= lines.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(JSON.stringify(lines[index++]) + "\n"));
    },
  });
}

describe("fetching the planned model", () => {
  it("does nothing when there is nothing to fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provided = await provideTalkModel(
      { model: "qwen3:4b", tier: null, source: "sized", download: null },
      { fallback: "llama3.1:8b" },
    );

    expect(provided).toEqual({ model: "qwen3:4b", substituted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports progress across the download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            pullStream([
              { status: "pulling manifest" },
              { status: "pulling abc", digest: "abc", total: 100, completed: 50 },
              { status: "pulling abc", digest: "abc", total: 100, completed: 100 },
              { status: "success" },
            ]),
            { status: 200 },
          ),
      ),
    );

    const seen: number[] = [];
    const provided = await provideTalkModel(
      {
        model: "qwen3:4b",
        tier: null,
        source: "sized",
        download: TALK_TIERS[4],
      },
      { fallback: "llama3.1:8b", onProgress: (p) => seen.push(p.percent) },
    );

    expect(provided).toEqual({ model: "qwen3:4b", substituted: false });
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("falls back to the chat model when the download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );

    const provided = await provideTalkModel(
      {
        model: "qwen3:4b",
        tier: null,
        source: "sized",
        download: TALK_TIERS[4],
      },
      { fallback: "llama3.1:8b" },
    );

    // A failed download loses the better model, not the conversation.
    expect(provided).toEqual({ model: "llama3.1:8b", substituted: true });
  });

  it("gives up when there is no chat model to fall back to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );

    await expect(
      provideTalkModel(
        {
          model: "qwen3:4b",
          tier: null,
          source: "sized",
          download: TALK_TIERS[4],
        },
        { fallback: "" },
      ),
    ).rejects.toThrow();
  });
});
