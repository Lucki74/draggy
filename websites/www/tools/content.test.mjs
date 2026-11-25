/**
 * Text and addresses, checked without a browser.
 *
 *   npm test
 *
 * Two things a page can get wrong without looking wrong in the editor: text that was saved in one
 * encoding and read in another, and a redirect that lands on a page the build never wrote. The
 * redirect forms that middleware.test.mjs already follows are not repeated here. This file adds
 * the trailing-slash forms, the language lists in vercel.json and middleware.js, and the www host.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(file, "utf8");
const jsonFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => join(dir, name));
const htmlFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith(".html")).map((name) => join(dir, name));

/* ---------- mojibake ---------- */

/**
 * What UTF-8 looks like once its bytes are read as Windows-1252 or Latin-1. An accented letter is
 * two bytes, so it turns into a capital A-tilde (or A-circumflex) followed by one more character:
 * e-acute becomes A-tilde then copyright sign, grave e becomes A-tilde then diaeresis, and a curly
 * apostrophe becomes A-circumflex, euro sign, then a quote. The replacement character is what a
 * decoder leaves when it gives up on the bytes altogether.
 */
const MOJIBAKE = [
  ["a Latin-1 accented letter read from UTF-8 (A-tilde then a symbol, as for e-acute or e-grave)", /Ã[\u0080-¿]/],
  ["a curly quote or dash read from UTF-8 as Windows-1252 (A-circumflex then euro sign)", /â€/],
  ["a no-break space or symbol read from UTF-8 (A-circumflex then a Latin-1 symbol)", /Â[ -¿]/],
  ["a replacement character", /�/],
  ["a replacement character read from UTF-8 as Latin-1 (i-diaeresis, inverted question mark, one-half sign)", /ï¿½/],
];

const textSources = [
  ...jsonFiles(join(root, "tools", "locales")),
  ...htmlFiles(join(root, "tools", "policy")),
  ...htmlFiles(join(root, "tools", "errors")),
];

test("the locale, policy and error sources are all found", () => {
  // A glob that matched nothing would pass every check below, so the list has to be real.
  assert.equal(jsonFiles(join(root, "tools", "locales")).length, 4);
  assert.equal(htmlFiles(join(root, "tools", "policy")).length, 4);
  assert.equal(htmlFiles(join(root, "tools", "errors")).length, 4);
});

test("no source holds mojibake, a replacement character or a double-encoded one", () => {
  const failures = [];
  for (const file of textSources) {
    read(file)
      .split("\n")
      .forEach((line, index) => {
        for (const [what, pattern] of MOJIBAKE) {
          if (pattern.test(line)) {
            failures.push(`${relative(root, file)}:${index + 1} has ${what}: ${line.trim().slice(0, 80)}`);
          }
        }
      });
  }
  assert.deepEqual(failures, []);
});

/* ---------- redirects ---------- */

const vercel = JSON.parse(read(join(root, "vercel.json")));

/** Mirrors the router's patterns for the shapes vercel.json uses. `:name` is one segment, `:name*` and `:name+` take the rest. */
function toRegExp(source) {
  const body = source
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/\/:(\w+)\*/g, "(?:/(?<$1>.*))?")
    .replace(/\/:(\w+)\+/g, "/(?<$1>.+)")
    .replace(/:(\w+)\(([^)]+)\)/g, "(?<$1>$2)")
    .replace(/:(\w+)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${body}$`);
}

function fill(destination, groups = {}) {
  const path = destination
    .replace(/\/:(\w+)[*+]/g, (_, name) => (groups[name] ? `/${groups[name]}` : ""))
    .replace(/:(\w+)/g, (_, name) => groups[name] ?? "");
  return path || "/";
}

/** The first path-based redirect that matches, or null. Host-only rules (www) are a different request and skipped. */
function redirectFor(path) {
  for (const rule of vercel.redirects) {
    if (rule.has) continue;
    const match = toRegExp(rule.source).exec(path);
    if (match) return fill(rule.destination, match.groups);
  }
  return null;
}

/**
 * Where a request finally lands, one hop at a time. After the redirects, the trailing-slash rule
 * applies: vercel.json sets trailingSlash to false, so "/privacy-policy/" is a permanent redirect to "/privacy-policy".
 */
function landing(path) {
  const hops = [];
  let at = path;
  for (;;) {
    const next = redirectFor(at) ?? (at.length > 1 && at.endsWith("/") ? at.slice(0, -1) : null);
    if (next === null) break;
    hops.push(next);
    at = next;
    assert.ok(hops.length <= 4, `${path} is still redirecting after ${hops.length} hops`);
  }
  return { at, hops: hops.length };
}

const scratch = mkdtempSync(join(tmpdir(), "draggy-content-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const out = join(scratch, "public");
execFileSync(process.execPath, [join(root, "tools", "build.mjs")], {
  cwd: root,
  env: { ...process.env, DRAGGY_OFFLINE: "1", DRAGGY_OUT: out },
  stdio: "pipe",
});

/** Whether the build wrote a page at this address: the file itself, or the index.html of its folder. */
function built(path) {
  const file = join(out, path);
  if (existsSync(file) && statSync(file).isFile()) return true;
  return existsSync(join(out, path, "index.html"));
}

test("every redirect form the site names lands on a page the build wrote", () => {
  // The destinations themselves are asserted in middleware.test.mjs. Here the question is only whether
  // each address the redirect reaches exists, so a typo in a destination fails here as well.
  const forms = [
    "/download",
    "/download/",
    "/en",
    "/en/",
    "/en/index.html",
    "/fr/download/",
    "/ru/download",
    "/de",
    "/index.html",
    "/fr/index.html",
  ];
  for (const form of forms) {
    const { at } = landing(form);
    assert.ok(built(at), `${form} lands on ${at}, which the build did not write`);
  }
});

test("a trailing slash still lands on the canonical address, in at most two hops", () => {
  // middleware.test.mjs follows the forms without the slash. With it, the /en/:path* rule keeps the
  // slash, and the trailingSlash setting in vercel.json removes it in a second redirect. The check is
  // on where the request ends up and how many hops it takes, not on the count itself.
  const expected = [
    ["/en/privacy-policy/", "/privacy-policy"],
    ["/en/download.html", "/download"],
  ];
  for (const [form, to] of expected) {
    const { at, hops } = landing(form);
    assert.equal(at, to, form);
    assert.ok(hops <= 2, `${form} takes ${hops} hops`);
    assert.ok(built(at), `${form} lands on ${at}, which the build did not write`);
  }
});

test("the language redirects in vercel.json name the languages middleware.js ships, and no others", () => {
  const middleware = read(join(root, "middleware.js"));
  const listed = middleware.match(/const SHIPPED = new Set\(\[([^\]]*)\]\)/);
  assert.ok(listed, "middleware.js declares SHIPPED");
  const shipped = [...listed[1].matchAll(/"([a-z]{2})"/g)].map((m) => m[1]).sort();

  // The language folders the build writes are the same four, so a language cannot be in one list and not the others.
  const locales = readdirSync(join(root, "tools", "locales"))
    .filter((name) => /^[a-z]{2}\.json$/.test(name))
    .map((name) => basename(name, ".json"))
    .sort();
  assert.deepEqual(shipped, locales);

  const lists = vercel.redirects.flatMap((rule) =>
    [...rule.source.matchAll(/:lang\(([a-z|]+)\)/g)].map((m) => m[1].split("|").sort()),
  );
  const shippedLists = lists.filter((list) => list.includes("fr"));
  assert.ok(shippedLists.length > 0, "vercel.json has a rule for the shipped languages");
  const withoutEnglish = shipped.filter((code) => code !== "en");
  for (const list of shippedLists) assert.deepEqual(list, withoutEnglish, list.join("|"));

  // The dropped languages are redirected to the root, so none of them may be a language the site ships.
  for (const list of lists.filter((list) => !list.includes("fr"))) {
    assert.deepEqual(list.filter((code) => shipped.includes(code)), [], list.join("|"));
  }
});

test("the www host redirect goes to the canonical host the built pages name", () => {
  const rule = vercel.redirects.find((r) =>
    (r.has ?? []).some((condition) => condition.type === "host" && condition.value === "www.draggy.org"),
  );
  assert.ok(rule, "vercel.json redirects www.draggy.org");
  assert.equal(rule.permanent, true);

  const canonical = read(join(out, "index.html")).match(/<link rel="canonical" href="([^"]+)"/)[1];
  assert.equal(new URL(rule.destination).origin, new URL(canonical).origin);
  assert.equal(new URL(rule.destination).pathname, "/:path*", "the path is carried over");
});
