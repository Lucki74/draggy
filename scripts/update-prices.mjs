#!/usr/bin/env node
// Regenerates shared/pricing/prices.json from LiteLLM's public price list and OpenRouter's public model list.
// No price is typed by hand. Run: node scripts/update-prices.mjs [--litellm file] [--openrouter file] [--out file]
// The two --file flags read a saved copy instead of the network, which is how the tests and offline runs work.
// The conversion lives in win/electron/pricing/build.cjs, which the app also uses to refresh its own copy.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const build = createRequire(import.meta.url)("../win/electron/pricing/build.cjs");
export const { LITELLM_URL, OPENROUTER_URL, LITELLM_PROVIDERS, perMillion, fromLitellm, fromOpenRouter, splitLitellmKey, buildTable, serialize } = build;

async function load(file, url) {
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  const response = await fetch(url, { headers: { "user-agent": "draggy-price-updater" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const out = flag("--out") ?? path.join(root, "shared", "pricing", "prices.json");
  const [litellm, openrouter] = await Promise.all([load(flag("--litellm"), LITELLM_URL), load(flag("--openrouter"), OPENROUTER_URL)]);
  const table = buildTable({ litellm, openrouter });
  const count = Object.values(table.providers).reduce((sum, models) => sum + Object.keys(models).length, 0);
  if (count < 200) throw new Error(`only ${count} prices came out; refusing to overwrite the table`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialize(table));
  console.log(`wrote ${count} prices for ${Object.keys(table.providers).length} providers to ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
