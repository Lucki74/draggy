/**
 * Which strings each language is missing, and which nothing uses.
 *
 *   npm run i18n
 *
 * The build already refuses a locale that has drifted from English, but it stops at the first
 * language and prints a single line. This prints every gap in every language, in one go, so a
 * translator can work from the list. It exits 1 when there is a gap, and 0 otherwise. Keys nothing
 * refers to are listed as information only: they cost translators time, not visitors.
 *
 * A key counts as used when its whole name appears in the tools, the site script or a page, or when
 * the build makes its name at run time from a page id or an error group. The
 * families are read from build.mjs itself, and each one counts only where its template is in the source.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { loadLocale, localeCodes } from "./locales.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const self = join(here, "check-i18n.mjs");

const codes = localeCodes;
const english = loadLocale("en");
const keys = Object.keys(english);

let gaps = 0;

for (const code of codes.filter((code) => code !== "en")) {
  const theirs = loadLocale(code);
  const missing = keys.filter((key) => !(key in theirs));
  const extra = Object.keys(theirs).filter((key) => !(key in english));
  gaps += missing.length + extra.length;

  if (missing.length) console.log(`${code}: missing ${missing.length}\n  ${missing.join("\n  ")}`);
  if (extra.length) console.log(`${code}: not in English ${extra.length}\n  ${extra.join("\n  ")}`);
}

/** Every file that can name a string: the tools (not the locale files, or this checker), and the site script. */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "locales" ? [] : sourceFiles(path);
    return path === self ? [] : [path];
  });
}

const texts = [...sourceFiles(here), join(here, "..", "assets", "js", "site.js")].map((file) => readFileSync(file, "utf8"));

// Every dotted name in the sources, whole. "nav.docs" is one name, so "nav" is not counted as used by it.
const named = new Set(texts.flatMap((text) => text.match(/[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+/g) ?? []));

// The names the build makes at run time. Read from build.mjs, so a slug or a page added there is counted here too.
const build = readFileSync(join(here, "build.mjs"), "utf8");
const block = (name) => build.match(new RegExp(`const ${name} = \\[([^]*?)\\n\\];`))?.[1] ?? "";
const pageIds = [...block("PAGES").matchAll(/\bid: "([A-Za-z]+)"/g)].map((m) => m[1]);
const groupKeys = [...block("ERROR_GROUPS").matchAll(/\bkey: "([a-z]+)"/g)].map((m) => m[1]);
const faqNumbers = (build.match(/\[([\d, ]+)\]\.map\(\(n\)/)?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean);

const built = new Set();
const family = (template, names) => {
  if (build.includes(template)) for (const name of names) built.add(name);
};

// t(`${page.id}.title`) and its three siblings, for each page.
family("${page.id}.", [
  ...[...pageIds].flatMap((id) => ["title", "description", "ogTitle", "ogDescription"].map((part) => `${id}.${part}`)),
]);
family("errors.group.${", groupKeys.map((key) => `errors.group.${key}`));
family("faq.q${n}", faqNumbers.map((n) => `faq.q${n}`));
family("faq.a${n}", faqNumbers.map((n) => `faq.a${n}`));

const unused = keys.filter((key) => !named.has(key) && !built.has(key));
if (unused.length) console.log(`\nno page or tool uses these ${unused.length} strings (information only):\n  ${unused.join("\n  ")}`);

console.log(gaps ? `\n${gaps} gaps` : `\nall ${codes.length} languages have all ${keys.length} strings`);
process.exit(gaps ? 1 : 0);
