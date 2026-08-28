import { describe, it, expect } from "vitest";
import {
  cannotGenerate,
  chatBlock,
  countUsable,
  isChatModel,
  isEmbeddingModel,
  isHelperModel,
  selectableChatModelNames,
  selectableChatModels,
} from "../modelKinds";

describe("spotting a model that only makes embeddings", () => {
  it("recognises the usual embedding families", () => {
    for (const name of [
      "nomic-embed-text:latest",
      "mxbai-embed-large",
      "bge-m3",
      "all-minilm:l6-v2",
      "snowflake-arctic-embed2",
    ]) {
      expect(isEmbeddingModel(name), name).toBe(true);
    }
  });

  it("does not mistake an ordinary model for one", () => {
    for (const name of ["qwen3.5:9b", "llama3.2:1b", "phi4", "gemma4:12b"]) {
      expect(isEmbeddingModel(name), name).toBe(false);
    }
  });
});

describe("spotting a helper-sized model", () => {
  it("recognises the ones the app itself uses as helpers", () => {
    for (const name of ["llama3.2:1b", "qwen3:0.6b", "smollm2:360m", "qwen3:1.7b"]) {
      expect(isHelperModel(name), name).toBe(true);
    }
  });

  it("matches a quantised tag of the same model", () => {
    expect(isHelperModel("llama3.2:1b-instruct-q4_K_M")).toBe(true);
  });

  it("leaves real chat models alone", () => {
    for (const name of ["qwen3.5:9b", "qwen3:8b", "phi4", "llama3.2:3b"]) {
      expect(isHelperModel(name), name).toBe(false);
    }
  });
});

describe("deciding what may be chosen for chat", () => {
  it("never offers an embedding model, whatever else is installed", () => {
    expect(chatBlock("nomic-embed-text:latest", 5)).toBe("embedding");
    expect(chatBlock("nomic-embed-text:latest", 0)).toBe("embedding");
  });

  it("hides a helper when there is something better installed", () => {
    expect(chatBlock("llama3.2:1b", 1)).toBe("helper");
    expect(isChatModel("llama3.2:1b", 1)).toBe(false);
  });

  it("still offers a helper when it is the only thing that could answer", () => {
    // A machine with very little memory is recommended exactly these models,
    // so refusing to run them would leave it with no assistant at all.
    expect(chatBlock("qwen3:0.6b", 0)).toBeNull();
    expect(isChatModel("smollm2:360m", 0)).toBe(true);
  });

  it("offers an ordinary model in every case", () => {
    expect(chatBlock("qwen3.5:9b", 0)).toBeNull();
    expect(chatBlock("qwen3.5:9b", 4)).toBeNull();
  });
});

describe("counting what could be a main model", () => {
  it("ignores helpers and embedders", () => {
    expect(
      countUsable(["qwen3.5:9b", "llama3.2:1b", "nomic-embed-text:latest"]),
    ).toBe(1);
  });

  it("reports none when only helpers are installed", () => {
    expect(countUsable(["llama3.2:1b", "nomic-embed-text:latest"])).toBe(0);
  });
});

describe("narrowing an installed list for a picker", () => {
  const model = (name: string) => ({ name, size: 1, parameterSize: "", family: "" });

  it("drops the helper and the embedder from the user's own list", () => {
    // Exactly the list in the report: a real model plus these two.
    const offered = selectableChatModels([
      model("qwen3.5:9b"),
      model("llama3.2:1b"),
      model("nomic-embed-text:latest"),
    ]);

    expect(offered.map((entry) => entry.name)).toEqual(["qwen3.5:9b"]);
  });

  it("keeps the small model when it is all there is", () => {
    const offered = selectableChatModels([
      model("llama3.2:1b"),
      model("nomic-embed-text:latest"),
    ]);

    expect(offered.map((entry) => entry.name)).toEqual(["llama3.2:1b"]);
  });

  it("never returns an embedding model, even alone", () => {
    expect(selectableChatModels([model("nomic-embed-text:latest")])).toEqual([]);
  });

  it("leaves a healthy list untouched", () => {
    const names = ["qwen3.5:9b", "phi4", "gemma4:12b"];
    expect(selectableChatModelNames(names)).toEqual(names);
  });

  it("copes with nothing installed", () => {
    expect(selectableChatModels([])).toEqual([]);
    expect(selectableChatModelNames([])).toEqual([]);
  });
});

describe("using the capabilities Ollama reports", () => {
  it("treats a model with no completion capability as unable to chat", () => {
    expect(cannotGenerate(["embedding"])).toBe(true);
  });

  it("accepts one that can complete", () => {
    expect(cannotGenerate(["completion", "tools"])).toBe(false);
  });

  it("says nothing when the capabilities are unknown", () => {
    expect(cannotGenerate(undefined)).toBe(false);
    expect(cannotGenerate([])).toBe(false);
  });
});
