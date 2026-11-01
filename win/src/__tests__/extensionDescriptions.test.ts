import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ES } from "../extensions/descriptions.es";
import { FR } from "../extensions/descriptions.fr";
import { RU } from "../extensions/descriptions.ru";
import { localDescription } from "../extensions/descriptions";

const require = createRequire(import.meta.url);
const { CATALOGUE } = require("../../electron/mcpCatalogue.cjs");
const library = path.resolve(__dirname, "../../electron/skills-library");

const wanted = [
  ...CATALOGUE.map((entry: { id: string }) => `mcp:${entry.id}`),
  ...readdirSync(library, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `skill:${entry.name}`),
];

describe("extension descriptions", () => {
  for (const [name, table] of [["French", FR], ["Spanish", ES], ["Russian", RU]] as const) {
    it(`${name} covers every bundled server and skill, and nothing else`, () => {
      expect(Object.keys(table).sort()).toEqual([...wanted].sort());
      expect(Object.values(table).every((text) => text.trim().length > 10)).toBe(true);
    });
  }

  it("falls back to the English text", () => {
    const english = (key: string) => (key === "localeCode" ? "en" : key);
    expect(localDescription(english, "mcp", "github", "Search repositories.")).toBe("Search repositories.");
    const french = (key: string) => (key === "localeCode" ? "fr" : key);
    expect(localDescription(french, "mcp", "github", "x")).toBe(FR["mcp:github"]);
    expect(localDescription(french, "mcp", "mine", "Custom server.")).toBe("Custom server.");
  });
});
