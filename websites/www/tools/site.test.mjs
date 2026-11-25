/**
 * What the built site has to be, checked on the output rather than on the source.
 *
 *   npm test
 *
 * Builds first, from release.json rather than from GitHub, so the run does not depend on the
 * network or on what was released a minute ago.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every build the tests make goes under one temporary folder, which is removed when the file is done. */
const scratch = mkdtempSync(join(tmpdir(), "draggy-site-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const out = join(scratch, "public");

/** The Draggy app repo, for the checks that read it. DRAGGY_APP points elsewhere; defaults to the repo root. */
const appCandidates = [
  process.env.DRAGGY_APP && resolve(process.env.DRAGGY_APP),
  join(root, "..", ".."),
].filter(Boolean);
const app = appCandidates.find((dir) => existsSync(dir)) || appCandidates[0];

/** Builds the site into `dir`, from release.json. Only the output folder and the environment change between runs. */
function build(dir, env = {}) {
  execFileSync(process.execPath, [join(root, "tools", "build.mjs")], {
    cwd: root,
    env: { ...process.env, DRAGGY_OFFLINE: "1", DRAGGY_OUT: dir, ...env },
    stdio: "pipe",
  });
}

build(out);

const release = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const pages = walk(out).filter((file) => file.endsWith(".html"));
const read = (file) => readFileSync(file, "utf8");

/** The repository the site links to for its source, contribution guide and security policy. */
const REPO_URL = "https://github.com/Lucki74/draggy";

/** Every error page, as the English file names it. The build refuses a language that differs, so English is the list. */
const errorSlugs = [...read(join(root, "tools", "errors", "en.html")).matchAll(/^<!--#\s*([a-z-]+)\s*\|/gm)].map((m) => m[1]);

test("the build wrote all 184 pages", () => {
  assert.equal(pages.length, 184);
});

test("the privacy policy is at /privacy-policy in every language, and linked from every footer", () => {
  for (const code of ["", "fr/", "es/", "ru/"]) {
    const policy = read(join(out, code, "privacy-policy", "index.html"));
    assert.ok(/<h1>[^<]+<\/h1>/.test(policy), code);
    assert.ok(policy.includes("draggy-lang"), `${code}: the cookie is named`);
    assert.ok(/site-footer[^]*privacy-policy/.test(read(join(out, code, "index.html"))), `${code}: footer link`);
  }
});

test("the privacy policy names every key the site keeps in the browser, in every language", () => {
  for (const code of ["en", "fr", "es", "ru"]) {
    const policy = read(join(root, "tools", "policy", `${code}.html`));
    for (const key of ["draggy-lang"]) {
      assert.ok(policy.includes(`<code>${key}</code>`), `${code}: ${key} is not named`);
    }
  }
});

test("the home page carries no privacy section", () => {
  assert.ok(!read(join(out, "index.html")).includes('id="privacy"'));
});

test("no template tag is left in any page", () => {
  for (const file of pages) assert.doesNotMatch(read(file), /\{\{[^}]*\}\}/, file);
});

test("no source or page holds UTF-8 that was read as CP437 or CP850, or a replacement character", () => {
  // Box drawing and block characters, and a capital A with a tilde, are what the two bytes of an accented
  // letter look like once they are read in those codepages. U+FFFD is what a broken decode leaves behind.
  const garbled = (code) => code === 0xc3 || (code >= 0x2500 && code <= 0x259f) || code === 0xfffd;
  const sources = [
    ...walk(join(root, "tools", "locales")),
    ...walk(join(root, "tools", "errors")),
    ...walk(join(root, "tools", "policy")),
    ...walk(join(root, "tools", "pages")),
    ...pages,
    join(out, "sitemap.xml"),
    join(out, "llms.txt"),
  ];

  for (const file of sources) {
    const characters = [...read(file)];
    const found = characters.findIndex((ch) => garbled(ch.codePointAt(0)));
    assert.equal(found, -1, `${file} has ${characters[found]} at character ${found}`);
  }

  // Russian text has no Latin-1 letters, so a Cyrillic character read as CP850 shows up as one. The middle dot
  // (0xb7) is the one Latin-1 character Russian text uses. The language menu is left out: it names the
  // languages in their own words, French among them.
  const latin1 = (code) => (code >= 0xa0 && code <= 0xb6) || (code >= 0xb8 && code <= 0xff);
  const russian = [
    join(root, "tools", "locales", "ru.json"),
    join(root, "tools", "errors", "ru.html"),
    join(root, "tools", "policy", "ru.html"),
    ...pages.filter((file) => file.startsWith(join(out, "ru", ""))),
  ];
  for (const file of russian) {
    const characters = [...withoutScripts(read(file))
      .replace(/<details class="lang">[^]*?<\/details>/g, "")];
    const found = characters.findIndex((ch) => latin1(ch.codePointAt(0)));
    assert.equal(found, -1, `${file} has ${characters[found]} at character ${found}`);
  }
});

test("every request a page makes at load goes to this site", () => {
  const loads = /<(?:script|img|source|link|iframe)\b[^>]*?\b(?:src|srcset|href)="(https?:)?\/\/[^"]*"[^>]*>/gi;

  for (const file of pages) {
    for (const [tag] of read(file).matchAll(loads)) {
      // An <a> is not a request. A <link> only is when it asks for something to be loaded.
      if (/^<link\b/i.test(tag) && !/rel="(?:stylesheet|preload|icon|apple-touch-icon|modulepreload|prefetch)"/i.test(tag)) continue;
      assert.fail(`${file}: ${tag}`);
    }
  }
});

test("every image says how big it is, so nothing shifts when it arrives", () => {
  for (const file of pages) {
    for (const [tag] of read(file).matchAll(/<img\b[^>]*>/g)) {
      assert.match(tag, /\bwidth="\d+"/, `${file}: ${tag}`);
      assert.match(tag, /\bheight="\d+"/, `${file}: ${tag}`);
      assert.match(tag, /\balt="/, `${file}: ${tag}`);
    }
  }
});

test("the home and download pages name their version and links from the release", () => {
  const home = read(join(out, "index.html"));
  const download = read(join(out, "download", "index.html"));

  assert.match(home, new RegExp(`Build ${release.build}`));
  for (const asset of Object.values(release.assets)) {
    assert.match(download, new RegExp(asset.url.replaceAll(".", "\\.")));
  }
  assert.match(release.assets["windows-exe"].sha512, /^[0-9a-f]{128}$/);
});

test("the structured data parses and carries the release version", () => {
  const html = read(join(out, "index.html"));
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
  const app = data["@graph"].find((item) => item["@type"] === "SoftwareApplication");

  assert.equal(app.softwareVersion, release.version);
  assert.equal(app.isAccessibleForFree, true);
  assert.match(app.license, /\/LICENSE$/);
});

test("the home description fits a search result: 160 characters or fewer in every language", () => {
  for (const lang of ["", "fr/", "es/", "ru/"]) {
    const description = read(join(out, lang, "index.html")).match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok([...description].length <= 160, `${lang || "en/"}: ${[...description].length} characters`);
  }
});

test("each indexable page lists all four languages and x-default", () => {
  for (const file of [join(out, "index.html"), join(out, "fr", "download", "index.html"), join(out, "ru", "open-source", "index.html")]) {
    const links = read(file).match(/<link rel="alternate" hreflang="[^"]+"/g) ?? [];
    assert.equal(links.length, 5, file);
  }
});

/** The page without its scripts, stripped until nothing changes so no tag is left half removed. */
function withoutScripts(html) {
  let previous;
  do {
    previous = html;
    html = html.replace(/<script\b[^]*?<\/script\b[^>]*>/gi, "");
  } while (html !== previous);
  return html;
}

test("English never says offline: the app goes online for search, updates and extensions", () => {
  for (const file of pages.filter((file) => !/[\\/](?:es|fr|ru)[\\/]/.test(file.replace(out, "")))) {
    assert.doesNotMatch(withoutScripts(read(file)), /offline/i, file);
  }
});

test("no page links to an index.html: a home page is linked at its canonical, / or /fr", () => {
  for (const file of pages) {
    assert.doesNotMatch(read(file), /href="[^"]*index\.html(?:#[^"]*)?"/, file);
  }
});

test("the sitemap claims no lastmod the build cannot know", () => {
  assert.doesNotMatch(read(join(out, "sitemap.xml")), /<lastmod>/);
});

test("every inline script a page runs is allowed by the Content-Security-Policy in vercel.json", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const csp = vercel.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy").value;

  // Edit the theme script in tools/build.mjs and its hash in vercel.json has to change with it.
  for (const file of pages) {
    for (const [, body] of read(file).matchAll(/<script>([^]*?)<\/script\s*>/gi)) {
      const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
      assert.ok(csp.includes(hash), `${file}: ${hash} is not in the CSP`);
    }
  }
});

test("security.txt names a contact and has not expired", () => {
  const text = read(join(out, ".well-known", "security.txt"));
  assert.match(text, /^Contact: https:\/\//m);
  const expires = new Date(text.match(/^Expires: (.+)$/m)[1]);
  const day = 24 * 60 * 60 * 1000;
  assert.ok(expires > new Date(Date.now() + 300 * day), "security.txt expires most of a year after the build");
  assert.ok(expires < new Date(Date.now() + 365 * day), "security.txt expires within a year, as RFC 9116 asks");
});

test("security.txt has a Contact and an Expires line in RFC 9116 form", () => {
  const text = read(join(out, ".well-known", "security.txt"));
  assert.match(text, /^Contact: https:\/\/\S+$/m);
  assert.match(text, /^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
});

/** A vercel.json redirect source as a regular expression over the path it matches. */
function redirectPattern(source) {
  const pattern = source
    .replace(/:([a-zA-Z]+)\(([^)]*)\)/g, "($2)")
    .replace(/:[a-zA-Z]+\*/g, ".*")
    .replace(/:[a-zA-Z]+\+/g, ".+")
    .replace(/:[a-zA-Z]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

test("no vercel.json redirect catches /.well-known/security.txt", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  // A redirect with a "has" clause only fires on some requests, such as the www host, so it cannot catch every visitor.
  const caught = vercel.redirects
    .filter((rule) => !rule.has)
    .filter((rule) => redirectPattern(rule.source).test("/.well-known/security.txt"))
    .map((rule) => rule.source);
  assert.deepEqual(caught, []);
});

test("the open source, compare and accessibility pages are in every language, with a title and a canonical", () => {
  for (const code of ["", "fr/", "es/", "ru/"]) {
    for (const slug of ["open-source", "compare", "accessibility", "pricing"]) {
      const html = read(join(out, code, slug, "index.html"));
      assert.match(html, /<title>[^<]+<\/title>/, `${code}${slug}: title`);
      assert.ok(html.includes(`<link rel="canonical" href="https://draggy.org/${code}${slug}" />`), `${code}${slug}: canonical`);
    }
  }
});

test("the compare table has a header and ten rows, each with a label and five product cells, in every language", () => {
  for (const code of ["", "fr/", "es/", "ru/"]) {
    const rows = read(join(out, code, "compare", "index.html")).match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
    assert.equal(rows.length, 11, `${code || "en/"}compare: header and ten rows`);
    for (const row of rows) {
      assert.equal((row.match(/<(?:th|td)[ >]/g) ?? []).length, 6, `${code || "en/"}compare: ${row}`);
    }
  }
});

test("every footer links the new pages, the contribution guide and the security policy, in every language", () => {
  for (const code of ["", "fr/", "es/", "ru/"]) {
    const footer = read(join(out, code, "index.html")).match(/<footer[\s\S]*?<\/footer>/)[0];
    for (const slug of ["open-source", "compare", "accessibility", "pricing"]) {
      assert.match(footer, new RegExp(`href="[^"]*${slug}"`), `${code || "en/"}: footer link to ${slug}`);
    }
    assert.ok(footer.includes(`${REPO_URL}/blob/main/CONTRIBUTING.md`), `${code || "en/"}: contribution guide`);
    assert.ok(footer.includes(`${REPO_URL}/blob/main/SECURITY.md`), `${code || "en/"}: security policy`);
  }
});

test("every dropped-language URL in the sitemap resolves through vercel.json to an existing page", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const redirects = vercel.redirects;

  const dropped = ["de", "it", "pt", "nl", "ru", "ja", "ko", "ar"];
  const paths = [
    "",
    "/download",
    "/privacy-policy",
    "/error",
  ];

  // Helper matching the two vercel.json dropped-language redirect rules
  const rule1 = /^\/(de|it|pt|nl|ru|ja|ko|ar)$/;
  const rule2 = /^\/(de|it|pt|nl|ru|ja|ko|ar)\/(.*)$/;

  for (const lang of dropped) {
    for (const p of paths) {
      const url = `/${lang}${p}`;
      let dest = null;
      if (rule1.test(url)) {
        dest = "/";
      } else {
        const m = url.match(rule2);
        assert.ok(m, `${url} matches dropped-language redirect rule`);
        dest = `/${m[2]}`;
      }

      const filePath = dest === "/"
        ? join(out, "index.html")
        : dest.endsWith(".html")
          ? join(out, dest.slice(1))
          : join(out, dest.slice(1), "index.html");

      assert.ok(statSync(filePath).isFile(), `${url} redirects to ${dest} which resolves to ${filePath}`);
    }
  }
});

test("a build with 24 stars prints no count, and one with 25 prints it", () => {
  const at24 = join(scratch, "stars-24");
  const at25 = join(scratch, "stars-25");
  build(at24, { DRAGGY_STARS: "24" });
  build(at25, { DRAGGY_STARS: "25" });

  const html24 = read(join(at24, "index.html"));
  assert.match(html24, /class="nav-stars"/);
  assert.doesNotMatch(html24, /<a class="nav-stars"[^>]*>[\s\S]*?<span>24<\/span>/);

  const html25 = read(join(at25, "index.html"));
  assert.match(html25, /<a class="nav-stars"[^>]*>[\s\S]*?<span>25<\/span>/);
  assert.match(html25, /25<\/span>/);
});

test("every URL in the URL contract exists after the build", () => {
  const languages = ["", "fr/", "es/", "ru/"];
  for (const lang of languages) {
    assert.ok(statSync(join(out, lang, "index.html")).isFile());
    assert.ok(statSync(join(out, lang, "download", "index.html")).isFile());
    assert.ok(statSync(join(out, lang, "privacy-policy", "index.html")).isFile());
    assert.ok(statSync(join(out, lang, "open-source", "index.html")).isFile());
    assert.ok(statSync(join(out, lang, "compare", "index.html")).isFile());
    assert.ok(statSync(join(out, lang, "accessibility", "index.html")).isFile());
    assert.ok(statSync(join(out, lang, "error", "index.html")).isFile());

    for (const slug of errorSlugs) {
      const p = join(out, lang, "error", slug, "index.html");
      assert.ok(statSync(p).isFile(), `Missing error page: ${p}`);
    }
  }

  assert.ok(statSync(join(out, "404.html")).isFile());
  assert.ok(statSync(join(out, "llms.txt")).isFile());
  assert.ok(statSync(join(out, "robots.txt")).isFile());
  assert.ok(statSync(join(out, "sitemap.xml")).isFile());
  assert.ok(statSync(join(out, ".well-known", "security.txt")).isFile());
});

/** The language a built page belongs to: its folder for fr, es and ru, and "" for English, which lives at the root. */
const languageOf = (file) => {
  const first = relative(out, file).split(/[\\/]/)[0];
  return ["fr", "es", "ru"].includes(first) ? first : "";
};

/** The file a relative href points at: a folder means its index.html, as the server serves it. */
const fileFor = (from, path) => {
  const target = resolve(dirname(from), path);
  return target.endsWith(".html") ? target : join(target, "index.html");
};

test("the /error index links every error page, in every language, and nothing else", () => {
  for (const lang of ["", "fr/", "es/", "ru/"]) {
    const index = read(join(out, lang, "error", "index.html"));
    for (const slug of errorSlugs) {
      assert.ok(index.includes(`error/${slug}"`), `${lang || "en/"}error/index.html does not link ${slug}`);
    }
    assert.equal((index.match(/<li><a href="[^"]*\/error\/[^"]*"/g) ?? []).length, errorSlugs.length, `${lang || "en/"}error/index.html`);
  }
});

test("every error slug in engineErrors.ts has a page in all four languages", (t) => {
  const engineErrorsCandidates = [
    join(app, "app", "src", "ai", "engineErrors.ts"),
    join(app, "src", "ai", "engineErrors.ts"),
  ];
  const engineErrorsPath = engineErrorsCandidates.find(existsSync) || engineErrorsCandidates[0];
  if (!existsSync(engineErrorsPath)) return t.skip(`no ${engineErrorsPath}; set DRAGGY_APP to the app repo`);

  const content = readFileSync(engineErrorsPath, "utf8");
  const slugs = new Set([...content.matchAll(/slug:\s*"([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(slugs.size > 0);

  const languages = ["", "fr/", "es/", "ru/"];
  for (const slug of slugs) {
    for (const lang of languages) {
      const p = join(out, lang, "error", slug, "index.html");
      assert.ok(existsSync(p), `Missing error page for slug '${slug}' in ${lang || "en"}`);
    }
  }
});

test("every draggy.org link in the app README resolves", (t) => {
  const readmePath = join(app, "README.md");
  if (!existsSync(readmePath)) return t.skip(`no ${readmePath}; set DRAGGY_APP to the app repo`);

  const content = readFileSync(readmePath, "utf8");
  const urls = [...content.matchAll(/https:\/\/draggy\.org(\/[^)\s"\\]*)?/g)].map((m) => m[1] || "/");
  assert.ok(urls.length > 0);

  for (const urlPath of urls) {
    const clean = urlPath.replace(/#.*$/, "");
    if (/^\/(fr\/|es\/|ru\/)?wiki(\/|$)/.test(clean)) continue; // redirected to docs.draggy.org
    const target = clean === "/"
      ? join(out, "index.html")
      : clean.endsWith(".html")
        ? join(out, clean.slice(1))
        : join(out, clean.slice(1), "index.html");
    assert.ok(existsSync(target), `README link ${urlPath} resolves to ${target}`);
  }
});

test("download links match the release version and formatted sizes", () => {
  const html = read(join(out, "download", "index.html"));
  for (const [key, asset] of Object.entries(release.assets)) {
    assert.ok(html.includes(asset.url), `download page missing link for ${key}`);
    if (key === "linux-rpm") continue; // the Linux card shows the size of the .deb only
    const size = `${Math.round(asset.size / (1024 * 1024))} MB`;
    assert.ok(html.includes(size), `download page missing formatted size ${size}`);
  }
});

test("the download page has a specs table for each system in every language", () => {
  for (const lang of ["", "fr/", "es/", "ru/"]) {
    const html = read(join(out, lang, "download", "index.html"));
    for (const os of ["windows", "linux"]) {
      const spec = html.match(new RegExp(`<div class="spec"[^>]*data-spec-os="${os}"[^]*?</table>`))?.[0] ?? "";
      assert.ok(spec, `${lang || "en/"}download has no ${os} specs`);
      assert.equal((spec.match(/<th scope="row">/g) ?? []).length, 6, `${lang || "en/"}${os}: six rows`);
    }
  }
});

test("the 404 language menu links each language's home page, not a 404 copy", () => {
  for (const code of ["en", "fr", "es", "ru"]) {
    const html = read(join(out, code === "en" ? "404.html" : `${code}/404.html`));
    const menu = html.match(/<details class="lang">[\s\S]*?<\/details>/)[0];
    assert.ok(!/404\.html/.test(menu), `${code}: a language link still points at a 404 page`);
    for (const home of ["/", "/fr", "/es", "/ru"]) assert.ok(menu.includes(`href="${home}"`), `${code}: no link to ${home}`);
  }
});

/* ---------- the v4 redesign: acceptance checks ---------- */

const repoText = () =>
  [...walk(join(root, "tools")), ...walk(join(root, "assets", "js")), ...walk(join(root, "assets", "css")), join(root, "AGENTS.md"), join(root, "vercel.json")]
    .filter((file) => /\.(html|json|mjs|cjs|js|css|md)$/.test(file) && existsSync(file));

test("no em dashes in any page, locale file, template or repo doc", () => {
  const files = [...repoText(), ...pages, join(out, "llms.txt")];
  for (const file of files) {
    if (file.endsWith("check-tokens.mjs") || file.endsWith("site.test.mjs")) continue;
    assert.ok(!read(file).includes("\u2014"), `${file} has an em dash`);
  }
});

test("nothing references the ASCII dragon, the poses or the callouts", () => {
  for (const file of repoText()) {
    if (file.endsWith("site.test.mjs") || file.endsWith("AGENTS.md")) continue;
    assert.doesNotMatch(read(file), /dragon\.js|art\/ascii|\{\{dragon|dragon-grid|class="callout|poses\.mjs/, file);
  }
  for (const file of pages) assert.doesNotMatch(read(file), /dragon-grid|class="callout|hero-dragon|<pre class="dragon/, file);
});

test("the CSS has no gradients, blur or pill buttons, and the page has no theme toggle", () => {
  for (const file of walk(join(root, "assets", "css")).filter((f) => f.endsWith(".css"))) {
    // A gradient is allowed only as a mask, which fades an edge out and paints nothing.
    assert.doesNotMatch(read(file).replace(/(-webkit-)?mask-image:[^;]*;/g, ""), /gradient\(|blur\(/, file);
  }
  assert.ok(!read(join(out, "index.html")).includes("theme-toggle"));
});

test("every image has width, height and alt text", () => {
  for (const file of pages) {
    for (const tag of read(file).match(/<img\b[^>]*>/g) ?? []) {
      assert.match(tag, /\swidth="\d+"/, `${file}: ${tag}`);
      assert.match(tag, /\sheight="\d+"/, `${file}: ${tag}`);
      assert.match(tag, /\salt="/, `${file}: ${tag}`);
    }
  }
});

test("every clip is muted, inline, looping and loads nothing up front", () => {
  for (const file of pages) {
    for (const tag of read(file).match(/<video\b[^>]*>/g) ?? []) {
      for (const attr of ["muted", "playsinline", "loop", 'preload="none"', "data-poster="]) assert.ok(tag.includes(attr), `${file}: ${attr}`);
      assert.ok(!tag.includes("autoplay"), `${file}: autoplay`);
    }
  }
});

test("the home page has ten feature clips", () => {
  const html = read(join(out, "index.html"));
  assert.equal((html.match(/<figure class="clip"/g) ?? []).length, 10);
});

test("the home page weighs under 600 KB of HTML, CSS and JS", () => {
  const size = (file) => statSync(join(out, file)).size;
  assert.ok(size("index.html") + size("assets/css/site.css") + size("assets/css/home.css") + size("assets/js/site.js") < 600 * 1024);
});
