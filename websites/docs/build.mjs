// Builds docs.draggy.org from Markdown in src/<lang>/ into public/.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, Renderer } from "marked";

const root = dirname(fileURLToPath(import.meta.url));
const out = process.env.DOCS_OUT || join(root, "public");
const SITE = "https://docs.draggy.org";
const MAIN = "https://draggy.org";
const REPO = "https://github.com/Lucki74/draggy";
const WEB_REPO = "https://github.com/Lucki74/draggy/tree/main/websites/www";
const DOCS_REPO = "https://github.com/Lucki74/draggy/tree/main/websites/docs";
const LANGS = [
  { code: "en", name: "English", html: "en" },
  { code: "fr", name: "Français", html: "fr" },
  { code: "es", name: "Español", html: "es" },
  { code: "ru", name: "Русский", html: "ru" },
];
const SHOT_ALT_FALLBACK = "Draggy";

const read = (p) => readFileSync(join(root, p), "utf8");
// Assets are cached as immutable, so a URL has to change whenever the file does.
const asset = (p) => `/${p}?v=${createHash("sha256").update(readFileSync(join(root, p))).digest("hex").slice(0, 10)}`;
const nav = JSON.parse(read("nav.json"));
const counts = JSON.parse(read("site.json"));
const shots = JSON.parse(read("shots.json"));
const markSvg = read("assets/mark.svg");
const icons = JSON.parse(read("icons.json"));
const icon = (name) => `<svg class="ico" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${icons[name]}"/></svg>`;
const GROUP_ICON = { start: "rocket-launch", use: "chat-circle-text", control: "shield-check", providers: "plugs-connected", customize: "sliders-horizontal", reference: "book-open-text", help: "lifebuoy" };
const CALLOUT_ICON = { note: "info", tip: "lightbulb", warning: "warning", important: "warning-circle" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseFile(path) {
  const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n+/.exec(raw);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    const v = line.slice(i + 1).trim();
    meta[line.slice(0, i).trim()] = v.startsWith('"') ? JSON.parse(v) : v;
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

/** Plain text from markup, stripped until nothing changes so no tag is left half removed. */
function stripTags(text) {
  let out = String(text);
  let previous;
  do {
    previous = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== previous);
  return out;
}

const slugify = (s) => stripTags(s.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
const plain = (md) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[!(NOTE|TIP|WARNING|IMPORTANT|PLATFORMS)\]/g, "")
    .replace(/^>\s*-\s/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*#>|]/g, "")
    .replace(/\{#[^}]*\}/g, "")
    .replace(/\{\{n:[a-zA-Z]+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();

function subst(text) {
  return text.replace(/\{\{n:([a-zA-Z]+)\}\}/g, (_, k) => {
    if (!(k in counts)) throw new Error(`{{n:${k}}} is not in site.json`);
    return String(counts[k]);
  });
}

const flat = nav.tabs.flatMap((t) => t.groups.flatMap((g) => g.slugs));
const urlOf = (lang, slug) => (lang === "en" ? "" : `/${lang}`) + (slug === "index" ? "" : `/${slug}`) || "/";
const fileOf = (lang, slug) => join(out, lang === "en" ? "" : lang, slug === "index" ? "index.html" : `${slug}.html`);
const mainUrl = (lang, page) => `${MAIN}${lang === "en" ? "" : `/${lang}`}/${page}`;

function renderer(ctx) {
  const toc = [];
  const used = new Set();
  const r = {
    heading({ tokens, depth, text }) {
      let inner = this.parser.parseInline(tokens);
      let id;
      const m = /\s*\{#([\w-]+)\}\s*$/.exec(inner);
      if (m) {
        id = m[1];
        inner = inner.slice(0, m.index);
      } else id = slugify(inner);
      let n = id, i = 2;
      while (used.has(n)) n = `${id}-${i++}`;
      used.add(n);
      if (depth === 2 || depth === 3) toc.push({ depth, id: n, text: stripTags(inner) });
      return `<h${depth} id="${n}">${inner}<a class="anchor" href="#${n}" aria-label="${esc(ctx.t["onThisPage"])}: ${esc(stripTags(inner))}">#</a></h${depth}>\n`;
    },
    link({ href, tokens, title }) {
      const inner = this.parser.parseInline(tokens);
      let h = href;
      let ext = false;
      if (h.startsWith("doc:")) {
        const [slug, hash] = h.slice(4).split("#");
        if (!flat.includes(slug) && slug !== "index") throw new Error(`${ctx.file}: unknown doc link ${href}`);
        ctx.links.push(slug);
        h = urlOf(ctx.lang, slug) + (hash ? `#${hash}` : "");
      } else if (h.startsWith("site:")) {
        h = mainUrl(ctx.lang, h.slice(5));
        ext = true;
      } else if (/^https?:/.test(h)) ext = true;
      return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${inner}</a>`;
    },
    image({ href, text }) {
      if (!href.startsWith("shot:")) return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
      const name = href.slice(5);
      const size = shots[name];
      if (!size) throw new Error(`${ctx.file}: shot ${name} is not in shots.json`);
      ctx.shots.add(name);
      // The shot taken in this page's language when there is one, else the English shot.
      const own = (t, e) => `assets/img/${name}-${ctx.lang}-${t}.${e}`;
      const src = (t, e) => asset(ctx.lang !== "en" && existsSync(join(root, own(t, e))) ? own(t, e) : `assets/img/${name}-${t}.${e}`);
      const srcs = ["dark", "light"].flatMap((t) =>
        ["avif", "webp"].map((e) => `<source media="(prefers-color-scheme: ${t})" type="image/${e}" srcset="${src(t, e)}">`),
      );
      return `<figure class="shot"><picture>${srcs.join("")}<img src="${src("light", "png")}" alt="${esc(text || SHOT_ALT_FALLBACK)}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async"></picture></figure>`;
    },
    code({ text, lang }) {
      const label = lang ? `<span class="code-lang">${esc(lang)}</span>` : "";
      return `<div class="code"><div class="code-bar">${label}<button type="button" class="copy" data-copy="${esc(ctx.t.copy)}" data-done="${esc(ctx.t.copied)}">${icon("copy")}<span>${esc(ctx.t.copy)}</span></button></div><pre tabindex="0"><code>${esc(text)}</code></pre></div>\n`;
    },
    table(token) {
      const html = Renderer.prototype.table.call(this, token);
      return `<div class="table-wrap" role="region" aria-label="${esc(ctx.t.tableScroll)}" tabindex="0">${html}</div>\n`;
    },
    blockquote({ tokens }) {
      const first = tokens[0];
      if (first?.type === "paragraph" && /^\[!PLATFORMS\]/.test(first.text)) {
        const panels = tokens
          .find((x) => x.type === "list")
          .items.map((item) => {
            const line = item.tokens[0];
            const name = /^([^:]+):\s*/.exec(line.tokens[0].text);
            if (!name) throw new Error(`platform block needs "System: text" in ${ctx.lang}`);
            line.tokens[0].text = line.tokens[0].text.slice(name[0].length);
            return `<div class="platform" data-os="${esc(name[1].toLowerCase())}"><p class="platform-name">${esc(name[1])}</p><p>${this.parser.parseInline(line.tokens)}</p></div>`;
          })
          .join("");
        return `<div class="platforms" data-platforms="${esc(ctx.t["platforms.label"])}">${panels}</div>\n`;
      }
      const m = first && first.type === "paragraph" && /^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/i.exec(first.text);
      if (!m) return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
      const kind = m[1].toLowerCase();
      const strip = (v) => v.replace(/^\[![A-Za-z]+\]\s*/, "");
      if (first.tokens[0]) {
        first.tokens[0].text = strip(first.tokens[0].text ?? "");
        if (first.tokens[0].raw) first.tokens[0].raw = strip(first.tokens[0].raw);
      }
      return `<aside class="callout callout-${kind}"><p class="callout-title">${icon(CALLOUT_ICON[kind])}${esc(ctx.t[kind])}</p>${this.parser.parse(tokens)}</aside>\n`;
    },
  };
  return { r, toc };
}

function render(md, ctx) {
  const { r, toc } = renderer(ctx);
  const m = new Marked({ gfm: true, renderer: r });
  const html = m.parse(subst(md));
  return { html, toc };
}

const CARET = '<svg class="ico caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Every section of the docs, on every page. The section holding this page starts open. A group
// label only shows where a section has more than one group; it would repeat the section otherwise.
function sidebar(ctx, activeTab) {
  const { lang, t, titles } = ctx;
  const link = (s) => `<li><a href="${urlOf(lang, s) || "/"}"${s === ctx.slug ? ' aria-current="page"' : ""}>${esc(titles[s])}</a></li>`;
  return nav.tabs
    .map((tab) => {
      const groups = tab.groups
        .map((g) => {
          const label = tab.groups.length > 1 ? `<p class="side-label">${esc(t[`group.${g.key}`])}</p>` : "";
          return `${label}<ul>${g.slugs.filter((s) => titles[s]).map(link).join("")}</ul>`;
        })
        .join("");
      return `<details class="side-section"${tab.key === activeTab ? " open" : ""}><summary>${esc(t[`tab.${tab.key}`])}${CARET}</summary>${groups}</details>`;
    })
    .join("");
}

function langMenu(ctx) {
  const items = LANGS.map((l) => {
    const has = l.code === "en" || existsSync(join(root, "src", l.code, ctx.slug === "index" ? "_home.md" : `${ctx.slug}.md`));
    const href = has ? urlOf(l.code, ctx.slug) || "/" : urlOf(l.code, "index") || "/";
    return `<li><a href="${href}" hreflang="${l.html}" lang="${l.html}"${l.code === ctx.lang ? ' aria-current="true"' : ""}>${esc(l.name)}</a></li>`;
  }).join("");
  const cur = LANGS.find((l) => l.code === ctx.lang);
  return `<details class="lang"><summary aria-label="${esc(ctx.t.language)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9m0-18C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9M3.5 9h17M3.5 15h17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span class="lang-name">${esc(cur.name)}</span></summary><ul>${items}</ul></details>`;
}

function shell(ctx, { title, description, body, toc = [], tab, noindex = false }) {
  const { lang, t, slug } = ctx;
  const l = LANGS.find((x) => x.code === lang);
  const canonical = SITE + (urlOf(lang, slug) || "/");
  const alternates = LANGS.filter((x) => x.code === "en" || existsSync(join(root, "src", x.code, slug === "index" ? "_home.md" : `${slug}.md`)))
    .map((x) => `<link rel="alternate" hreflang="${x.html}" href="${SITE}${urlOf(x.code, slug) || "/"}">`)
    .join("");
  const tocHtml = toc.length
    ? `<nav class="toc" aria-label="${esc(t.onThisPage)}"><h2>${esc(t.onThisPage)}</h2><ul>${toc.map((x) => `<li class="d${x.depth}"><a href="#${x.id}">${esc(x.text)}</a></li>`).join("")}</ul></nav>`
    : "";
  const idx = flat.filter((s) => ctx.titles[s]).indexOf(slug);
  const list = flat.filter((s) => ctx.titles[s]);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const pn = (s, dir) =>
    s ? `<a class="pn ${dir}" href="${urlOf(lang, s) || "/"}" rel="${dir}"><span>${esc(t[dir === "prev" ? "previous" : "next"])}</span><strong>${esc(ctx.titles[s])}</strong></a>` : "<span></span>";
  const pager = slug !== "404" && idx >= 0 ? `<nav class="pager" aria-label="${esc(t.pageNav)}">${pn(prev, "prev")}${pn(next, "next")}</nav>` : "";
  const suggest =
    idx >= 0 && slug !== "index"
      ? `<p class="suggest"><a href="${REPO}/issues/new?title=${encodeURIComponent(`Docs: ${title}`)}" rel="noopener">${esc(t.suggest)}</a></p>`
      : "";
  const sectionStart = tab && nav.tabs.find((x) => x.key === tab).groups[0].slugs.find((s) => ctx.titles[s]);
  const crumb = tab && slug !== "index"
    ? `<nav class="crumb" aria-label="${esc(t.crumbs)}"><ol><li><a href="${urlOf(lang, "index") || "/"}">${esc(t["brand.docs"])}</a></li><li><a href="${urlOf(lang, sectionStart) || "/"}">${esc(t[`tab.${tab}`])}</a></li><li aria-current="page">${esc(title)}</li></ol></nav>`
    : "";
  const mainHref = `${MAIN}${lang === "en" ? "/" : `/${lang}/`}`;
  const side = `<nav class="side" id="side" aria-label="${esc(t.sidebar)}">${sidebar(ctx, tab)}<div class="side-foot"><a class="main-link" href="${mainHref}" rel="noopener">${esc(t.mainSite)}</a><a class="nav-cta" href="${mainUrl(lang, "download")}" rel="noopener">${esc(t.download)}</a></div></nav>`;
  const upNext = next && tab ? `<div class="up-next"><p>${esc(t.upNext)}</p><a href="${urlOf(lang, next) || "/"}">${esc(ctx.titles[next])}</a></div>` : "";
  const rail = tocHtml || upNext ? `<div class="rail">${tocHtml}${upNext}</div>` : "";
  const ldGraph = slug === "index"
    ? [{ "@type": "WebSite", "@id": `${SITE}/#website`, name: "Draggy Docs", url: SITE + "/", inLanguage: l.html, publisher: { "@id": `${MAIN}/#organization` } }]
    : [
        { "@type": "TechArticle", headline: title, description, url: canonical, inLanguage: l.html, isPartOf: { "@id": `${SITE}/#website` }, publisher: { "@id": `${MAIN}/#organization` }, image: `${SITE}/assets/img/og${lang === "en" ? "" : `-${lang}`}.png` },
        { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Draggy Docs", item: SITE + (urlOf(lang, "index") || "/") }, { "@type": "ListItem", position: 2, name: title, item: canonical }] },
      ];
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": ldGraph }).replace(/</g, "\\u003c")}</script>`;
  return `<!doctype html>
<html lang="${l.html}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${slug === "index" ? "" : ` · Draggy ${esc(t["brand.docs"])}`}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">${alternates}`}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${slug === "index" ? "website" : "article"}">
<meta property="og:site_name" content="Draggy Docs">
<meta property="og:locale" content="${l.html.replace(/^(en|fr|es|ru)$/, (c) => ({ en: "en_US", fr: "fr_FR", es: "es_ES", ru: "ru_RU" })[c])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#08110e">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/assets/img/og${lang === "en" ? "" : `-${lang}`}.png">
<link rel="icon" href="/assets/img/favicon.png" type="image/png">
<link rel="preload" href="/assets/fonts/geologica-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset("assets/css/docs.css")}">
<script src="${asset("assets/js/docs.js")}" defer></script>
<script type="module" src="${asset("assets/js/analytics.js")}"></script>
${noindex ? "" : jsonLd}
</head>
<body data-lang="${lang}" data-search="/search-${lang}.json" data-none="${esc(t["search.none"])}" data-hint="${esc(t["search.hint"])}">
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="top${slug === "index" ? " top-home" : ""}">
  <div class="top-row">
    <button type="button" class="icon-btn menu-btn" aria-expanded="false" aria-controls="side" aria-label="${esc(t.menu)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    <a class="brand" href="${urlOf(lang, "index") || "/"}">${markSvg}<span>Draggy</span><span class="brand-docs">${esc(t["brand.docs"])}</span></a>
    <button type="button" class="search-btn" aria-label="${esc(t["search.label"])}" aria-haspopup="dialog"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span class="search-text">${esc(t["search.placeholder"])}</span><kbd>Ctrl K</kbd></button>
    ${langMenu(ctx)}
    <a class="main-link" href="${mainHref}" rel="noopener">${esc(t.mainSite)}</a>
    <a class="nav-cta" href="${mainUrl(lang, "download")}" rel="noopener">${esc(t.download)}</a>
  </div>
</header>
<dialog class="search" aria-label="${esc(t["search.label"])}">
  <form method="dialog" class="search-form">
    <input type="search" class="search-input" placeholder="${esc(t["search.placeholder"])}" aria-label="${esc(t["search.label"])}" autocomplete="off" spellcheck="false">
    <button class="search-close" aria-label="${esc(t["search.close"])}">${esc(t["search.close"])}</button>
  </form>
  <p class="search-status" role="status">${esc(t["search.hint"])}</p>
  <ul class="search-results"></ul>
</dialog>
<div class="layout${tab ? "" : " layout-bare"}${slug === "index" ? " layout-home" : ""}">
  ${side}
  <div class="scrim" hidden></div>
  <div class="content">
    ${slug === "index" ? `<main id="main" class="home">${body}</main>` : `<main id="main" class="doc">
      ${crumb}
      <article class="prose">
${body}
      </article>
      ${suggest}
      ${pager}
    </main>`}
    ${rail}
    <footer class="foot">
      <p>${esc(t["footer.license"])}</p>
      <p><a href="${REPO}" rel="noopener">${esc(t["footer.source"])}</a> <a href="${REPO}/issues" rel="noopener">${esc(t["footer.issues"])}</a> <a href="${DOCS_REPO}" rel="noopener">${esc(t["footer.docsSource"])}</a> <a href="${WEB_REPO}" rel="noopener">${esc(t["footer.websiteSource"])}</a> <a href="${mainUrl(lang, "privacy-policy")}" rel="noopener">${esc(t["footer.privacy"])}</a></p>
    </footer>
  </div>
</div>
</body>
</html>
`;
}

function tabOf(slug) {
  return nav.tabs.find((t) => t.groups.some((g) => g.slugs.includes(slug)))?.key;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "assets"), join(out, "assets"), { recursive: true, filter: (s) => !s.endsWith("mark.svg") });

const sitemap = [];
const llms = [`# Draggy documentation\n\n> ${JSON.parse(read("locales/en.json"))["home.description"]}\n`];
let pages = 0;

for (const { code: lang } of LANGS) {
  const t = JSON.parse(read(`locales/${lang}.json`));
  const dir = join(root, "src", lang);
  const docs = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const slug = f === "_home.md" ? "index" : f.slice(0, -3);
    docs[slug] = { file: `${lang}/${f}`, ...parseFile(join(dir, f)) };
  }
  const titles = Object.fromEntries(Object.entries(docs).filter(([s]) => s !== "index").map(([s, d]) => [s, subst(d.meta.title)]));
  titles.index = t["home.title"];
  const search = [];

  for (const [slug, d] of Object.entries(docs)) {
    if (slug !== "index" && !flat.includes(slug)) throw new Error(`${d.file}: not listed in nav.json`);
    const ctx = { lang, t, slug, titles, file: d.file, links: [], shots: new Set() };
    const { html, toc } = render(d.body, ctx);
    let body, title, description, tab;
    if (slug === "index") {
      title = t["home.title"];
      description = t["home.description"];
      tab = null;
      const sections = nav.tabs
        .flatMap((tb) => tb.groups)
        .map((g) => {
          const links = g.slugs.filter((s) => titles[s]).map((s) => `<li><a href="${urlOf(lang, s)}">${esc(titles[s])}</a></li>`).join("");
          return `<section class="sec"><h3>${icon(GROUP_ICON[g.key])}${esc(t[`group.${g.key}`])}</h3><ul>${links}</ul></section>`;
        })
        .join("");
      const starts = nav.home
        .filter((s) => titles[s])
        .map((s) => `<li><a href="${urlOf(lang, s)}"><strong>${esc(titles[s])}</strong><span>${esc(subst(docs[s].meta.description || ""))}</span></a></li>`)
        .join("");
      const searchIcon = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      body = `<div class="home-hero"><div class="home-inner"><h1>${esc(t["home.title"])}</h1><p>${esc(t["home.lede"])}</p><button type="button" class="home-search" aria-haspopup="dialog">${searchIcon}<span>${esc(t["search.placeholder"])}</span><kbd>Ctrl K</kbd></button></div></div><div class="home-inner"><section class="home-part"><h2>${esc(t["home.popular"])}</h2><ul class="starts">${starts}</ul></section><section class="home-part"><h2>${esc(t["home.cards"])}</h2><div class="secs">${sections}</div></section></div>`;
    } else {
      title = titles[slug];
      description = subst(d.meta.description || "");
      tab = tabOf(slug);
      body = `<h1>${esc(title)}</h1>${description ? `<p class="lede">${esc(description)}</p>` : ""}${html}`;
    }
    const page = shell(ctx, { title, description, body, toc: slug === "index" ? [] : toc, tab: tab || null });
    const file = fileOf(lang, slug);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page);
    pages++;
    sitemap.push({ lang, slug });
    search.push({ t: title, s: tab ? t[`tab.${tab}`] : "", u: urlOf(lang, slug) || "/", h: toc.map((x) => ({ i: x.id, t: x.text })), x: plain(subst(d.body)).slice(0, 4000) });
    if (lang === "en" && slug !== "index") llms.push(`- [${title}](${SITE}/${slug}): ${description}`);
  }

  writeFileSync(join(out, `search-${lang}.json`), JSON.stringify(search));
  const nf = shell({ lang, t, slug: "404", titles, file: "404", links: [], shots: new Set() }, {
    title: t["notFound.title"],
    description: t["notFound.text"],
    body: `<div class="nf"><h1 class="code-404"><span class="sr-only">404</span><span class="glitch" data-text="404" aria-hidden="true">404</span></h1><p>${esc(t["notFound.text"])}</p><p><a class="nav-cta inline" href="${urlOf(lang, "index") || "/"}">${esc(t["notFound.home"])}</a></p></div>`,
    tab: null,
    noindex: true,
  });
  writeFileSync(join(out, lang === "en" ? "404.html" : `${lang}/404.html`), nf);
}

const hasPage = (code, slug) => code === "en" || existsSync(join(root, "src", code, slug === "index" ? "_home.md" : `${slug}.md`));
const sitemapEntry = ({ lang, slug }) => {
  const alt = LANGS.filter((x) => hasPage(x.code, slug)).map((x) => `<xhtml:link rel="alternate" hreflang="${x.html}" href="${SITE}${urlOf(x.code, slug) || "/"}"/>`);
  alt.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${urlOf("en", slug) || "/"}"/>`);
  return `<url><loc>${SITE}${urlOf(lang, slug) || "/"}</loc>${alt.join("")}</url>`;
};
writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemap.map(sitemapEntry).join("\n")}\n</urlset>\n`);
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(out, "llms.txt"), llms.join("\n") + "\n");
console.log(`docs: ${pages} pages`);
