import { describe, it, expect } from "vitest";
import {
  cannotGenerate,
  isEmbeddingModel,
  selectableModels,
} from "../modelKinds";

/** The capability lists Ollama actually reports, by kind of model. */
const CHAT = ["completion", "tools", "insert"];
const REASONING = ["completion", "tools", "thinking", "vision"];
const EMBEDDER = ["embedding"];

describe("reading what a model says it can do", () => {
  it("rules out a model that cannot complete text", () => {
    expect(cannotGenerate(EMBEDDER)).toBe(true);
  });

  it("accepts anything that can complete, whatever else it does", () => {
    expect(cannotGenerate(CHAT)).toBe(false);
    expect(cannotGenerate(REASONING)).toBe(false);
    expect(cannotGenerate(["completion"])).toBe(false);
  });

  it("treats an unanswered question as no objection", () => {
    // /api/show can fail, and a model the user has installed is better offered
    // in error than hidden in error.
    expect(cannotGenerate(undefined)).toBe(false);
    expect(cannotGenerate([])).toBe(false);
  });
});

describe("spotting a model that can index the library", () => {
  it("recognises an embedder by what it reports, not by its name", () => {
    expect(isEmbeddingModel(EMBEDDER)).toBe(true);
    // A model whose name says nothing is still found.
    expect(isEmbeddingModel(["embedding"])).toBe(true);
  });

  it("refuses a chat model, which would index to meaningless vectors", () => {
    expect(isEmbeddingModel(CHAT)).toBe(false);
    expect(isEmbeddingModel(REASONING)).toBe(false);
  });

  it("refuses a model it could not ask", () => {
    expect(isEmbeddingModel(undefined)).toBe(false);
    expect(isEmbeddingModel([])).toBe(false);
  });
});

describe("narrowing an installed list for a picker", () => {
  const model = (name: string, capabilities: string[]) => ({
    name,
    size: 1,
    parameterSize: "",
    family: "",
    capabilities,
  });

  it("drops the embedder and keeps everything else", () => {
    const offered = selectableModels([
      model("qwen3.5:9b", CHAT),
      model("llama3.2:1b", CHAT),
      model("nomic-embed-text:latest", EMBEDDER),
    ]);

    expect(offered.map((entry) => entry.name)).toEqual([
      "qwen3.5:9b",
      "llama3.2:1b",
    ]);
  });

  it("goes by capabilities, not by a name that looks like an embedder", () => {
    // The old name test hid this one; it completes text, so it is offerable.
    const offered = selectableModels([model("embedded-coder:7b", CHAT)]);
    expect(offered.map((entry) => entry.name)).toEqual(["embedded-coder:7b"]);
  });

  it("catches an embedder the name would have missed", () => {
    expect(selectableModels([model("my-own-vectors:latest", EMBEDDER)])).toEqual(
      [],
    );
  });

  it("offers a model whose capabilities could not be read", () => {
    const offered = selectableModels([model("something-custom", [])]);
    expect(offered.map((entry) => entry.name)).toEqual(["something-custom"]);
  });

  it("copes with nothing installed", () => {
    expect(selectableModels([])).toEqual([]);
  });
});
