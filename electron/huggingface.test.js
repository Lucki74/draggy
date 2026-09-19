import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const huggingface = require("./huggingface.cjs");

describe("curated models registry", () => {
  it("ships curated premier open models with capabilities and variants", () => {
    expect(huggingface.CURATED_MODELS.length).toBeGreaterThanOrEqual(7);
    for (const model of huggingface.CURATED_MODELS) {
      expect(model.name).toBeTruthy();
      expect(model.description).toBeTruthy();
      expect(Array.isArray(model.capabilities)).toBe(true);
      expect(model.sizes.length).toBeGreaterThan(0);
      for (const size of model.sizes) {
        expect(model.variants[size]).toBeDefined();
        expect(model.variants[size].repo).toContain("/");
        expect(model.variants[size].file).toMatch(/\.gguf$/i);
        expect(model.variants[size].bytes).toBeGreaterThan(0);
      }
    }
  });

  it("filters curated models matching query substring", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const matches = await huggingface.searchHuggingFace("deepseek");
    expect(matches.some((m) => m.name === "deepseek-r1")).toBe(true);
    const llamaMatches = await huggingface.searchHuggingFace("llama");
    expect(llamaMatches.some((m) => m.name === "llama3.1")).toBe(true);
  });
});

const item = (id, extra = {}) => ({ id, pipeline_tag: "text-generation", tags: ["gguf"], ...extra });

const mockApi = (items) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => items });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("searching with an empty query", () => {
  beforeEach(() => huggingface.resetSearchCache());
  afterEach(() => vi.unstubAllGlobals());

  it("asks the API for the trending GGUF models instead of a fixed list", async () => {
    const fetchMock = mockApi([item("bartowski/Meta-Llama-3.1-8B-Instruct-GGUF")]);
    const models = await huggingface.searchHuggingFace("   ");

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("filter=gguf");
    expect(url).toContain("sort=trendingScore&direction=-1&limit=100");
    for (const field of ["cardData", "baseModels", "gguf"]) expect(url).toContain(`expand[]=${field}`);
    expect(models).toHaveLength(1);
    expect(models.length).not.toBe(huggingface.CURATED_MODELS.length);
  });

  it("serves repeated empty searches from memory", async () => {
    const fetchMock = mockApi([item("Qwen/Qwen2.5-7B-Instruct-GGUF")]);
    const first = await huggingface.searchHuggingFace("");
    const second = await huggingface.searchHuggingFace("");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("shares one request between searches that overlap", async () => {
    const fetchMock = mockApi([item("Qwen/Qwen2.5-7B-Instruct-GGUF")]);
    await Promise.all([huggingface.searchHuggingFace(""), huggingface.searchHuggingFace("")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next search tries again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await huggingface.searchHuggingFace("")).toEqual([]);

    const fetchMock = mockApi([item("Qwen/Qwen2.5-7B-Instruct-GGUF")]);
    expect(await huggingface.searchHuggingFace("")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lists speech, detection and image repos with the kind of model they are", async () => {
    mockApi([
      item("audio-cpp/audio.cpp-gguf", { pipeline_tag: "text-to-speech" }),
      item("mudler/locate-anything.cpp-gguf", { pipeline_tag: "object-detection" }),
      item("city96/FLUX.1-dev-gguf", { pipeline_tag: "text-to-image" }),
      item("someone/brand-new-task-gguf", { pipeline_tag: "a-task-made-up-next-year" }),
      item("bartowski/phi-4-GGUF"),
    ]);
    const models = await huggingface.searchHuggingFace("");
    const byRepo = Object.fromEntries(models.map((m) => [m.repo, m.capabilities]));

    expect(byRepo["audio-cpp/audio.cpp-gguf"]).toEqual(["text-to-speech"]);
    expect(byRepo["mudler/locate-anything.cpp-gguf"]).toEqual(["image-analysis"]);
    expect(byRepo["city96/FLUX.1-dev-gguf"]).toEqual(["image-generation"]);
    expect(byRepo["someone/brand-new-task-gguf"]).toEqual(["other"]);
    expect(byRepo["bartowski/phi-4-GGUF"]).toContain("completion");
  });

  it("describes a model that does not chat by its type, not as a language model", async () => {
    mockApi([item("city96/FLUX.1-dev-gguf", { pipeline_tag: "text-to-image" })]);
    const [flux] = await huggingface.searchHuggingFace("");

    expect(flux.description).toMatch(/^Image generation model/);
  });
});

describe("model types", () => {
  // Every task Hugging Face defines for models, as of its task list.
  const HUGGING_FACE_TASKS = [
    "text-classification", "token-classification", "table-question-answering", "question-answering",
    "zero-shot-classification", "translation", "summarization", "feature-extraction", "text-generation",
    "fill-mask", "sentence-similarity", "text-ranking", "text-to-speech", "text-to-audio",
    "automatic-speech-recognition", "audio-to-audio", "audio-classification", "voice-activity-detection",
    "depth-estimation", "image-classification", "object-detection", "image-segmentation", "text-to-image",
    "image-to-text", "image-to-image", "image-to-video", "unconditional-image-generation", "video-classification",
    "text-to-video", "zero-shot-image-classification", "mask-generation", "zero-shot-object-detection",
    "text-to-3d", "image-to-3d", "image-feature-extraction", "keypoint-detection", "visual-question-answering",
    "document-question-answering", "reinforcement-learning", "robotics", "tabular-classification",
    "tabular-regression", "time-series-forecasting", "graph-ml", "text2text-generation", "conversational",
    "image-text-to-text", "video-text-to-text", "audio-text-to-text", "any-to-any", "multiple-choice",
    "text-retrieval", "visual-document-retrieval",
  ];

  it("gives every task a type, or none when the model chats", () => {
    for (const task of HUGGING_FACE_TASKS) {
      const type = huggingface.typeOfTask(task);
      if (type !== null) expect(huggingface.TYPE_LABELS, task).toHaveProperty(type);
    }
  });

  it("leaves chat and vision-language models untyped, and names the rest", () => {
    for (const task of ["text-generation", "text2text-generation", "conversational", "audio-text-to-text"]) {
      expect(huggingface.typeOfTask(task)).toBeNull();
    }
    for (const task of ["image-text-to-text", "video-text-to-text", "any-to-any", "visual-question-answering"]) {
      expect(huggingface.typeOfTask(task)).toBeNull();
    }
    expect(huggingface.typeOfTask("")).toBeNull();
    expect(huggingface.typeOfTask("text-to-image")).toBe("image-generation");
    expect(huggingface.typeOfTask("automatic-speech-recognition")).toBe("speech-recognition");
    expect(huggingface.typeOfTask("feature-extraction")).toBe("embedding");
    expect(huggingface.typeOfTask("something-new")).toBe("other");
  });

  it("uses only types that have a label", () => {
    for (const type of new Set(Object.values(huggingface.TASK_TYPES))) {
      expect(huggingface.TYPE_LABELS, type).toHaveProperty(type);
    }
  });
});

describe("model titles", () => {
  beforeEach(() => huggingface.resetSearchCache());
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clean name and keeps the repo for resolving", async () => {
    mockApi([
      item("bartowski/Meta-Llama-3.1-8B-Instruct-GGUF"),
      item("mixedbread-ai/mxbai-embed-large-v1", { pipeline_tag: "feature-extraction" }),
    ]);
    const [llama, embed] = await huggingface.searchHuggingFace("");

    expect(llama.name).toBe("Meta-Llama-3.1-8B-Instruct");
    expect(llama.repo).toBe("bartowski/Meta-Llama-3.1-8B-Instruct-GGUF");
    expect(embed.name).toBe("mxbai-embed-large-v1");
  });

  it("still resolves a download from the repo id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ path: "m-Q4_K_M.gguf", size: 123 }],
      }),
    );
    const resolved = await huggingface.resolveModelDownload("bartowski/Some-Model-GGUF:Q4_K_M");
    expect(resolved.url).toContain("huggingface.co/bartowski/Some-Model-GGUF/resolve/main/m-Q4_K_M.gguf");
  });
});

describe("model descriptions", () => {
  beforeEach(() => huggingface.resetSearchCache());
  afterEach(() => vi.unstubAllGlobals());

  const describeAll = async (items) => {
    mockApi(items);
    return huggingface.searchHuggingFace("");
  };

  it("uses a canonical blurb for popular families", async () => {
    const models = await describeAll([
      item("bartowski/Meta-Llama-3.1-8B-Instruct-GGUF"),
      item("bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF"),
      item("unsloth/Qwen3-30B-A3B-GGUF"),
      item("bartowski/phi-4-GGUF"),
      item("bartowski/gemma-2-9b-it-GGUF"),
      item("ibm-granite/granite-3.3-8b-instruct-GGUF"),
      item("openbmb/MiniCPM4-8B-GGUF"),
      item("bartowski/Mistral-7B-Instruct-v0.3-GGUF"),
      item("CohereLabs/c4ai-command-a-03-2025-GGUF"),
    ]);
    const text = models.map((m) => m.description);

    expect(text[0]).toContain("Llama 3.1");
    expect(text[1]).toContain("DeepSeek-R1");
    expect(text[2]).toContain("Qwen3");
    expect(text[3]).toContain("Phi-4");
    expect(text[4]).toContain("Gemma 2");
    expect(text[5]).toContain("Granite");
    expect(text[6]).toContain("MiniCPM");
    expect(text[7]).toContain("Mistral");
    expect(text[8]).toContain("Cohere North");
    expect(text[0]).toContain("GGUF by bartowski");
  });

  it("builds a description for community models from what the card says", async () => {
    const [model] = await describeAll([
      item("ornith-ai/Ornith-1.5-9B-GGUF", {
        pipeline_tag: "image-text-to-text",
        tags: ["gguf", "coding", "moe"],
        cardData: { base_model: ["ornith-ai/Ornith-1.5"] },
        baseModels: { relation: "finetune", models: [{ id: "ornith-ai/Ornith-1.5" }] },
      }),
    ]);

    expect(model.description).toBe(
      "Vision-language model with 9B parameters, fine-tuned from ornith-ai/Ornith-1.5. GGUF by ornith-ai. Tagged coding, mixture-of-experts.",
    );
  });

  it("does not stamp Qwen-based community models with the stock Qwen3 blurb", async () => {
    const models = await describeAll([
      item("prism-ml/Ternary-Bonsai-2-27B-gguf", { cardData: { base_model: ["Qwen/Qwen3.8-27B"] } }),
      item("ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF", { cardData: { base_model: ["Qwen/Qwen3.8-27B"] } }),
    ]);

    expect(models[0].description).toContain("based on Qwen/Qwen3.8-27B");
    expect(models[0].description).toContain("GGUF by prism-ml");
    for (const model of models) expect(model.description).not.toContain("Alibaba's Qwen3 generation");
  });

  it("falls back to the GGUF parameter count and never uses the old placeholder", async () => {
    const [model] = await describeAll([item("someone/Odd-Model-GGUF", { gguf: { total: 8953803264 } })]);
    expect(model.description).toContain("9.0B parameters");
    expect(model.description).not.toContain("GGUF model repository on Hugging Face");
  });
});

describe("available quantizations", () => {
  const siblings = (...names) => names.map((rfilename) => ({ rfilename }));

  it("lists the quants a repo really has and skips projector and imatrix files", () => {
    const sizes = huggingface.extractAvailableSizes(
      siblings(
        "README.md",
        "Ternary-Bonsai-2-27B-F16.gguf",
        "Ternary-Bonsai-2-27B-PQ2_0.gguf",
        "Ternary-Bonsai-2-27B-PTQ1_0.gguf",
        "Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf",
        "Ternary-Bonsai-2-27B-imatrix-Q5_K_M.gguf",
      ),
    );
    expect(sizes).toEqual(["PQ2_0", "PTQ1_0", "F16"]);
  });

  it("puts preferred quants first, strips shard suffixes and caps the list at five", () => {
    const sizes = huggingface.extractAvailableSizes(
      siblings(
        "m-Q8_0-00001-of-00002.gguf",
        "m-Q8_0-00002-of-00002.gguf",
        "m-Q4_K_M.gguf",
        "m-Q4_K_XL.gguf",
        "m-Q6_K.gguf",
        "m-Q3_K_L.gguf",
        "m-Q2_K.gguf",
      ),
    );
    expect(sizes).toEqual(["Q4_K_M", "Q8_0", "Q6_K", "Q4_K_XL", "Q3_K_L"]);
  });

  it("reads quants from folder names and falls back to the old trio without siblings", () => {
    expect(huggingface.extractAvailableSizes(siblings("IQ2_XS/model.gguf", "Q2_0/model.gguf"))).toEqual(["IQ2_XS", "Q2_0"]);
    expect(huggingface.extractAvailableSizes(undefined)).toEqual(["Q4_K_M", "Q5_K_M", "Q8_0"]);
    expect(huggingface.extractAvailableSizes([])).toEqual(["Q4_K_M", "Q5_K_M", "Q8_0"]);
  });

  it("offers the real quants on a library entry", async () => {
    huggingface.resetSearchCache();
    mockApi([item("prism-ml/Ternary-Bonsai-2-27B-gguf", { siblings: siblings("a-PQ2_0.gguf", "a-F16.gguf") })]);
    const [model] = await huggingface.searchHuggingFace("");
    vi.unstubAllGlobals();
    expect(model.sizes).toEqual(["PQ2_0", "F16"]);
  });
});

describe("capability badges", () => {
  beforeEach(() => huggingface.resetSearchCache());
  afterEach(() => vi.unstubAllGlobals());

  const capabilitiesOf = async (extra, id = "someone/Plain-Model-GGUF") => {
    huggingface.resetSearchCache();
    mockApi([item(id, extra)]);
    return (await huggingface.searchHuggingFace(""))[0].capabilities;
  };

  it("reads tool support from the chat template", async () => {
    const withTools = await capabilitiesOf({ gguf: { chat_template: "{% if tools %}{{ tools }}{% endif %}" } });
    const without = await capabilitiesOf({ gguf: { chat_template: "{{ messages }}" } });
    expect(withTools).toContain("tools");
    expect(without).not.toContain("tools");
  });

  it("flags thinking models by template, tag or name", async () => {
    expect(await capabilitiesOf({ gguf: { chat_template: "<think>" } })).toContain("thinking");
    expect(await capabilitiesOf({ tags: ["reasoning"] })).toContain("thinking");
    expect(await capabilitiesOf({}, "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF")).toContain("thinking");
    expect(await capabilitiesOf({}, "unsloth/Inkling-Small-GGUF")).not.toContain("thinking");
  });

  it("flags vision from the pipeline tag", async () => {
    expect(await capabilitiesOf({ pipeline_tag: "image-text-to-text" })).toContain("vision");
    expect(await capabilitiesOf({})).not.toContain("vision");
  });

  it("reports embedding models as embedding only", async () => {
    expect(await capabilitiesOf({ pipeline_tag: "feature-extraction" })).toEqual(["embedding"]);
  });
});

describe("searching with a query", () => {
  beforeEach(() => huggingface.resetSearchCache());
  afterEach(() => vi.unstubAllGlobals());

  it("returns curated matches first, then titled remote results", async () => {
    const fetchMock = mockApi([item("bartowski/Llama-3.2-3B-Instruct-GGUF")]);
    const models = await huggingface.searchHuggingFace("llama");

    expect(fetchMock.mock.calls[0][0]).toContain("search=llama");
    expect(models[0].name).toBe("llama3.1");
    expect(models.at(-1).name).toBe("Llama-3.2-3B-Instruct");
    expect(models.at(-1).repo).toBe("bartowski/Llama-3.2-3B-Instruct-GGUF");
  });
});

const treeOf = (files) => files.map(([path, size]) => ({ type: "file", path, size }));

const mockTree = (files) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => treeOf(files) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("repo file matching", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the whole tree and ignores projector files when sizing a quant", async () => {
    const fetchMock = mockTree([
      ["Bonsai-F16.gguf", 50_100_000_000],
      ["Bonsai-mmproj-Q8_0.gguf", 600_000_000],
      ["Bonsai-Q8_0.gguf", 28_000_000_000],
    ]);
    const size = await huggingface.fetchModelSize("acme/Bonsai-gguf", "Q8_0");

    expect(fetchMock.mock.calls[0][0]).toContain("/tree/main?recursive=true");
    expect(size).toEqual({ success: true, bytes: 28_000_000_000 });
  });

  it("finds quants held in sub-folders", async () => {
    mockTree([
      ["mmproj-F16.gguf", 800_000_000],
      ["IQ2_XS/Flash-IQ2_XS.gguf", 9_000_000_000],
      ["Q2_0/Flash-Q2_0.gguf", 11_000_000_000],
    ]);
    expect(await huggingface.fetchModelSize("acme/Flash-GGUF", "IQ2_XS")).toEqual({ success: true, bytes: 9_000_000_000 });
    const resolved = await huggingface.resolveModelDownload("acme/Flash-GGUF:Q2_0");
    expect(resolved.url).toContain("/resolve/main/Q2_0/Flash-Q2_0.gguf");
    expect(resolved.filename).toBe("Flash-Q2_0.gguf");
  });

  it("sums the shards of a split model and prefers the plain file over -mtp", async () => {
    mockTree([
      ["big-Q4_K_M-00001-of-00002.gguf", 30],
      ["big-Q4_K_M-00002-of-00002.gguf", 12],
      ["small-Q5_K_M-mtp.gguf", 99],
      ["small-Q5_K_M.gguf", 7],
    ]);
    const big = await huggingface.resolveModelDownload("acme/Big-GGUF:Q4_K_M");
    expect(big).toMatchObject({ filename: "big-Q4_K_M-00001-of-00002.gguf", size: 42 });
    expect((await huggingface.resolveModelDownload("acme/Small-GGUF:Q5_K_M")).size).toBe(7);
  });

  it("never takes a multi-token-prediction draft head for the model", async () => {
    // Laid out like unsloth/gemma-4-26B-A4B-it-GGUF: the draft heads carry the same quant names.
    mockTree([
      ["MTP/mtp-gemma-4-26B-A4B-it-Q8_0.gguf", 460_000_000],
      ["mtp-gemma-4-26B-A4B-it.gguf", 460_000_000],
      ["gemma-4-26B-A4B-it-Q8_0.gguf", 26_860_000_000],
      ["gemma-4-26B-A4B-it-UD-Q4_K_M.gguf", 16_950_000_000],
      ["mmproj-F16.gguf", 1_190_000_000],
    ]);

    expect(await huggingface.fetchModelSize("unsloth/gemma-4-GGUF", "Q8_0")).toEqual({
      success: true,
      bytes: 26_860_000_000,
    });
    const resolved = await huggingface.resolveModelDownload("unsloth/gemma-4-GGUF:Q8_0");
    expect(resolved.filename).toBe("gemma-4-26B-A4B-it-Q8_0.gguf");
    expect(resolved.url).not.toContain("mtp");
  });

  it("does not offer a quantization that only a draft head has", async () => {
    mockTree([
      ["MTP/mtp-model-F16.gguf", 900_000_000],
      ["model-Q4_K_M.gguf", 5_000_000_000],
    ]);

    expect(await huggingface.fetchModelSize("acme/Draft-GGUF", "F16")).toMatchObject({ success: false });
    expect((await huggingface.fetchModelSize("acme/Draft-GGUF", "Q4_K_M")).bytes).toBe(5_000_000_000);
    expect(
      huggingface.extractAvailableSizes([
        { rfilename: "MTP/mtp-model-F16.gguf" },
        { rfilename: "mtp-model.gguf" },
        { rfilename: "model-Q4_K_M.gguf" },
      ]),
    ).toEqual(["Q4_K_M"]);
  });

  it("does not let Q2_0 pick up a PQ2_0 file", async () => {
    mockTree([["m-PQ2_0.gguf", 5]]);
    expect(await huggingface.resolveModelDownload("acme/PQ-GGUF:Q2_0")).toBeNull();
  });

  it("never falls back to the first file when the quant is missing", async () => {
    mockTree([["Bonsai-F16.gguf", 50_100_000_000]]);
    expect(await huggingface.fetchModelSize("acme/Missing-GGUF", "Q4_K_M")).toEqual({
      success: false,
      error: "Size lookup unavailable",
    });
    expect(await huggingface.resolveModelDownload("acme/Missing-GGUF:Q4_K_M")).toBeNull();
  });
});

describe("model size lookups", () => {
  it("resolves exact byte sizes for curated model variants", async () => {
    const size = await huggingface.fetchModelSize("llama3.1", "8b");
    expect(size.success).toBe(true);
    expect(size.bytes).toBe(4920733696);
  });

  it("returns error for unknown variant without crashing", async () => {
    const size = await huggingface.fetchModelSize("nonexistent-model", "999b");
    expect(size.success).toBe(false);
  });
});

describe("resolving model download URLs", () => {
  it("resolves curated reference to Hugging Face direct resolve URL", async () => {
    const resolved = await huggingface.resolveModelDownload("llama3.1:8b");
    expect(resolved).toBeDefined();
    expect(resolved.filename).toBe("Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf");
    expect(resolved.url).toContain("huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/");
    expect(resolved.url).toContain("download=true");
    expect(resolved.size).toBe(4920733696);
  });

  it("defaults to the first variant if tag is unspecified or latest", async () => {
    const resolved = await huggingface.resolveModelDownload("phi-4");
    expect(resolved).toBeDefined();
    expect(resolved.filename).toBe("phi-4-Q4_K_M.gguf");
  });

  it("returns null for unresolved unknown reference", async () => {
    const resolved = await huggingface.resolveModelDownload("nonexistent-model:xyz");
    expect(resolved).toBeNull();
  });
});
