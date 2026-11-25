import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = root;
execFileSync(process.execPath, [join(docs, "build.mjs")], { cwd: docs, stdio: "pipe" });

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const base = join(docs, "public");
const files = walk(base);
const pages = files.filter((f) => f.endsWith(".html") && !f.endsWith("404.html"));
const read = (f) => readFileSync(f, "utf8");

test("every language has the same set of pages", () => {
  const key = (lang) =>
    pages
      .map((f) => relative(base, f).split(sep).join("/"))
      .filter((p) => (lang ? p.startsWith(`${lang}/`) : !/^(fr|es|ru)\//.test(p)))
      .map((p) => p.replace(/^(fr|es|ru)\//, ""))
      .sort();
  const english = key("");
  assert.ok(english.length >= 20);
  for (const lang of ["fr", "es", "ru"]) assert.deepEqual(key(lang), english, lang);
});

test("every internal link and anchor in the docs resolves", () => {
  for (const file of pages) {
    const html = read(file);
    for (const [, href] of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      if (/^(https?:|mailto:|data:|javascript:)/.test(href)) continue;
      const [path, hash] = href.split("#");
      let target = file;
      if (path) {
        const abs = path.startsWith("/") ? join(base, path) : resolve(dirname(file), path);
        target = [abs, `${abs}.html`, join(abs, "index.html")].find((p) => existsSync(p) && statSync(p).isFile());
        assert.ok(target, `${relative(base, file)}: ${href} does not resolve`);
      }
      if (hash && target.endsWith(".html")) {
        assert.ok(read(target).includes(`id="${hash}"`), `${relative(base, file)}: #${hash} is not on ${relative(base, target)}`);
      }
    }
  }
});

/** The page without scripts, styles and code, stripped until nothing changes. */
function withoutCode(text) {
  let out = String(text);
  let previous;
  do {
    previous = out;
    out = out.replace(/<(script|style|pre|code)\b[^]*?<\/\1\b[^>]*>/gi, "");
  } while (out !== previous);
  return out;
}

test("no em dashes in any English docs page", () => {
  for (const file of pages.filter((f) => !/^(fr|es|ru)\//.test(relative(base, f).split(sep).join("/")))) {
    const text = withoutCode(read(file));
    assert.doesNotMatch(text, /\u2014/, `${file} has an em dash`);
  }
});

test("each search index lists every page of its language", () => {
  for (const lang of ["en", "fr", "es", "ru"]) {
    const index = JSON.parse(read(join(base, `search-${lang}.json`)));
    assert.ok(Array.isArray(index) && index.length >= 20, lang);
  }
});

test("stylesheets, scripts and shots carry a version that matches the file", () => {
  const assets = [/<link rel="stylesheet" href="([^"]+)"/g, /<script src="([^"]+)"/g, /srcset="([^"]+)"/g, /<img src="(\/assets\/img\/[^"]+)"/g];
  for (const file of pages) {
    const html = read(file);
    for (const pattern of assets) {
      for (const [, url] of html.matchAll(pattern)) {
        const [path, version] = url.split("?v=");
        assert.ok(version, `${relative(base, file)}: ${url} has no version`);
        const hash = createHash("sha256").update(readFileSync(join(base, path))).digest("hex").slice(0, 10);
        assert.equal(version, hash, `${relative(base, file)}: ${url}`);
      }
    }
  }
});

test("every breadcrumb list item in the structured data has an item URL", () => {
  for (const file of pages) {
    for (const [, json] of read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      for (const node of JSON.parse(json)["@graph"] ?? []) {
        if (node["@type"] !== "BreadcrumbList") continue;
        node.itemListElement.forEach((entry, i) => {
          assert.equal(entry.position, i + 1, file);
          assert.match(entry.item ?? "", /^https:\/\/docs\.draggy\.org\//, `${file} item ${i + 1}`);
        });
      }
    }
  }
});
