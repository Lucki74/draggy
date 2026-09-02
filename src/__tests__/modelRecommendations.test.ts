import { describe, expect, it } from "vitest";
import {
  getRecommendedModel,
  modelRecommendations,
} from "../modelRecommendations";

const ladder = [...modelRecommendations].sort((a, b) => a.vram - b.vram);
const smallest = ladder[0];

describe("sizing the first-launch model to the card", () => {
  it("gives a machine with no usable graphics memory the smallest model", () => {
    // The fallback used to name a 0.6B model, twice the size of the 360M at
    // the bottom, handed to the machine least able to run it.
    expect(getRecommendedModel(0)).toBe(smallest.model);
  });

  it("does the same below the bottom rung", () => {
    expect(getRecommendedModel(smallest.vram / 2)).toBe(smallest.model);
  });

  it("copes with a card it could not measure", () => {
    expect(getRecommendedModel(Number.NaN)).toBe(smallest.model);
    expect(getRecommendedModel(-1)).toBe(smallest.model);
  });

  it("takes the highest rung the card can afford", () => {
    for (const entry of ladder) {
      expect(getRecommendedModel(entry.vram), `${entry.vram} GB`).toBe(entry.model);
    }
  });

  it("never recommends a rung the card cannot afford", () => {
    for (let vram = 0; vram <= 64; vram += 0.25) {
      const chosen = getRecommendedModel(vram);
      const rung = ladder.find((entry) => entry.model === chosen);
      if (chosen === smallest.model) continue;
      expect(rung, chosen).toBeDefined();
      expect(rung!.vram, `${vram} GB chose ${chosen}`).toBeLessThanOrEqual(vram);
    }
  });

  it("only ever climbs as the card gets bigger", () => {
    let previous = -1;
    for (let vram = 0; vram <= 64; vram += 0.25) {
      const rung = ladder.findIndex(
        (entry) => entry.model === getRecommendedModel(vram),
      );
      expect(rung).toBeGreaterThanOrEqual(previous);
      previous = rung;
    }
  });
});
