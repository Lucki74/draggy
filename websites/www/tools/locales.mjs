/**
 * Loads a language: tools/locales/<code>.json, then every tools/locales/<code>.<part>.json on top of
 * it in name order. A part overrides keys of the base; a value of null deletes one. Parts exist so
 * several people can edit strings at once; fold them into the base file when the work lands.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "locales");

export function loadLocale(code) {
  const strings = JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8"));
  const parts = readdirSync(dir)
    .filter((file) => file.startsWith(`${code}.`) && file !== `${code}.json` && file.endsWith(".json"))
    .sort();
  for (const part of parts) {
    for (const [key, value] of Object.entries(JSON.parse(readFileSync(join(dir, part), "utf8")))) {
      if (value === null) delete strings[key];
      else strings[key] = value;
    }
  }
  return strings;
}

export const localeCodes = ["en", "fr", "es", "ru"];
