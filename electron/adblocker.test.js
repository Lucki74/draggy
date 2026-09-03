import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const adblocker = require("./adblocker.cjs");

describe("the filter list set", () => {
  const lists = adblocker.FILTER_LISTS;

  it("loads the current year's uBO filters", () => {
    // uBO splits its filters by year and only adds to the newest file, so an
    // old set silently stops receiving new rules — YouTube's among them.
    expect(lists.some((url) => url.includes("filters-2025.txt"))).toBe(true);
  });

  it("keeps the earlier years as well", () => {
    for (const year of [2020, 2021, 2022, 2023, 2024]) {
      expect(lists.some((url) => url.includes(`filters-${year}.txt`)), String(year)).toBe(true);
    }
  });

  it("loads the list that defuses adblock walls", () => {
    expect(lists.some((url) => url.includes("antiadblockfilters"))).toBe(true);
  });

  it("still loads the base and privacy lists", () => {
    expect(lists.some((url) => url.includes("easylist.txt"))).toBe(true);
    expect(lists.some((url) => url.includes("easyprivacy.txt"))).toBe(true);
  });

  it("ships its own supplement from disk rather than the network", () => {
    expect(lists.some((url) => url.startsWith("draggy-filters:"))).toBe(true);
  });

  it("names every list once", () => {
    expect(new Set(lists).size).toBe(lists.length);
  });
});
