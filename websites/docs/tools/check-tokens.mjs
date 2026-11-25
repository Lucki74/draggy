/**
 * Checks assets/css/docs.css against the banned patterns, and its copy of the design tokens against
 * the site's own in site.css. The site is DRAGGY_SITE when that is set, else ../www beside
 * this repo. Without it the token comparison is skipped and the pattern checks still run, as they do
 * on Vercel builds.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsCss = readFileSync(join(root, "assets", "css", "docs.css"), "utf8");
const siteFile = join(process.env.DRAGGY_SITE ? resolve(process.env.DRAGGY_SITE) : join(root, "..", "www"), "assets", "css", "site.css");
const errors = [];

/** Every style rule with the at-rules it sits inside, as { selector, query, body }. */
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

const roots = (text) => {
  const all = rules(text);
  return {
    light: all.filter((r) => r.selector === ":root" && r.query === "").map((r) => r.body),
    dark: all.filter((r) => r.selector === ":root" && /prefers-color-scheme:\s*dark/.test(r.query)).map((r) => r.body),
  };
};

if (existsSync(siteFile)) {
  const site = roots(readFileSync(siteFile, "utf8"));
  const docs = roots(docsCss);
  const SHARED = ["--bg", "--surface", "--stage", "--ink", "--muted", "--line", "--accent", "--accent-text", "--accent-ink"];
  for (const mode of ["light", "dark"]) {
    for (const token of SHARED) {
      const want = declared(site[mode], token);
      const got = declared(docs[mode], token);
      if (want !== got) errors.push(`docs.css ${mode} ${token} is ${got}, site.css has ${want}`);
    }
  }
} else {
  console.log(`Site repo not found at ${siteFile}; skipping the token comparison. Set DRAGGY_SITE to run it.`);
}

const BANNED = [
  // A gradient is allowed only as a mask, which fades an edge out and paints nothing.
  [/(?<!mask-image:\s*)(?<!mask-image:\s*-webkit-)(radial|linear|conic)-gradient/i, "gradient"],
  [/blur\(/i, "blur"],
  [/text-shadow|drop-shadow/i, "glow"],
  [/border-radius:\s*(9999|999|50%|100(px|vw))/i, "pill radius"],
];
for (const [re, name] of BANNED) if (re.test(docsCss)) errors.push(`docs.css: ${name} is banned`);
for (const rule of docsCss.matchAll(/([^{}]+)\{([^{}]*border-radius:\s*(\d+)px[^{}]*)\}/g)) {
  if (/\.btn|button/.test(rule[1]) && Number(rule[3]) > 14) errors.push(`docs.css: button radius over 14px in ${rule[1].trim()}`);
}

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log("Tokens check passed.");
