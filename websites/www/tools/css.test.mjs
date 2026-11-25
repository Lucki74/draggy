/**
 * Checks on the stylesheets and the page markup that the visual audit found wrong.
 *
 *   node --test tools/css.test.mjs
 *
 * These read the source files, so they run without a build.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = join(root, "assets", "css");
const css = Object.fromEntries(
  readdirSync(cssDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => [file, readFileSync(join(cssDir, file), "utf8")]),
);

test("no stylesheet uses padding-start or margin-start, which are not CSS properties", () => {
  for (const [file, text] of Object.entries(css)) {
    assert.doesNotMatch(text, /(^|[\s;{])(padding|margin)-start\s*:/m, file);
  }
});

test("the home page never skips a heading level, so h1 is followed by h2", () => {
  const home = readFileSync(join(root, "tools", "pages", "index.html"), "utf8");
  const levels = [...home.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));

  assert.equal(levels[0], 1, "the first heading is h1");
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1] + 1, `heading ${i + 1} goes from h${levels[i - 1]} to h${levels[i]}`);
  }
});

/**
 * Every rule with the at-rule it sits in, as { selector, query, body }. Comments go first, so one written
 * before a rule cannot end up in its selector. A declaration list is compared without its order or spacing.
 */
function ruleBlocks(text, query = "") {
  const source = text.replace(/\/\*[^]*?\*\//g, "");
  const found = [];
  let at = 0;

  while (at < source.length) {
    const open = source.indexOf("{", at);
    if (open === -1) break;

    let depth = 1;
    let close = open + 1;
    while (close < source.length && depth > 0) {
      if (source[close] === "{") depth++;
      else if (source[close] === "}") depth--;
      close++;
    }

    const prelude = source.slice(at, open).trim();
    const body = source.slice(open + 1, close - 1);
    if (prelude.startsWith("@")) found.push(...ruleBlocks(body, query ? `${query} and ${prelude}` : prelude));
    else found.push({ selector: prelude, query, body: declarations(body) });
    at = close;
  }

  return found;
}

function declarations(body) {
  return body
    .split(";")
    .map((declaration) => declaration.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join("; ");
}

test("dark colors come from the system alone: no data-theme selector in any stylesheet", () => {
  let checked = 0;

  for (const [file, text] of Object.entries(css)) {
    assert.doesNotMatch(text, /data-theme/, file);
    checked += ruleBlocks(text).filter((block) => block.query.includes("prefers-color-scheme: dark")).length;
  }

  assert.ok(checked > 0, "no dark rules were found, so none was checked");
});

test("no shadow token is left, and no box-shadow blurs, because the brief bans blur", () => {
  for (const [file, text] of Object.entries(css)) {
    assert.doesNotMatch(text, /--[\w-]*shadow\s*:/i, `${file}: a shadow token`);

    for (const [, value] of text.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
      // Drop the function arguments (colours, var()), then the third length is the blur radius.
      const lengths = value.replace(/\([^)]*\)/g, "").match(/-?\d*\.?\d+/g) ?? [];
      assert.equal(Number(lengths[2] ?? 0), 0, `${file}: box-shadow blurs: ${value.trim()}`);
    }
  }
});
