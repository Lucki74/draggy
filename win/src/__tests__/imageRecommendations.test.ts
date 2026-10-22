import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { getRecommendedImageModel, imageLadder, imageRungFits } from "../images/imageRecommendations";

const require = createRequire(import.meta.url);
const { familyOf } = require("../../electron/imageFamilies.cjs");

const labelOf = (vram: number, target = {}) => getRecommendedImageModel(vram, target).label;

describe("the image model ladder", () => {
  it("gives a machine with nothing to spare the smallest model", () => {
    expect(labelOf(0)).toBe(imageLadder[0].label);
    expect(labelOf(Number.NaN, { ram: 2 })).toBe(imageLadder[0].label);
  });

  it("matches the setups it was written for", () => {
    const setups: [number, number, string][] = [
      [4, 8, "FLUX.2 klein 4B"],
      [8, 16, "Z-Image Turbo"],
      [8, 32, "Z-Image Turbo"],
      [12, 32, "Qwen-Image 2.1 Q8"],
      [10, 16, "Qwen-Image 2.1"],
      [24, 64, "Qwen-Image 2.1 Q8"],
    ];
    for (const [vram, ram, label] of setups) {
      expect(labelOf(vram, { ram }), `${vram} GB card, ${ram} GB RAM`).toBe(label);
    }
  });

  it("keeps a machine with no card on the rungs a processor can finish", () => {
    for (let ram = 1; ram <= 256; ram += 1) {
      expect(getRecommendedImageModel(0, { ram }).cpu, `${ram} GB`).toBe(true);
    }
    expect(labelOf(0, { ram: 16 })).toBe("FLUX.2 klein 4B");
  });

  it("shares unified memory on Apple Silicon", () => {
    const mac = { platform: "darwin", arch: "arm64" };
    expect(labelOf(0, { ...mac, ram: 8 })).toBe("Stable Diffusion 1.5");
    expect(labelOf(0, { ...mac, ram: 16 })).toBe("Z-Image Turbo Q8");
    expect(labelOf(0, { ...mac, ram: 32 })).toBe("Qwen-Image 2.1 Q8");
  });

  it("never recommends a rung the machine cannot run", () => {
    for (let vram = 0; vram <= 32; vram += 0.5) {
      for (const ram of [0, 8, 16, 32, 64]) {
        const chosen = getRecommendedImageModel(vram, { ram });
        if (chosen === imageLadder[0]) continue;
        expect(imageRungFits(chosen, vram, { ram }), `${vram}/${ram} chose ${chosen.label}`).toBe(true);
      }
    }
  });

  it("only ever climbs as the card grows", () => {
    // Below 2 GB the processor does the work, so the climb starts at the first real card.
    for (const ram of [8, 16, 32, 64]) {
      let previous = -1;
      for (let vram = 2; vram <= 32; vram += 0.25) {
        const rung = imageLadder.indexOf(getRecommendedImageModel(vram, { ram }));
        expect(rung, `${vram} GB card, ${ram} GB RAM`).toBeGreaterThanOrEqual(previous);
        previous = rung;
      }
    }
  });

  it("never offers files bigger than the memory the rung is for", () => {
    for (const rung of imageLadder) {
      expect(rung.sizeGB, rung.label).toBeLessThanOrEqual(rung.memory);
      expect(rung.vram, rung.label).toBeLessThanOrEqual(rung.memory);
    }
  });

  it("names files the image engine knows how to load", () => {
    for (const rung of imageLadder.slice(1)) {
      expect(familyOf(rung.reference, rung.filename), rung.label).toBeTruthy();
    }
  });
});
