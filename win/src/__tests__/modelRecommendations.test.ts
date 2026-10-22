import { describe, expect, it } from "vitest";
import {
  chipClassOf,
  getRecommendedDownload,
  getRecommendedModel,
  ggufLadder,
  CPU_ONLY_DENSE_CAP_GB,
  ladderFor,
  mlxLadder,
  modelRecommendations,
  rungFits,
  supportsMlx,
  USABLE_UNIFIED_RAM_FRACTION,
} from "../modelRecommendations";

const MAC = { platform: "darwin", arch: "arm64", llamaVersion: "0.33.3" };

const ladders = [
  { name: "gguf", ladder: ggufLadder, target: {} },
  { name: "mlx", ladder: mlxLadder, target: MAC },
];

const labelOf = (model: string) => ggufLadder.find((entry) => entry.model === model)?.label;
const indexOf = (model: string) => ggufLadder.findIndex((entry) => entry.model === model);

describe.each(ladders)("sizing the first-launch model ($name)", ({ ladder, target }) => {
  const smallest = ladder[0];

  it("gives a machine with no usable graphics memory the smallest model", () => {
    expect(getRecommendedModel(0, target)).toBe(smallest.model);
  });

  it("does the same below the bottom rung", () => {
    expect(getRecommendedModel(smallest.vram / 2, target)).toBe(smallest.model);
  });

  it("copes with a card it could not measure", () => {
    expect(getRecommendedModel(Number.NaN, target)).toBe(smallest.model);
    expect(getRecommendedModel(-1, target)).toBe(smallest.model);
  });

  it("never recommends a rung the machine cannot run", () => {
    for (let vram = 0; vram <= 128; vram += 0.25) {
      const chosen = ladder.find((entry) => entry.model === getRecommendedModel(vram, target))!;
      if (chosen === smallest) continue;
      expect(rungFits(chosen, vram, target), `${vram} GB chose ${chosen.label}`).toBe(true);
    }
  });

  it("only ever climbs as the memory grows", () => {
    let previous = -1;
    for (let vram = 0; vram <= 600; vram += 0.25) {
      const rung = indexOf(getRecommendedModel(vram, target));
      expect(rung, `${vram} GB`).toBeGreaterThanOrEqual(previous);
      previous = rung;
    }
  });

  it("never picks a rung that waits on upstream llama.cpp", () => {
    for (let vram = 0; vram <= 1024; vram += 8) {
      const chosen = ladder[indexOf(getRecommendedModel(vram, { ...target, ram: vram }))];
      expect(chosen.pending, chosen.label).toBe(false);
    }
  });
});

describe("choosing between the two ladders", () => {
  it("leaves an Intel Mac on the GGUF builds", () => {
    // MLX is Apple's framework for Apple's silicon. There is no unified memory
    // on an Intel Mac and no MLX runtime to use it.
    expect(supportsMlx({ ...MAC, arch: "x64" })).toBe(false);
    expect(ladderFor({ ...MAC, arch: "x64" })).toBe(ggufLadder);
  });

  it("leaves Linux and Windows on the GGUF builds", () => {
    for (const platform of ["linux", "win32"]) {
      expect(supportsMlx({ platform, arch: "arm64", llamaVersion: "0.33.3" })).toBe(
        false,
      );
      expect(ladderFor({ platform, arch: "x64" })).toBe(ggufLadder);
    }
  });

  it("falls back when the version cannot be read at all", () => {
    expect(supportsMlx({ ...MAC, llamaVersion: null })).toBe(false);
    expect(supportsMlx({ ...MAC, llamaVersion: "" })).toBe(false);
    expect(supportsMlx({ ...MAC, llamaVersion: "unknown" })).toBe(false);
    expect(supportsMlx({ platform: "darwin", arch: "arm64" })).toBe(false);
  });

  it("defaults to the PC ladder when nothing is known", () => {
    expect(ladderFor()).toBe(ggufLadder);
    expect(modelRecommendations).toBe(ggufLadder);
  });
});

describe("RAM alongside VRAM, on a PC", () => {
  it("reads the card alone when no RAM is reported", () => {
    expect(labelOf(getRecommendedModel(7.5, {}))).toBe("Qwen 3.5 9B");
  });

  it("gives an 8 GB card with 32 GB of RAM a 35B MoE rather than a dense 9B", () => {
    // The experts sit in RAM and only the active part and context need the card.
    expect(labelOf(getRecommendedModel(8, { ram: 32 }))).toMatch(/^Qwen 3\.6 35B/);
  });

  it("matches the setups the ladder was written for", () => {
    const setups: [number, number, string][] = [
      [4, 16, "GPT-OSS 20B"],
      [8, 16, "Gemma 4 26B"],
      [12, 32, "Qwen 3.6 35B Q6"],
      [16, 32, "Qwen 3.8 27B Q3"],
      [12, 64, "Qwen 3.5 122B Q3"],
      [24, 64, "Qwen 3.8 27B Q5"],
      [24, 96, "Qwen 3.8 Flash-Next Q3"],
      [24, 192, "DeepSeek V4 Flash"],
      [32, 256, "GLM-5.3-Flash"],
    ];
    for (const [vram, ram, label] of setups) {
      expect(labelOf(getRecommendedModel(vram, { ram })), `${vram} GB card, ${ram} GB RAM`).toBe(label);
    }
  });

  it("keeps a big MoE off a card too small for its active part", () => {
    // 256 GB of RAM holds a 122B, but a 4 GB card cannot carry its 10B active weights and context.
    expect(labelOf(getRecommendedModel(4, { ram: 256 }))).toBe("Qwen 3.6 35B Q8");
  });

  it("caps a big card at what little RAM can actually hold", () => {
    const uncapped = getRecommendedModel(24, {});
    const capped = getRecommendedModel(24, { ram: 8 });
    expect(indexOf(capped)).toBeLessThan(indexOf(uncapped));
  });

  it("does not strand integrated graphics on the smallest model when RAM is generous", () => {
    expect(labelOf(getRecommendedModel(0, { ram: 32 }))).toBe("Qwen 3.6 35B");
  });

  it("keeps dense models small on the CPU", () => {
    for (let ram = 1; ram <= 64; ram += 1) {
      const chosen = ggufLadder[indexOf(getRecommendedModel(0, { ram }))];
      if (chosen.kind === "dense") expect(chosen.vram, `${ram} GB`).toBeLessThanOrEqual(CPU_ONLY_DENSE_CAP_GB);
    }
  });

  it("never lets a RAM floor exceed a RAM ceiling", () => {
    for (let ram = 1; ram <= 256; ram += 1) {
      expect(() => getRecommendedModel(0, { ram })).not.toThrow();
    }
  });
});

describe("chip class on Apple Silicon", () => {
  it("reads the variant out of the CPU string", () => {
    expect(chipClassOf("Apple M1")).toBe("base");
    expect(chipClassOf("Apple M2 Pro")).toBe("pro");
    expect(chipClassOf("Apple M3 Max")).toBe("max");
    expect(chipClassOf("Apple M1 Ultra")).toBe("ultra");
  });

  it("defaults unknown and non-Apple CPUs to the most conservative class", () => {
    expect(chipClassOf("AMD Ryzen 9 7950X")).toBe("base");
    expect(chipClassOf(undefined)).toBe("base");
    expect(chipClassOf(null)).toBe("base");
  });

  it("reads unified memory itself rather than the pre-reduced VRAM copy", () => {
    const base = { platform: "darwin", arch: "arm64", llamaVersion: "0.33.3" };
    const pool = 16 * USABLE_UNIFIED_RAM_FRACTION;
    const best = mlxLadder.findLast((entry) => !entry.pending && entry.memory <= pool)!;

    // The old, already-reduced number would have missed this rung entirely.
    expect(getRecommendedModel(5, { ...base, ram: 16, cpuModel: "Apple M1" })).toBe(best.model);
  });

  it("takes a wide-bandwidth Max or Ultra chip one rung above a base or Pro one", () => {
    const base = { platform: "darwin", arch: "arm64", llamaVersion: "0.33.3", ram: 32 };
    const climbing = mlxLadder;
    const atThirtyTwo = climbing.findLastIndex((entry) => entry.memory <= 32 * USABLE_UNIFIED_RAM_FRACTION);

    expect(getRecommendedModel(0, { ...base, cpuModel: "Apple M2" })).toBe(
      climbing[atThirtyTwo].model,
    );
    expect(getRecommendedModel(0, { ...base, cpuModel: "Apple M2 Pro" })).toBe(
      climbing[atThirtyTwo].model,
    );
    expect(getRecommendedModel(0, { ...base, cpuModel: "Apple M2 Max" })).toBe(
      climbing[atThirtyTwo + 1].model,
    );
    expect(getRecommendedModel(0, { ...base, cpuModel: "Apple M2 Ultra" })).toBe(
      climbing[atThirtyTwo + 1].model,
    );
  });

  it("skips the bump when the rung above needs more than all the memory", () => {
    const mac = { platform: "darwin", arch: "arm64", ram: 24 };
    expect(getRecommendedModel(0, { ...mac, cpuModel: "Apple M2 Max" })).toBe(
      getRecommendedModel(0, { ...mac, cpuModel: "Apple M2" }),
    );
  });

  it("never bumps past the top of the ladder", () => {
    const top = mlxLadder.findLast((entry) => !entry.pending)!;
    const chosen = getRecommendedModel(0, {
      platform: "darwin",
      arch: "arm64",
      llamaVersion: "0.33.3",
      ram: 999,
      cpuModel: "Apple M4 Ultra",
    });
    expect(chosen).toBe(top.model);
  });
});

describe("what is in the ladders", () => {
  it("keeps MLX tags out of the ladder every other machine uses", () => {
    // An -mlx tag on a PC downloads gigabytes that nothing there can run.
    for (const entry of ggufLadder) {
      expect(entry.model, entry.model).not.toContain("mlx");
    }
  });

  it("never offers a quantisation that needs hardware we cannot detect", () => {
    // nvfp4 and mxfp8 want Blackwell tensor cores. Draggy does not know which
    // card it has, so a default that assumes one would strand older ones.
    for (const entry of [...ggufLadder, ...mlxLadder]) {
      expect(entry.model, entry.model).not.toMatch(/nvfp4|mxfp8/);
    }
  });

  it("names a tag rather than a bare family", () => {
    // "qwen3.5" pulls whatever latest happens to be, which is not a size.
    for (const entry of [...ggufLadder, ...mlxLadder]) {
      expect(entry.model, entry.model).toContain(":");
    }
  });
});

describe("recommended download for automatic setup", () => {
  it("resolves a downloadable Hugging Face GGUF package for any VRAM", () => {
    for (let vram = 0; vram <= 32; vram += 2) {
      const download = getRecommendedDownload(vram);
      expect(download.model).toBeTruthy();
      expect(download.label).toBeTruthy();
      expect(download.reference).toMatch(/^[\w.-]+\/[\w.-]+:[\w-]+$/);
      expect(download.size).toBeGreaterThan(100_000_000);
    }
  });

  it("scales up model size with higher VRAM hardware", () => {
    const small = getRecommendedDownload(2);
    const large = getRecommendedDownload(16);
    expect(large.size).toBeGreaterThan(small.size);
  });

  it("gives every rung its own model, the one its label names", () => {
    // The old table sent a "Qwen 3.5 9B" rung to Llama 3.1 and left every rung above 14 GB on
    // the same default, so a 24 GB card was handed an 8B model under a 31B label.
    const repos = ggufLadder.map((entry) => entry.model);
    expect(new Set(repos).size).toBe(repos.length);
    for (const entry of ggufLadder) {
      const family = entry.label.split(" ")[0].toLowerCase();
      expect(entry.model.toLowerCase(), entry.label).toContain(family);
    }
  });

  it("never offers weights bigger than the memory the rung is for", () => {
    for (const entry of ggufLadder) {
      expect(entry.sizeGB, entry.label).toBeLessThanOrEqual(entry.memory);
      if (entry.kind === "dense") expect(entry.sizeGB, entry.label).toBeLessThanOrEqual(entry.vram);
    }
  });

  it("climbs in size through each model's quantisations", () => {
    // Quality order puts a bigger quant of the same weights above a smaller one.
    const repos = new Map<string, number>();
    for (const entry of ggufLadder) {
      const repo = entry.model.split(":")[0];
      expect(entry.sizeGB, entry.label).toBeGreaterThan(repos.get(repo) ?? 0);
      repos.set(repo, entry.sizeGB);
    }
  });
});
