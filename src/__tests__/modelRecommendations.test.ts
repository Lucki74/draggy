import { describe, expect, it } from "vitest";
import {
  chipClassOf,
  getRecommendedModel,
  ggufLadder,
  ladderFor,
  mlxLadder,
  modelRecommendations,
  supportsMlx,
} from "../modelRecommendations";

const MAC = { platform: "darwin", arch: "arm64", ollamaVersion: "0.33.3" };

const ladders = [
  { name: "gguf", ladder: ggufLadder, target: {} },
  { name: "mlx", ladder: mlxLadder, target: MAC },
];

describe.each(ladders)("sizing the first-launch model ($name)", ({ ladder, target }) => {
  const climbing = [...ladder].sort((a, b) => a.vram - b.vram);
  const smallest = climbing[0];

  it("gives a machine with no usable graphics memory the smallest model", () => {
    // The fallback used to name a 0.6B model, twice the size of the 360M at
    // the bottom, handed to the machine least able to run it.
    expect(getRecommendedModel(0, target)).toBe(smallest.model);
  });

  it("does the same below the bottom rung", () => {
    expect(getRecommendedModel(smallest.vram / 2, target)).toBe(smallest.model);
  });

  it("copes with a card it could not measure", () => {
    expect(getRecommendedModel(Number.NaN, target)).toBe(smallest.model);
    expect(getRecommendedModel(-1, target)).toBe(smallest.model);
  });

  it("takes the highest rung the card can afford", () => {
    for (const entry of climbing) {
      expect(getRecommendedModel(entry.vram, target), `${entry.vram} GB`).toBe(
        entry.model,
      );
    }
  });

  it("never recommends a rung the card cannot afford", () => {
    for (let vram = 0; vram <= 128; vram += 0.25) {
      const chosen = getRecommendedModel(vram, target);
      const rung = climbing.find((entry) => entry.model === chosen);
      if (chosen === smallest.model) continue;
      expect(rung, chosen).toBeDefined();
      expect(rung!.vram, `${vram} GB chose ${chosen}`).toBeLessThanOrEqual(vram);
    }
  });

  it("only ever climbs as the card gets bigger", () => {
    let previous = -1;
    for (let vram = 0; vram <= 128; vram += 0.25) {
      const rung = climbing.findIndex(
        (entry) => entry.model === getRecommendedModel(vram, target),
      );
      expect(rung).toBeGreaterThanOrEqual(previous);
      previous = rung;
    }
  });

  it("never asks a bigger card for a smaller model", () => {
    // A rung that steps down in size is a ladder somebody has edited wrongly.
    for (let index = 1; index < climbing.length; index++) {
      expect(climbing[index].vram).toBeGreaterThan(climbing[index - 1].vram);
    }
  });
});

describe("choosing between the two ladders", () => {
  it("runs MLX builds on Apple Silicon with a recent Ollama", () => {
    expect(supportsMlx(MAC)).toBe(true);
    expect(ladderFor(MAC)).toBe(mlxLadder);
  });

  it("leaves an Intel Mac on the GGUF builds", () => {
    // MLX is Apple's framework for Apple's silicon. There is no unified memory
    // on an Intel Mac and no MLX runtime to use it.
    expect(supportsMlx({ ...MAC, arch: "x64" })).toBe(false);
    expect(ladderFor({ ...MAC, arch: "x64" })).toBe(ggufLadder);
  });

  it("leaves Linux and Windows on the GGUF builds", () => {
    for (const platform of ["linux", "win32"]) {
      expect(supportsMlx({ platform, arch: "arm64", ollamaVersion: "0.33.3" })).toBe(
        false,
      );
      expect(ladderFor({ platform, arch: "x64" })).toBe(ggufLadder);
    }
  });

  it("waits for an Ollama that can actually run an MLX tag", () => {
    // Pulling one on 0.18 fails, and it fails on the very first launch, which
    // is the worst place in the app to hand somebody an error.
    expect(supportsMlx({ ...MAC, ollamaVersion: "0.18.9" })).toBe(false);
    expect(supportsMlx({ ...MAC, ollamaVersion: "0.19.0" })).toBe(true);
    expect(supportsMlx({ ...MAC, ollamaVersion: "0.19" })).toBe(true);
    expect(supportsMlx({ ...MAC, ollamaVersion: "1.0.0" })).toBe(true);
  });

  it("falls back when the version cannot be read at all", () => {
    expect(supportsMlx({ ...MAC, ollamaVersion: null })).toBe(false);
    expect(supportsMlx({ ...MAC, ollamaVersion: "" })).toBe(false);
    expect(supportsMlx({ ...MAC, ollamaVersion: "unknown" })).toBe(false);
    expect(supportsMlx({ platform: "darwin", arch: "arm64" })).toBe(false);
  });

  it("defaults to the PC ladder when nothing is known", () => {
    expect(ladderFor()).toBe(ggufLadder);
    expect(modelRecommendations).toBe(ggufLadder);
  });
});

describe("RAM alongside VRAM, on a PC", () => {
  const gguf = [...ggufLadder].sort((a, b) => a.vram - b.vram);

  it("still ignores RAM when none is reported", () => {
    // Every test above calls with no `ram` at all; this just names that on purpose.
    expect(getRecommendedModel(gguf[3].vram, {})).toBe(gguf[3].model);
  });

  it("caps a big card at what little RAM can actually hold", () => {
    // Ollama has to read the whole model into RAM before the GPU touches it, so a
    // 24 GB card in an 8 GB machine cannot really run what the card alone suggests.
    const uncapped = getRecommendedModel(24, {});
    const capped = getRecommendedModel(24, { ram: 8 });
    const climbing = [...gguf];

    expect(capped).not.toBe(uncapped);
    expect(climbing.findIndex((entry) => entry.model === capped)).toBeLessThan(
      climbing.findIndex((entry) => entry.model === uncapped),
    );
  });

  it("does not strand integrated graphics on the smallest model when RAM is generous", () => {
    // No dedicated GPU used to mean the 0.8B floor no matter what, even next to 32 GB of RAM.
    const chosen = getRecommendedModel(0, { ram: 32 });
    expect(chosen).not.toBe(gguf[0].model);
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
    const base = { platform: "darwin", arch: "arm64", ollamaVersion: "0.33.3" };
    const raw16 = mlxLadder.find((entry) => entry.vram === 16)!;

    // The old, already-reduced number would have missed this rung entirely.
    expect(getRecommendedModel(5, { ...base, ram: 16, cpuModel: "Apple M1" })).toBe(
      raw16.model,
    );
  });

  it("takes a wide-bandwidth Max or Ultra chip one rung above a base or Pro one", () => {
    const base = { platform: "darwin", arch: "arm64", ollamaVersion: "0.33.3", ram: 32 };
    const climbing = [...mlxLadder].sort((a, b) => a.vram - b.vram);
    const atThirtyTwo = climbing.findIndex((entry) => entry.vram === 32);

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

  it("never bumps past the top of the ladder", () => {
    const top = [...mlxLadder].sort((a, b) => a.vram - b.vram).at(-1)!;
    const chosen = getRecommendedModel(0, {
      platform: "darwin",
      arch: "arm64",
      ollamaVersion: "0.33.3",
      ram: 999,
      cpuModel: "Apple M4 Ultra",
    });
    expect(chosen).toBe(top.model);
  });
});

describe("what is in the ladders", () => {
  it("only offers MLX tags to the MLX ladder", () => {
    for (const entry of mlxLadder) {
      expect(entry.model, entry.model).toMatch(/-mlx$/);
    }
  });

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
