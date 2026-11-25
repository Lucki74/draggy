/**
 * Checks assets/css against the design tokens and the banned patterns. The docs live in their own
 * repo (DRAGGY_DOCS, else ../docs) and keep a copy of the tokens; when that repo is beside
 * this one, the copy is compared with site.css. Also compares the accent
 * with the Draggy app's own in src/index.css. The app is DRAGGY_APP when that is set, else ../draggy
 * beside this repo. Without it the accent comparison is skipped and everything else still runs,
 * as it does on Vercel builds.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = join(root, "assets", "css");
const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
const css = Object.fromEntries(files.map((f) => [f, readFileSync(join(cssDir, f), "utf8")]));
const docsFile = join(process.env.DRAGGY_DOCS ? resolve(process.env.DRAGGY_DOCS) : join(root, "..", "docs"), "assets", "css", "docs.css");
const docsCss = existsSync(docsFile) ? readFileSync(docsFile, "utf8") : "";
const errors = [];

const EXPECTED = {
  light: { "--bg": "#f3f9fd", "--ink": "#10202e", "--muted": "#4a6075", "--line": "#c9ddec", "--accent": "#1e78b4" },
  dark: { "--bg": "#0b120e", "--ink": "#e6eee6", "--muted": "#93a596", "--line": "#243329", "--accent": "#8db89b" },
};

/**
 * Every style rule in a stylesheet with the at-rules it sits inside, as { selector, query, body }.
 * Nested at-rules are read too, so a :root inside a media query is found and its query known.
 * Comments go first, so one written before a rule cannot end up in its selector.
 */
function rules(text, query = "") {
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
    if (prelude.startsWith("@")) found.push(...rules(body, query ? `${query} and ${prelude}` : prelude));
    else found.push({ selector: prelude, query, body });
    at = close;
  }

  return found;
}

/** The value a token is given in these blocks, taking the last declaration as the cascade does. */
function declared(bodies, token) {
  let value;
  for (const body of bodies) {
    for (const [, name, given] of body.matchAll(/(?:^|[;\s{])(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name === token) value = given.trim().toLowerCase();
    }
  }
  return value;
}

const siteRules = rules(css["site.css"]);
// The light tokens are the top-level :root block. The dark ones are the :root block under prefers-color-scheme: dark.
// The theme is the system's alone, so there is no second, picked set.
const light = siteRules.filter((rule) => rule.selector === ":root" && rule.query === "").map((rule) => rule.body);
const systemDark = siteRules
  .filter((rule) => rule.selector === ":root" && /prefers-color-scheme:\s*dark/.test(rule.query))
  .map((rule) => rule.body);

if (!light.length) errors.push("site.css has no top-level :root block");
if (!systemDark.length) errors.push("site.css has no :root block under prefers-color-scheme: dark");

for (const [mode, expected, bodies] of [
  ["light", EXPECTED.light, light],
  ["dark", EXPECTED.dark, systemDark],
]) {
  for (const [token, value] of Object.entries(expected)) {
    const got = declared(bodies, token);
    if (got !== value) errors.push(`${mode} ${token}: expected ${value}, got ${got}`);
  }
}

const docsRules = rules(docsCss);
if (!docsCss) console.log(`Docs repo not found at ${docsFile}; skipping the docs token comparison. Set DRAGGY_DOCS to run it.`);
const SHARED = ["--bg", "--surface", "--stage", "--ink", "--muted", "--line", "--accent", "--accent-text", "--accent-ink"];
for (const [mode, siteBodies, docsBodies] of [
  ["light", light, docsRules.filter((rule) => rule.selector === ":root" && rule.query === "").map((rule) => rule.body)],
  ["dark", systemDark, docsRules.filter((rule) => rule.selector === ":root" && /prefers-color-scheme:\s*dark/.test(rule.query)).map((rule) => rule.body)],
]) {
  if (!docsCss) break;
  for (const token of SHARED) {
    const site = declared(siteBodies, token);
    const docs = declared(docsBodies, token);
    if (site !== docs) errors.push(`docs.css ${mode} ${token} is ${docs}, site.css has ${site}`);
  }
}

const BANNED = [
  // A gradient is allowed only as a mask, which fades an edge out and paints nothing.
  [/(?<!mask-image:\s*)(?<!mask-image:\s*-webkit-)(radial|linear|conic)-gradient/i, "gradient"],
  [/blur\(/i, "blur"],
  [/text-shadow|drop-shadow/i, "glow"],
  [/border-radius:\s*(9999|999|50%|100(px|vw))/i, "pill radius"],
];
for (const [file, text] of Object.entries(css)) {
  for (const [re, name] of BANNED) if (re.test(text)) errors.push(`${file}: ${name} is banned`);
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*border-radius:\s*(\d+)px[^{}]*)\}/g)) {
    if (/\.btn|button|\.nav-cta/.test(rule[1]) && Number(rule[3]) > 14) errors.push(`${file}: button radius over 14px in ${rule[1].trim()}`);
  }
}

const appCandidates = [
  process.env.DRAGGY_APP && resolve(process.env.DRAGGY_APP),
  join(root, "..", "..", "app"),
].filter(Boolean);
const app = appCandidates.find((dir) => existsSync(join(dir, "src", "index.css"))) || appCandidates[0];
const appCssPath = join(app, "src", "index.css");
if (existsSync(appCssPath)) {
  const appRules = rules(readFileSync(appCssPath, "utf8"));
  const appLight = appRules.filter((rule) => rule.selector === ":root" && rule.query === "").map((rule) => rule.body);
  const appDark = appRules
    .filter((rule) => rule.selector.split(",").map((s) => s.trim()).some((s) => s === ".dark" || s === "body.dark"))
    .map((rule) => rule.body);

  // The app still ships its older accent until its own theme change lands, so a difference is reported and not failed.
  const appAccent = declared(appLight, "--accent");
  if (appAccent && appAccent !== declared(light, "--accent")) console.log(`Note: light --accent differs from the app (${appAccent})`);
  const appAccentDark = declared(appDark, "--accent");
  if (appAccentDark && appAccentDark !== declared(systemDark, "--accent")) console.log(`Note: dark --accent differs from the app (${appAccentDark})`);
} else {
  console.log(`App repo not found at ${app}; skipping the accent comparison. Set DRAGGY_APP to run it.`);
}

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log("Tokens check passed.");
