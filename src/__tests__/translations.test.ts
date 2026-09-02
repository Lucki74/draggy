import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { languages, translations } from "../translations";

const REFERENCE = "en";
const SOURCE_DIR = path.resolve(__dirname, "..");

const codes = languages.map((entry) => entry.code);
const referenceKeys = Object.keys(translations[REFERENCE]);

function sourceFiles(dir: string, collected: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, collected);
    else if (/\.tsx?$/.test(entry.name) && entry.name !== "translations.ts") {
      collected.push(full);
    }
  }
  return collected;
}

function usedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /\bt\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\)/g;

  for (const file of sourceFiles(SOURCE_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    let match;
    while ((match = pattern.exec(source)) !== null) {
      found.set(match[1], path.relative(SOURCE_DIR, file));
    }
  }

  return found;
}

/**
 * Every bare word the interface could pass to `t()`. Keys are not always
 * inline, so any quoted identifier in the source counts as a possible one.
 */
function referencedWords(): Set<string> {
  const words = new Set<string>();
  const pattern = /["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g;

  for (const file of sourceFiles(SOURCE_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    let match;
    while ((match = pattern.exec(source)) !== null) words.add(match[1]);
  }

  return words;
}

/**
 * Prefixes of keys built at the call site, as in t(`provider_${id}`). These are
 * reachable even though the full name is never written down.
 */
function dynamicPrefixes(): string[] {
  const prefixes = new Set<string>();
  const pattern = /\bt\(\s*`([A-Za-z_][A-Za-z0-9_]*)\$\{/g;

  for (const file of sourceFiles(SOURCE_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    let match;
    while ((match = pattern.exec(source)) !== null) prefixes.add(match[1]);
  }

  return [...prefixes];
}

describe("language coverage", () => {
  it("ships every language the picker offers", () => {
    for (const code of codes) {
      expect(translations[code], `no table for ${code}`).toBeDefined();
    }
  });

  it("has no table for a language the picker does not offer", () => {
    expect(Object.keys(translations).sort()).toEqual([...codes].sort());
  });

  it("has a non-trivial number of keys", () => {
    expect(referenceKeys.length).toBeGreaterThan(150);
  });
});

describe("key parity across all twelve languages", () => {
  for (const code of codes) {
    if (code === REFERENCE) continue;

    it(`${code} defines every English key`, () => {
      const missing = referenceKeys.filter((key) => !(key in translations[code]));
      expect(missing, `${code} is missing ${missing.length} key(s)`).toEqual([]);
    });

    it(`${code} defines no key English lacks`, () => {
      const extra = Object.keys(translations[code]).filter(
        (key) => !(key in translations[REFERENCE]),
      );
      expect(extra).toEqual([]);
    });
  }
});

describe("value quality", () => {
  for (const code of codes) {
    it(`${code} has no blank strings`, () => {
      const blank = Object.entries(translations[code])
        .filter(([, value]) => typeof value !== "string" || value.trim() === "")
        .map(([key]) => key);

      expect(blank).toEqual([]);
    });
  }

  for (const code of codes) {
    if (code === REFERENCE) continue;

    it(`${code} is actually translated, not a copy of English`, () => {
      const identical = referenceKeys.filter(
        (key) => translations[code][key] === translations[REFERENCE][key],
      );

      const share = identical.length / referenceKeys.length;
      expect(
        share,
        `${code} matches English on ${identical.length}/${referenceKeys.length} keys`,
      ).toBeLessThan(0.4);
    });
  }
});

describe("every key the interface asks for exists", () => {
  const used = usedKeys();

  it("finds translation calls to check", () => {
    expect(used.size).toBeGreaterThan(50);
  });

  it("has an English string for every t() call in the source", () => {
    const missing = [...used.entries()]
      .filter(([key]) => !(key in translations[REFERENCE]))
      .map(([key, file]) => `${key} (used in ${file})`);

    expect(missing, `add these to translations.ts: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("every key the tables define is still asked for", () => {
  it("has no string left behind by a feature that was removed", () => {
    const words = referencedWords();
    const prefixes = dynamicPrefixes();

    const orphaned = referenceKeys.filter(
      (key) =>
        !words.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
    );

    expect(
      orphaned,
      `these keys are defined in all ${codes.length} languages but nothing reads them: ${orphaned.join(", ")}`,
    ).toEqual([]);
  });
});
