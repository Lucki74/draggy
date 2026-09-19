import { describe, expect, it } from "vitest";
import { EMBED_TIERS, isEmbedModel, planEmbedModel, tierForEmbed, tierOfEmbed } from "../embedModel";

describe("sizing the embedding model to the machine", () => {
  it("climbs the ladder as memory grows", () => {
    expect(tierForEmbed(0).model).toBe("all-minilm");
    expect(tierForEmbed(0.5).model).toBe("all-minilm");
    expect(tierForEmbed(1).model).toBe("embeddinggemma-300m");
    expect(tierForEmbed(2).model).toBe("nomic-embed-text");
    expect(tierForEmbed(3.5).model).toBe("mxbai-embed-large");
    expect(tierForEmbed(4).model).toBe("bge-m3");
    expect(tierForEmbed(7).model).toBe("qwen3-embedding-0.6b");
    expect(tierForEmbed(10).model).toBe("qwen3-embedding-4b");
    expect(tierForEmbed(20).model).toBe("qwen3-embedding-8b");
    expect(tierForEmbed(96).model).toBe("qwen3-embedding-8b");
  });

  it("falls to the smallest rung when the card cannot be read", () => {
    expect(tierForEmbed(0).model).toBe(EMBED_TIERS[0].model);
    expect(tierForEmbed(Number.NaN).model).toBe(EMBED_TIERS[0].model);
    expect(tierForEmbed(-4).model).toBe(EMBED_TIERS[0].model);
  });

  it("only rises, never falls, as memory grows", () => {
    let last = -1;
    for (const tier of EMBED_TIERS) {
      expect(tier.vram).toBeGreaterThan(last);
      last = tier.vram;
    }
  });

  it("names the rung a model belongs to", () => {
    expect(tierOfEmbed("mxbai-embed-large")?.label).toBe("MxBai Embed Large");
    expect(tierOfEmbed("mistral")).toBeNull();
  });

  it("never asks for more than what a 400-chunk file can pay back in ten seconds", () => {
    // No hard numbers to check here, just that nothing above the tested
    // top rung sneaks in unreasoned about.
    expect(EMBED_TIERS[EMBED_TIERS.length - 1].model).toBe("qwen3-embedding-8b");
  });

  it("gives every rung something the downloader can resolve, never a bare name", () => {
    for (const tier of EMBED_TIERS) expect(tier.reference).toMatch(/^[\w.-]+\/[\w.-]+:[\w]+$/);
  });
});

describe("planning what indexing will run", () => {
  it("uses the sized model when it is already installed", () => {
    const plan = planEmbedModel({ installed: ["mxbai-embed-large-v1.Q8_0.gguf"], vram: 3.5 });

    expect(plan.model).toBe("mxbai-embed-large-v1.Q8_0.gguf");
    expect(plan.source).toBe("sized");
    expect(plan.download).toBeNull();
  });

  it("asks for a download when the sized model is missing", () => {
    const plan = planEmbedModel({ installed: ["llama3.2:3b"], vram: 3.5 });

    expect(plan.model).toBe("mxbai-embed-large");
    expect(plan.download?.model).toBe("mxbai-embed-large");
    expect(plan.download?.reference).toBe("ChristianAzinn/mxbai-embed-large-v1-gguf:Q8_0");
    expect(plan.download?.downloadGB).toBeGreaterThan(0);
  });

  it("honours a model the user pinned", () => {
    const plan = planEmbedModel({
      override: "bge-m3",
      installed: ["bge-m3", "nomic-embed-text"],
      vram: 6,
    });

    expect(plan.model).toBe("bge-m3");
    expect(plan.source).toBe("chosen");
    expect(plan.download).toBeNull();
  });

  it("reverts to automatic when the pinned model has been removed", () => {
    const plan = planEmbedModel({
      override: "bge-m3",
      installed: ["nomic-embed-text"],
      vram: 2,
    });

    expect(plan.model).toBe("nomic-embed-text");
    expect(plan.source).toBe("sized");
    expect(plan.download).toBeNull();
  });

  it("treats blank and whitespace as automatic", () => {
    for (const override of ["", "   ", undefined]) {
      const plan = planEmbedModel({ override, installed: [], vram: 0 });
      expect(plan.source).toBe("sized");
      expect(plan.model).toBe("all-minilm");
    }
  });

  it("matches a re-quantised build already on disk", () => {
    const plan = planEmbedModel({
      installed: ["Qwen3-Embedding-0.6B-Q8_0.gguf"],
      vram: 7,
    });

    expect(plan.model).toBe("Qwen3-Embedding-0.6B-Q8_0.gguf");
    expect(plan.download).toBeNull();
  });
});

describe("telling an embedding download from a chat one", () => {
  it("recognises the tiers and a pinned override", () => {
    expect(isEmbedModel("nomic-embed-text")).toBe(true);
    expect(isEmbedModel("all-minilm")).toBe(true);
    expect(isEmbedModel("my-custom-vectors", "My-Custom-Vectors ")).toBe(true);
  });

  it("recognises embedding families by name", () => {
    expect(isEmbedModel("bge-m3")).toBe(true);
  });

  it("rejects chat and code models", () => {
    expect(isEmbedModel("ornith-ai/Ornith-1.5-35B-A3B-GGUF:Q4_K_M")).toBe(false);
    expect(isEmbedModel("phi-4-Q4_K_M.gguf")).toBe(false);
    expect(isEmbedModel("qwen3:8b")).toBe(false);
    expect(isEmbedModel("qwen3:8b", "bge-m3")).toBe(false);
  });
});
