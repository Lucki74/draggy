/**
 * Builds every page of the site, in every language, from tools/pages and
 * tools/locales.
 *
 *   npm run build
 *
 * English is the site itself and lands at the root: index.html, download.html,
 * 404.html. Every other language gets a folder named after it, so French is
 * /fr/ and /fr/download.html. There is deliberately no /en/: English has one
 * address, not two.
 *
 * The files in tools/pages hold a <main> and nothing else. Everything around
 * it, the head, the header, the language menu and the footer, is written here
 * once, because a translated copy of the navigation in twelve files is a
 * navigation that drifts.
 *
 * Values in the locale files may contain HTML. They are written here, not
 * submitted by anyone, and several sentences genuinely need <strong> or <code>
 * inside them.
 */
import { loadLocale } from "./locales.mjs";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { downloadUrl, loadRelease } from "./fetch-release.mjs";
import { resolveCounts } from "./counts.mjs";
import { INDEXNOW_KEY } from "./indexnow.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * Vercel serves public/ and nothing else, and every build replaces it. DRAGGY_OUT writes the
 * site somewhere else, which is how the tests build without touching a preview of public/.
 */
const target = process.env.DRAGGY_OUT ? resolve(process.env.DRAGGY_OUT) : join(root, "public");

const SITE = "https://draggy.org";
const REPO = "https://github.com/Lucki74/draggy";
const WEB_REPO = "https://github.com/Lucki74/draggy/tree/main/websites/www";
const DOCS_REPO = "https://github.com/Lucki74/draggy/tree/main/websites/docs";

/**
 * The numbers the site quotes, in one file so none of them is typed twice. The three counts come
 * from the app when its checkout is beside this one (tools/counts.mjs); otherwise site.config.json
 * stands. Locale files and pages write {{n:mcp}}, {{n:skills}} and {{n:skillsOn}}.
 */
const siteConfig = JSON.parse(readFileSync(join(root, "site.config.json"), "utf8"));
const config = { ...siteConfig, ...resolveCounts(siteConfig).counts };

/** The newest release: version, file names, sizes and SHA-512. Live from GitHub, else release.json. */
const release = await loadRelease();

/** Sizes of the screenshots, written by tools/images.mjs, so every <img> carries a width and a height. */
const shots = JSON.parse(readFileSync(join(root, "assets", "img", "shots.json"), "utf8"));

/**
 * code is the folder and the hreflang; lang is the BCP 47 tag the page and its structured data declare;
 * locale is the Open Graph form, language_TERRITORY.
 */
const LANGUAGES = [
  { code: "en", name: "English", lang: "en", locale: "en_US" },
  { code: "fr", name: "Français", lang: "fr", locale: "fr_FR" },
  { code: "es", name: "Español", lang: "es", locale: "es_ES" },
  { code: "ru", name: "Русский", lang: "ru", locale: "ru_RU" },
];

/** The BCP 47 tag of a language code, as <html lang> and inLanguage say it. */
const htmlLang = (code) => LANGUAGES.find((language) => language.code === code).lang;

/**
 * For text that goes into an attribute, the <title> or a <meta>. Locale strings are written in raw, so a
 * quote or an ampersand in a translation must not end the attribute early. Escape once, at the point of use.
 */
const escapeAttr = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * JSON for a <script type="application/ld+json">. JSON.stringify leaves "<" alone, so a translation or a
 * release value containing "</script>" would close the tag; "<" is written as its \u escape instead.
 */
const scriptJson = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

const PAGES = [
  { id: "index", file: "index.html", nav: "home" },
  { id: "download", file: "download/index.html", source: "download.html", clean: "download", depth: 1, nav: "download" },
  // /privacy-policy, a folder with an index.html in it, so the address has no extension.
  { id: "privacyPolicy", file: "privacy-policy/index.html", source: "privacy-policy.html", clean: "privacy-policy", depth: 1, nav: null },
  // /open-source, /compare and /accessibility: the same shape as the privacy policy, one folder each.
  { id: "openSource", file: "open-source/index.html", source: "open-source.html", clean: "open-source", depth: 1, nav: null },
  { id: "compare", file: "compare/index.html", source: "compare.html", clean: "compare", depth: 1, nav: null },
  { id: "accessibility", file: "accessibility/index.html", source: "accessibility.html", clean: "accessibility", depth: 1, nav: null },
  // /pricing: what is free and what will be billed.
  { id: "pricing", file: "pricing/index.html", source: "pricing.html", clean: "pricing", depth: 1, nav: "pricing" },
  // /error, the list of every page an error in the app links to, so /error/<slug> has a parent.
  { id: "errors", file: "error/index.html", source: "errors.html", clean: "error", depth: 1, nav: null },
  // Served by Vercel for any address that does not exist, so it is rendered
  // under a URL nobody can predict. Every link on it has to be absolute.
  { id: "notFound", file: "404.html", nav: null, rooted: true },
];

const ALL_PAGES = PAGES;

/** The documentation lives on its own site. */
const DOCS = "https://docs.draggy.org";

/**
 * The pages an error message in the app links to, at /error/<slug> and
 * /fr/error/<slug>. They are kept out of PAGES on purpose: nothing on the
 * site links to them, the sitemap does not list them, and they are noindex, so
 * they are reached only by the link inside the error. English decides which
 * slugs exist, and a language that misses one, or adds one, fails the build.
 */
function readErrors(code) {
  const name = `errors/${code}.html`;
  const source = readFileSync(join(here, "errors", `${code}.html`), "utf8");
  const pages = [];

  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^<!--#\s*([a-z-]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*-->$/);

    if (marker) {
      const [, slug, title, description] = marker;
      pages.push({
        id: `error.${slug}`,
        error: slug,
        title,
        description,
        file: `error/${slug}/index.html`,
        nav: null,
        // error/<slug>/index.html sits two folders below the language's own folder.
        depth: 2,
        lines: [],
      });
    } else if (pages.length) {
      pages[pages.length - 1].lines.push(line);
    }
  }

  if (!pages.length) throw new Error(`${name}: no <!--# slug | title | description --> block`);

  const slugs = pages.map((page) => page.error);
  const twice = slugs.find((slug, at) => slugs.indexOf(slug) !== at);
  if (twice) throw new Error(`${name}: ${twice} is written twice`);

  for (const page of pages) {
    page.body = page.lines.join("\n").trim();
    if (!page.body) throw new Error(`${name}: ${page.error} has no text`);
    delete page.lines;
  }

  return pages;
}

const ERRORS = Object.fromEntries(LANGUAGES.map((language) => [language.code, readErrors(language.code)]));
const ERROR_SLUGS = ERRORS.en.map((page) => page.error);

for (const language of LANGUAGES) {
  const have = ERRORS[language.code].map((page) => page.error);
  const missing = ERROR_SLUGS.filter((slug) => !have.includes(slug));
  const extra = have.filter((slug) => !ERROR_SLUGS.includes(slug));

  if (missing.length) throw new Error(`errors/${language.code}.html: missing ${missing.join(", ")}`);
  if (extra.length) throw new Error(`errors/${language.code}.html: ${extra.join(", ")} is not in English`);
}

/** "" at the root, "fr/" in a language folder. Used for both paths and URLs. */
const folder = (code) => (code === "en" ? "" : `${code}/`);

/** How far a page sits below public/, which is how far up its links start. */
const depthOf = (code, page) => (page.depth ?? 0) + (code === "en" ? 0 : 1);

/**
 * The address a page is published at, which is also its canonical. Never with a
 * trailing slash: `trailingSlash` is off, so Vercel answers /fr/ with a 308 to
 * /fr, and a canonical that redirects is one every crawler follows twice.
 * English is the site root, which is the one slash that stays.
 */
function url(code, page) {
  if (page.clean) return `${SITE}/${folder(code)}${page.clean}`;

  if (page.error) return `${SITE}/${folder(code)}error/${page.error}`;

  if (page.file === "index.html") {
    return code === "en" ? `${SITE}/` : `${SITE}/${code}`;
  }

  return `${SITE}/${folder(code)}${page.file}`;
}

/**
 * How a page refers to the rest of the site. Ordinary pages point at their
 * neighbours relatively, so the folder can be opened from a disk as easily as
 * from a server. The 404 cannot: it is shown at whatever address was missing,
 * and "assets/css/site.css" from /some/deep/typo is nothing at all.
 */
function links(code, page) {
  if (page.rooted) {
    const home = (lang = code) => (lang === "en" ? "/" : `/${lang}`);

    return {
      asset: (path) => `/${path}`,
      home,
      page: (file, lang = code) => (file === "index.html" ? home(lang) : `/${folder(lang)}${file}`),
      docs: (slug, lang = code) => `${DOCS}${lang === "en" ? "" : `/${lang}`}${slug ? `/${slug}` : ""}`,
      error: (slug, lang = code) => `/${folder(lang)}error/${slug}`,
      clean: (slug, lang = code) => `/${folder(lang)}${slug}`,
    };
  }

  const up = "../".repeat(depthOf(code, page));

  // A home page is linked at its canonical address, / or /fr, never at the
  // index.html behind it. /fr/index.html answers 200 too, with a canonical
  // pointing at /fr, so every link to it was a second address for the same
  // page, which Search Console files under "Alternate page with proper
  // canonical tag" instead of indexing. "./" rather than "" at the English
  // root, since an empty href is the page the link is on.
  const home = (lang = code) => (lang === "en" ? up || "./" : `${up}${lang}`);

  return {
    asset: (path) => `${up}${path}`,
    home,
    page: (file, lang = code) => (file === "index.html" ? home(lang) : `${up}${folder(lang)}${file}`),
    // No trailing slash: Vercel is set to strip them, so one here is a
    // redirect on every link that has it.
    docs: (slug, lang = code) => `${DOCS}${lang === "en" ? "" : `/${lang}`}${slug ? `/${slug}` : ""}`,
    error: (slug, lang = code) => `${up}${folder(lang)}error/${slug}`,
    // A page that lives at a folder of its own, such as /privacy-policy.
    clean: (slug, lang = code) => `${up}${folder(lang)}${slug}`,
  };
}

/* ---------- the shell ---------- */

function alternates(page) {
  const rows = LANGUAGES.map(
    (language) =>
      `    <link rel="alternate" hreflang="${language.code}" href="${url(language.code, page)}" />`,
  );

  // Anything we have no translation for is sent to English rather than guessed
  // at from the visitor's nearest match.
  rows.push(`    <link rel="alternate" hreflang="x-default" href="${url("en", page)}" />`);

  return rows.join("\n");
}

function languageMenu(code, page, t, to) {
  const current = LANGUAGES.find((language) => language.code === code);

  const items = LANGUAGES.map((language) => {
    const mine = language.code === code ? ' aria-current="true"' : "";
    const href = page.rooted
      ? to.home(language.code)
      : page.error
      ? to.error(page.error, language.code)
      : page.clean
        ? to.clean(page.clean, language.code)
        : to.page(page.file, language.code);

    return (
      `            <li><a lang="${language.code}" href="${href}"${mine}>` +
      `<span>${language.name}</span></a></li>`
    );
  }).join("\n");

  return `        <details class="lang">
          <summary>
            <span>${current.name}</span>
          </summary>
          <ul>
${items}
          </ul>
        </details>`;
}

/** The link-preview card for a language: og.png in English, og-<code>.png beside it. tools/og.cjs draws them. */
const ogImage = (code) => (code === "en" ? "og.png" : `og-${code}.png`);

function head(code, page, t, to) {
  const language = LANGUAGES.find((entry) => entry.code === code);

  // A 404 is reached by mistake, so it is kept out of the index and out of the
  // hreflang graph rather than offered as a page in twelve languages.
  // An error page is reached from the app and nowhere else, so it stays out of the index too.
  const findable = page.rooted || page.error
    ? `    <meta name="robots" content="noindex" />`
    : `    <link rel="canonical" href="${url(code, page)}" />\n${alternates(page)}`;

  // SoftwareApplication and WebSite blocks, on the page that actually describes the app.
  const jsonLd = page.id === "index" ? structuredData(code, page, t) : "";

  // An error page carries its own title and summary in its file. Every value
  // here is escaped once, where it lands in the attribute or the title.
  // A page title that does not already name the product gets it as a suffix, so
  // short titles such as "Pricing" are not left bare in search results.
  const branded = (title) => (/draggy/i.test(title) ? title : `${title} · Draggy`);
  const fullTitle = page.error
    ? `${escapeAttr(page.title)} · Draggy`
    : escapeAttr(branded(t(`${page.id}.title`)));
  const ogTitle = page.error ? fullTitle : escapeAttr(t(`${page.id}.ogTitle`));
  const summary = escapeAttr(page.error ? page.description : t(`${page.id}.description`));
  const ogSummary = page.error ? summary : escapeAttr(t(`${page.id}.ogDescription`));

  return `<!doctype html>
<html lang="${htmlLang(code)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${fullTitle}</title>
    <meta name="description" content="${summary}" />
${findable}${jsonLd}

    <!-- What Discord, Slack and the rest draw when somebody pastes the link. -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Draggy" />
    <meta property="og:locale" content="${language.locale}" />
    <meta property="og:url" content="${url(code, page)}" />
    <meta property="og:title" content="${ogTitle}" />
    <meta property="og:description" content="${ogSummary}" />
    <meta property="og:image" content="${SITE}/assets/img/${ogImage(code)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeAttr(t("og.imageAlt"))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${ogTitle}" />
    <meta name="twitter:description" content="${ogSummary}" />
    <meta name="twitter:image" content="${SITE}/assets/img/${ogImage(code)}" />
    <meta name="theme-color" content="#f3f9fd" media="(prefers-color-scheme: light)" data-tone="light" />
    <meta name="theme-color" content="#0b120e" media="(prefers-color-scheme: dark)" data-tone="dark" />

    <link rel="icon" href="${to.asset("assets/img/favicon.png")}" />
    <link rel="apple-touch-icon" href="${to.asset("assets/img/draggy-icon-128.png")}" />
    <link rel="preload" as="font" type="font/woff2" href="${to.asset("assets/fonts/geologica-latin-wght-normal.woff2")}" crossorigin />
    <link rel="stylesheet" href="${to.asset("assets/css/site.css")}" />
    <link rel="stylesheet" href="${to.asset(`assets/css/${page.id === "index" ? "home" : "pages"}.css`)}" />
    <script>
      // Detects the OS before the first paint so the download button names it.
      try {
        const ua = (navigator.userAgent || "").toLowerCase();
        const plat = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
        const str = plat + " " + ua;
        const isTouch = navigator.maxTouchPoints > 1;
        const isMobile = /android|iphone|ipad|ipod|mobile/.test(str) || (/mac/.test(str) && isTouch);
        if (isMobile) {
          document.documentElement.dataset.os = "mobile";
        } else if (/win/.test(str)) {
          document.documentElement.dataset.os = "windows";
        } else if (/mac/.test(str)) {
          document.documentElement.dataset.os = "macos";
        } else if (/linux/.test(str) && !/cros|chromebook/.test(str)) {
          document.documentElement.dataset.os = "linux";
        }
      } catch {}
    </script>
    <script type="application/json" id="draggy-strings">${strings(t)}</script>
    <script src="${to.asset("assets/js/site.js")}" defer></script>
${page.error ? "" : `    <!-- Vercel Web Analytics: cookieless page counts, served from this site. See the privacy policy. -->
    <script src="/_vercel/insights/script.js" defer></script>
`}  </head>
`;
}

/**
 * The strings site.js reads, and nothing else: the copy button labels, the share
 * text, and the pattern the language menu's name is built from. A string added
 * here must be read by site.js, and one site.js reads must be listed here.
 *
 * Data, not a script, so the Content-Security-Policy in vercel.json never has to
 * allow a script that changes with every page. "<" is escaped so no translation
 * can close the tag.
 */
function strings(t) {
  const data = {
    copy: t("js.copy"),
    copied: t("js.copied"),
    shareText: t("js.shareText"),
    languageName: t("lang.named"),
  };
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

/**
 * /.well-known/security.txt (RFC 9116): where to report a security problem with
 * Draggy or this site. Expires is the build day plus 364 days (RFC 9116 asks for
 * under a year), cut to midnight UTC so every build on one day writes the same file.
 * Each deploy renews it, so no date has to be edited by hand.
 */
function securityTxt() {
  const expires = new Date(Date.now() + 364 * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    "Contact: https://github.com/Lucki74/draggy/security/advisories/new",
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE}/.well-known/security.txt`,
    "Policy: https://github.com/Lucki74/draggy/blob/main/SECURITY.md",
    "",
  ].join("\n");
}

/** Read by Google and every other bot as a WebSite and SoftwareApplication: what it is, what it costs (nothing),
 * and where to get it. WebSite structured data signals the canonical site name for Google Search. */
function structuredData(code, page, t) {
  const pageUrl = url(code, page);
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "Draggy",
        alternateName: ["draggy.org"],
        url: pageUrl,
        inLanguage: htmlLang(code),
      },
      // One name and the same profiles everywhere, so search engines tie them to a single entity.
      {
        "@type": "Organization",
        "@id": `${SITE}/#organization`,
        name: "Draggy",
        url: `${SITE}/`,
        logo: `${SITE}/assets/img/draggy-icon.png`,
        sameAs: [REPO, "https://ko-fi.com/lucki74"],
      },
      {
        "@type": "SoftwareApplication",
        name: "Draggy",
        publisher: { "@id": `${SITE}/#organization` },
        description: t("index.description"),
        url: pageUrl,
        downloadUrl: `${REPO}/releases`,
        license: `${REPO}/blob/main/LICENSE`,
        operatingSystem: "Windows, macOS, Linux",
        applicationCategory: "DeveloperApplication",
        softwareVersion: release.version,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      // The same questions and answers the page prints, without their links.
      {
        "@type": "FAQPage",
        mainEntity: [1, 3, 11, 8, 10].map((n) => ({
          "@type": "Question",
          name: t(`faq.q${n}`),
          acceptedAnswer: { "@type": "Answer", text: stripTags(t(`faq.a${n}`)) },
        })),
      },
    ],
  };

  return `\n    <script type="application/ld+json">${scriptJson(data)}</script>`;
}

function header(code, page, t, to) {
  const anchor = (hash) =>
    page.id === "index" ? `#${hash}` : `${to.home()}#${hash}`;

  const brand = `        <a class="brand" href="${to.home()}">
          {{include:mark}}
          Draggy
        </a>`;

  return `  <body>
    <a class="skip" href="#main">${t("a11y.skip")}</a>
    {{icons}}

    <header class="site-header">
      <div class="wrap">
${brand}

        <nav class="site-nav" aria-label="${escapeAttr(t("footer.product"))}">
          <a href="${anchor("features")}">${t("nav.features")}</a>
          <a href="${to.docs("")}">${t("nav.docs")}</a>
          <a href="${to.clean("pricing")}"${page.nav === "pricing" ? ' aria-current="page"' : ""}>${t("nav.pricing")}</a>
          <a href="${REPO}">GitHub</a>
        </nav>

${stars(t)}
${languageMenu(code, page, t, to)}

        <a class="nav-cta" href="${to.clean("download")}"${page.nav === "download" ? ' aria-current="page"' : ""}>${t("nav.download")}</a>
      </div>
    </header>

`;
}

/** The star count beside the source link, baked in by fetch-release.mjs. Nothing when it is not known or below starsMin. */
function stars(t) {
  const count =
    Number.isFinite(release.stars) && release.stars >= config.starsMin
      ? `<span>${release.stars.toLocaleString("en-US")}</span>`
      : "";
  return `        <a class="nav-stars" href="${REPO}" aria-label="${escapeAttr(t("nav.stars"))}">
          <svg class="icon" aria-hidden="true"><use href="#i-github-logo" /></svg>
          <svg class="icon" aria-hidden="true"><use href="#i-star" /></svg>
          ${count}
        </a>`;
}

function footer(code, page, t, to) {
  const anchor = (hash) => (page.id === "index" ? `#${hash}` : `${to.home()}#${hash}`);

  // The black "made by one developer" block closes the home page only.
  const made =
    page.id === "index"
      ? `
    <section class="made" id="download">
      <div class="wrap">
        <h2>${t("made.title")}</h2>
        <p>${t("who.body")}</p>
        <div class="hero-buttons">
          <a class="btn btn-primary made-dl" href="${to.clean("download")}">${t("nav.download")}</a>
          <a class="t" href="${REPO}">${t("who.source")}</a>
        </div>
      </div>
    </section>
`
      : "";

  return `${made}
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-brand">
          <small>${t("footer.license")}</small>
          <small>${t("home.version")} ${release.version} · ${t("js.version")} ${release.build}</small>
        </div>

        <nav aria-label="${escapeAttr(t("footer.product"))}">
          <h2>${t("footer.product")}</h2>
          <a href="${anchor("features")}">${t("nav.features")}</a>
          <a href="${to.clean("compare")}">${t("nav.compare")}</a>
          <a href="${to.clean("download")}">${t("nav.download")}</a>
          <a href="${to.clean("pricing")}">${t("nav.pricing")}</a>
        </nav>

        <nav aria-label="${escapeAttr(t("footer.docs"))}">
          <h2>${t("footer.docs")}</h2>
          <a href="${to.docs("")}">${t("nav.docs")}</a>
          <a href="${to.docs("installation")}">${t("docs.installation")}</a>
          <a href="${to.docs("troubleshooting")}">${t("docs.troubleshooting")}</a>
          <a href="${to.clean("privacy-policy")}">${t("nav.privacy")}</a>
          <a href="${to.clean("accessibility")}">${t("nav.accessibility")}</a>
        </nav>

        <nav aria-label="${escapeAttr(t("footer.project"))}">
          <h2>${t("footer.project")}</h2>
          <a href="${to.clean("open-source")}">${t("nav.openSource")}</a>
          <a href="${REPO}/releases">${t("nav.releases")}</a>
          <a href="${REPO}/issues">${t("nav.issues")}</a>
          <a href="${WEB_REPO}">${t("nav.websiteSource")}</a>
          <a href="${DOCS_REPO}">${t("nav.docsSource")}</a>
          <a href="${REPO}/blob/main/CONTRIBUTING.md">${t("nav.contribute")}</a>
          <a href="${REPO}/blob/main/SECURITY.md">${t("nav.security")}</a>
        </nav>
      </div>
      <div class="foot-end" aria-hidden="true">
        <span class="foot-word" data-word="Draggy"></span>
      </div>
    </footer>
  </body>
</html>
`;
}

/**
 * Every table in the privacy policy or an error page sits in one scroll box. A table cannot be
 * narrowed, so on a phone it scrolls, and the box takes focus so a keyboard can scroll it too.
 * A wrapper a fragment already has is replaced, not doubled.
 */
function wrapTables(html, t) {
  const label = t("table.scroll");
  const box = (inner) =>
    `<div class="wiki-table" tabindex="0" role="region" aria-label="${label}"><table>${inner}</table></div>`;

  return html.replace(
    /<div class="wiki-table">\s*<table>([\s\S]*?)<\/table>\s*<\/div>|<table>([\s\S]*?)<\/table>/g,
    (_, wrapped, bare) => box(wrapped ?? bare),
  );
}

/* ---------- the error pages ---------- */

/**
 * The body of an error page: what it means and what to do, from its own file,
 * and the same closing section on all of them, so that a person who is still
 * stuck knows where the logs are and where to report it.
 */
function errorPage(page, t) {
  return `    <main class="wiki">
      <section class="page-head">
        <div class="wrap">
          <img class="page-logo" src="{{root}}assets/img/draggy-icon-128.png" width="96" height="96" alt="Draggy" />
          <h1>${page.title}</h1>
          <p class="lede">${page.description}</p>
        </div>
      </section>
      <div class="wrap">
      <article class="wiki-body">
${page.body}

        <h2>${t("error.stuck.title")}</h2>

        <p>${t("error.stuck.body")}</p>

        <p><a class="btn" href="{{page:index.html}}">${t("error.home")}</a></p>
      </article>
      </div>
    </main>
`;
}

/** The four failure domains error pages sit in on /error. Every English slug belongs to exactly one. */
const ERROR_GROUPS = [
  {
    key: "engine",
    slugs: [
      "engine-unreachable",
      "engine-would-not-start",
      "load-timeout",
      "engine-stopped-loading",
      "another-model-started",
      "port-in-use",
      "out-of-memory",
      "unsupported-architecture",
      "tool-call-unreadable",
      "unknown-engine-error",
      "colibri-out-of-memory",
      "colibri-unsupported-model",
      "colibri-blocked-by-windows",
      "image-out-of-memory",
      "image-engine-would-not-start",
      "image-engine-unsupported-cpu",
    ],
  },
  {
    key: "models",
    slugs: [
      "missing-model-file",
      "model-parts-missing",
      "damaged-model-file",
      "model-still-loading",
      "image-not-supported",
      "context-too-long",
      "colibri-disk-read",
      "colibri-model-format",
      "image-model-damaged",
    ],
  },
  {
    key: "providers",
    slugs: [
      "provider-unreachable",
      "provider-invalid-key",
      "provider-no-credit",
      "provider-rate-limited",
      "provider-model-not-found",
      "provider-context-too-long",
      "provider-refused",
      "provider-region-unavailable",
      "provider-unknown-error",
    ],
  },
  {
    key: "accounts",
    slugs: [
      "account-signed-out",
      "account-limit-reached",
      "account-runtime-unavailable",
    ],
  },
];

/*
 * The groups have to cover the English pages exactly. A new error page that is not in a
 * group would be built and linked from nowhere, and a group that names a slug with no page
 * would print nothing where a card belongs.
 */
{
  const grouped = ERROR_GROUPS.flatMap((group) => group.slugs);
  const ungrouped = ERROR_SLUGS.filter((slug) => !grouped.includes(slug));
  const unknown = grouped.filter((slug) => !ERROR_SLUGS.includes(slug));
  const twice = grouped.find((slug, at) => grouped.indexOf(slug) !== at);

  if (ungrouped.length) throw new Error(`ERROR_GROUPS has no group for ${ungrouped.join(", ")}`);
  if (unknown.length) throw new Error(`ERROR_GROUPS names ${unknown.join(", ")}, which has no error page`);
  if (twice) throw new Error(`ERROR_GROUPS lists ${twice} twice`);
}

/** Every error page in one language, grouped in four categories, for /error. */
function errorList(code, t, to) {
  const pagesBySlug = new Map(ERRORS[code].map((page) => [page.error, page]));

  return ERROR_GROUPS.map((group) => {
    const cards = group.slugs
      .map((slug) => {
        const page = pagesBySlug.get(slug);
        if (!page) throw new Error(`${code}/errors: ${slug} has no page`);
        return `            <li><a href="${to.error(page.error)}">${page.title}</a><span>${page.description}</span></li>`;
      })
      .join("\n");

    return `        <h2>${t(`errors.group.${group.key}`)}</h2>
        <ul class="error-list">
${cards}
        </ul>`;
  }).join("\n\n");
}

/* ---------- putting one page together ---------- */

const templates = Object.fromEntries(
  PAGES.map((page) => [page.id, readFileSync(join(here, "pages", page.source ?? page.file), "utf8")]),
);

/** The privacy policy, one file per language, dropped into pages/privacy-policy.html where it says {{policy}}. */
const policies = Object.fromEntries(
  LANGUAGES.map((language) => [language.code, readFileSync(join(here, "policy", `${language.code}.html`), "utf8").trim()]),
);

const icons = readFileSync(join(here, "pages", "_icons.html"), "utf8").trim();

const locales = Object.fromEntries(
  LANGUAGES.map((language) => [
    language.code,
    loadLocale(language.code),
  ]),
);

/**
 * English is the source text. A language that has drifted from it, in either
 * direction, is caught here rather than showing up as one untranslated
 * sentence in the middle of a page nobody on the team reads.
 */
const source = Object.keys(locales.en);

for (const language of LANGUAGES) {
  if (language.code === "en") continue;

  const theirs = locales[language.code];
  const missing = source.filter((key) => !(key in theirs));
  const extra = Object.keys(theirs).filter((key) => !source.includes(key));

  if (missing.length) {
    throw new Error(`${language.code}.json: missing ${missing.join(", ")}`);
  }
  if (extra.length) {
    throw new Error(`${language.code}.json: ${extra.join(", ")} is in no page`);
  }
}

/** {{n:mcp}}: a number from site.config.json. A name it does not have fails the build. */
function number(key) {
  if (typeof config[key] !== "number") throw new Error(`site.config.json has no number called "${key}"`);
  return String(config[key]);
}

const withNumbers = (text) => text.replace(/\{\{n:([a-zA-Z]+)\}\}/g, (_, key) => number(key));

/** Every key must exist in every language: a silent {{t:key}} in a page is worse. */
function lookup(code) {
  const strings = locales[code];

  return (key) => {
    const value = strings[key];
    if (typeof value !== "string") throw new Error(`${code}.json: missing "${key}"`);
    return withNumbers(value);
  };
}

/**
 * {{r:version}} and {{r:windows-exe.sha512}}: the newest release as fetch-release.mjs read it.
 * Fields: name, url, sha512, and mb, the size the way a download page says it.
 */
function releaseValue(path) {
  if (path === "version") return release.version;
  if (path === "build") return String(release.build);
  if (path === "tag") return release.tag;
  if (path === "releaseurl") return `${REPO}/releases/tag/${release.tag}`;

  const [key, field] = path.split(".");
  const asset = release.assets[key];
  if (!asset) throw new Error(`{{r:${path}}}: the release has no "${key}"`);
  if (field === "mb") return `${Math.round(asset.size / 1024 / 1024)} MB`;
  // Built from the tag, not read from release.json, so the link is the tagged file the checksum describes.
  if (field === "url") return downloadUrl(release.tag, asset.name);
  if (typeof asset[field] !== "string") throw new Error(`{{r:${path}}}: no such field`);
  return asset[field];
}

/** {{released}}: the newest release's day, as the end of a file line. Nothing when GitHub gave no day. */
function releasedNote(t) {
  return release.date ? ` · ${t("download.released")} <time datetime="${release.date}">${release.date}</time>` : "";
}

/**
 * {{recent}}: the changelog, one block per build, newest first. The notes are the release notes as the app repo wrote
 * them, in English, so they are marked lang="en" on the other pages. Nothing at all when release.json lists no build,
 * so the section is absent from the page rather than shown empty.
 */
function recentBuilds(t, code) {
  const recent = release.recent ?? [];
  if (!recent.length) return "";
  const lang = code === "en" ? "" : ' lang="en"';
  const list = (title, items) =>
    items?.length
      ? `
              <h4>${title}</h4>
              <ul${lang}>
${items.map((item) => `                <li>${escapeAttr(item)}</li>`).join("\n")}
              </ul>`
      : "";
  const blocks = recent
    .map((entry) => {
      const day = entry.date ? ` · <time datetime="${entry.date}">${entry.date}</time>` : "";
      return `            <article class="dl-log-entry">
              <h3><a href="${entry.html_url}">${t("download.version")} ${entry.version}</a><span class="file-meta">${t("js.version")} ${entry.build}${day}</span></h3>${list(t("download.changelogNew"), entry.notes?.updates)}${list(t("download.changelogFixes"), entry.notes?.fixes)}
            </article>`;
    })
    .join("\n");
  return `      <section class="section dl-recent" id="changelog">
        <div class="wrap">
          <div class="section-head">
            <h2>${t("download.changelogTitle")}</h2>
          </div>
          <div class="dl-log">
${blocks}
          </div>
          <p class="dl-all"><a href="${REPO}/releases">${t("download.recentAll")}</a></p>
        </div>
      </section>`;
}

/** What each system's requirements say: one string for both columns, or a minimum and a recommended one. */
const SPECS = {
  windows: {
    os: ["spec.win.os"],
    cpu: ["spec.win.cpu"],
    memory: ["spec.mem.min", "spec.mem.rec"],
    gpu: ["spec.gpu.min", "spec.gpu.rec"],
    disk: ["spec.disk.min", "spec.disk.rec"],
    network: ["spec.net"],
  },
  macos: {
    os: ["spec.mac.os"],
    cpu: ["spec.mac.cpu"],
    memory: ["spec.mem.min", "spec.mem.recMac"],
    gpu: ["spec.gpu.mac"],
    disk: ["spec.disk.min", "spec.disk.rec"],
    network: ["spec.net"],
  },
  linux: {
    os: ["spec.linux.os"],
    cpu: ["spec.linux.cpu"],
    memory: ["spec.mem.min", "spec.mem.rec"],
    gpu: ["spec.gpu.min", "spec.gpu.rec"],
    disk: ["spec.disk.min", "spec.disk.rec"],
    network: ["spec.net"],
  },
};

const INSTALL = {
  windows: [{ text: "install.windows.1" }, { text: "firstRun.windows" }, { text: "download.step3Text" }],
  macos: [{ text: "install.macos.1" }, { text: "firstRun.macos" }, { text: "download.step3Text" }],
  linux: [
    { text: "install.linux.deb", cmd: "sudo apt install ./{{r:linux-deb.name}}" },
    { text: "install.linux.rpm", cmd: "sudo dnf install ./{{r:linux-rpm.name}}" },
    { text: "download.step3Text" },
  ],
};

/**
 * {{specs}}: Steam-style requirements, Minimum beside Recommended, then the install steps, once for each system.
 * With script a tab strip shows one system (the visitor's own first); without it all three are stacked.
 */
function specsBlock(t) {
  const names = { windows: t("os.windows"), macos: t("os.macos"), linux: t("os.linux") };
  const rows = ["os", "cpu", "memory", "gpu", "disk", "network"];
  const tabs = Object.entries(names)
    .map(([os, name]) => `<button type="button" class="spec-tab" data-os-pick="${os}" aria-pressed="false">${name}</button>`)
    .join("\n              ");
  const systems = Object.entries(SPECS)
    .map(([os, spec]) => {
      const body = rows
        .map((row) => {
          const [min, rec] = spec[row];
          const label = t(`spec.row.${row}`);
          const cells = `<td data-label="${t("spec.min")}">${t(min)}</td>
                  <td data-label="${t("spec.rec")}">${t(rec || min)}</td>`;
          return `                <tr>
                  <th scope="row">${label}</th>
                  ${cells}
                </tr>`;
        })
        .join("\n");
      const steps = INSTALL[os]
        .map(({ text, cmd }) => `              <li><p>${t(text)}</p>${cmd ? `<pre><code data-copy>${cmd}</code></pre>` : ""}</li>`)
        .join("\n");
      return `          <div class="spec" data-spec-os="${os}">
            <h3>${names[os]}</h3>
            <table class="spec-table">
              <thead>
                <tr>
                  <td></td>
                  <th scope="col">${t("spec.min")}</th>
                  <th scope="col">${t("spec.rec")}</th>
                </tr>
              </thead>
              <tbody>
${body}
              </tbody>
            </table>
            <h4>${t("download.installTitle")}</h4>
            <ol class="spec-steps">
${steps}
            </ol>
          </div>`;
    })
    .join("\n");
  return `          <div class="spec-tabs" data-os-switch role="group" aria-label="${escapeAttr(t("spec.heading"))}">
              ${tabs}
          </div>
${systems}`;
}

/**
 * {{meta}} and {{meta:<asset>}}: the line under a download button, such as "Version 3.0.1 · Oct 2, 2026 · 129 MB".
 * The date comes from release.json when it has one, as YYYY-MM-DD, and is left out when it does not. The size is added
 * when a file is named.
 */
function releaseLine(code, t, asset) {
  const parts = [`${t("home.version")} ${release.version}`];
  if (/^\d{4}-\d{2}-\d{2}$/.test(release.date ?? "")) {
    const day = new Date(`${release.date}T00:00:00Z`);
    parts.push(
      new Intl.DateTimeFormat(htmlLang(code), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(day),
    );
  }
  if (asset) parts.push(releaseValue(`${asset}.mb`));
  return parts.join(" · ");
}


/**
 * A recorded clip: a muted looping video with a pause button and an expand button. The clips are recorded from the real app by scripts/clips.cjs in the
 * app repo; each has an mp4, a webm and a poster in assets/clips and a .json beside them.
 */
/** The take recorded in this language when there is one (<name>-<code>-<tone>), else the English one. */
function localized(dir, name, tone, ext, code) {
  const own = `${dir}/${name}-${code}-${tone}.${ext}`;
  return code && code !== "en" && existsSync(join(root, own)) ? own : `${dir}/${name}-${tone}.${ext}`;
}

function clip(t, to, name, altKey, code) {
  const label = t(altKey).replace(/"/g, "&quot;");
  // Light and dark takes: assets/clips/<name>-<tone>.{webm,mp4,jpg}. CSS shows the one that matches
  // the system theme, so the hidden one never loads (preload="none").
  const file = (tone, ext) => to.asset(localized("assets/clips", name, tone, ext, code));
  // The poster never ships in the HTML: a display: none video still fetches it. site.js sets it from
  // data-poster for the take on show, when the clip nears the viewport. The hero, which is always
  // on screen, paints its poster as an inline background instead, so it also shows without JS.
  const first = name === "hero";
  const video = (tone) => `<video class="only-${tone}" muted playsinline loop preload="none" data-poster="${file(tone, "jpg")}"${first ? ` style="background:url(${file(tone, "jpg")}) center / cover"` : ""} aria-label="${label}" width="1280" height="800">
                  <source src="${file(tone, "webm")}" type="video/webm" />
                  <source src="${file(tone, "mp4")}" type="video/mp4" />
                </video>`;
  return `<figure class="clip" data-clip="${name}">
              <div class="app-frame clip-frame">
                ${video("light")}
                ${video("dark")}
                <div class="clip-controls">
                  <button class="clip-toggle" type="button" aria-label="${escapeAttr(t("clip.play"))}" data-pause="${escapeAttr(t("clip.pause"))}" data-play="${escapeAttr(t("clip.play"))}">
                    <svg class="icon" aria-hidden="true"><use href="#i-pause" /></svg>
                  </button>
                  <button class="clip-expand" type="button" aria-label="${escapeAttr(t("clip.expand"))}">
                    <svg class="icon" aria-hidden="true"><use href="#i-arrows-out" /></svg>
                  </button>
                </div>
              </div>
            </figure>`;
}
/**
 * A screenshot in both palettes, as AVIF and WebP. The first source that matches wins, so the dark
 * ones come first and only apply under prefers-color-scheme: dark. site.js rewrites the media of the
 * dark ones (data-tone="dark") when the visitor picks a theme. The PNG is what an old browser gets.
 */
function picture(t, to, name, altKey, loading, code) {
  const size = shots[name];
  if (!size) throw new Error(`{{shot:${name}}}: not in assets/img/shots.json, run npm run images`);

  // A shot with a "-phone" crop, the same size, gets it first under a width query: a phone
  // reads the closer picture and anything wider the whole window.
  const files = shots[`${name}-phone`] ? [`${name}-phone`, name] : [name];
  const src = (tone, ext, file = name) => to.asset(localized("assets/img", file, tone, ext, code));
  const source = (file, tone, ext) => {
    const width = file === name ? "" : "(max-width: 600px)";
    const dark = tone === "dark" ? "(prefers-color-scheme: dark)" : "";
    const media = [width, dark].filter(Boolean).join(" and ");
    return `<source type="image/${ext}" data-tone="${tone}"${width ? ` data-width="${width}"` : ""} srcset="${src(tone, ext, file)}"${
      media ? ` media="${media}"` : ""
    } />`;
  };
  const alt = escapeAttr(t(altKey));
  const hint = loading === "eager" ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';

  return `<picture data-shot="${name}">
                ${files
                  .flatMap((file) => ["dark", "light"].flatMap((tone) => ["avif", "webp"].map((ext) => source(file, tone, ext))))
                  .join("\n                ")}
                <img class="shot" src="${src("light", "png")}" width="${size.width}" height="${size.height}" alt="${alt}" ${hint} />
              </picture>`;
}

/** The four languages as links, each in its own name, for the page that shows them off. */
function languageLinks(code, page, to) {
  return LANGUAGES.map(
    (language) =>
      `<li><a lang="${language.code}" hreflang="${language.code}" href="${to.page(page.file, language.code)}"${
        language.code === code ? ' aria-current="true"' : ""
      }>${language.name}</a></li>`,
  ).join("\n              ");
}

function render(code, page) {
  const t = lookup(code);
  const to = links(code, page);

  const template = page.error ? errorPage(page, t) : templates[page.id];

  // {{docs:slug}} and {{page:file}} rather than a written-out path: a page
  // links to its own language's copy, and the translator never sees one.
  // Strings first, so a translated string can carry a link placeholder of its own.
  let body = template
    .replace(/{{include:([a-z-]+)}}/g, (_, name) => readFileSync(join(here, "pages", `_${name}.html`), "utf8").trimEnd())
    .replace(/\{\{t:([a-zA-Z0-9.]+)\}\}/g, (_, key) => t(key))
    .replace("{{policy}}", () => wrapTables(policies[code], t))
    .replace("{{errorlist}}", () => errorList(code, t, to))
    .replace(/\{\{root\}\}/g, to.asset(""))
    .replace(/{{docs:([a-z/-]*)}}/g, (_, slug) => to.docs(slug))
    .replace(/\{\{error:([a-z-]+)\}\}/g, (_, slug) => {
      if (!ERROR_SLUGS.includes(slug)) throw new Error(`${page.file} (${code}): no error page called ${slug}`);
      return to.error(slug);
    })
    .replace(/\{\{page:([a-zA-Z0-9.-]+)\}\}/g, (_, file) => to.page(file))
    .replace(/\{\{clean:([a-z-]+)\}\}/g, (_, slug) => to.clean(slug))
    .replace(/\{\{shot:([a-z-]+)\|([a-zA-Z.]+)(?:\|(eager))?\}\}/g, (_, name, alt, loading) => picture(t, to, name, alt, loading, code))
    .replace(/\{\{clip:([a-z-]+)\|([a-zA-Z.]+)\|([a-zA-Z.]+)\}\}/g, (_, name, alt) => clip(t, to, name, alt, code))
    .replace(/\{\{langlinks\}\}/g, () => languageLinks(code, page, to))
    .replace(/\{\{released\}\}/g, () => releasedNote(t))
    .replace("{{specs}}", () => specsBlock(t))
    .replace("{{recent}}", () => recentBuilds(t, code))
    .replace(/\{\{r:([a-z0-9.-]+)\}\}/g, (_, path) => releaseValue(path))
    .replace(/\{\{meta(?::([a-z0-9-]+))?\}\}/g, (_, asset) => releaseLine(code, t, asset))
    .replace(/\{\{stars\}\}/g, () =>
      Number.isFinite(release.stars) && release.stars >= config.starsMin
        ? `<span class="star-count"><svg class="icon" aria-hidden="true"><use href="#i-star" /></svg>${release.stars.toLocaleString("en-US")}</span>`
        : "")
    // Again for the policy and error pages, whose sources are spliced in above.
    .replace(/\{\{t:([a-zA-Z0-9.]+)\}\}/g, (_, key) => t(key));

  body = withNumbers(body).replace(/<main(?![^>]*id=)/, '<main id="main" tabindex="-1"');

  const missed = body.match(/\{\{[^}]+\}\}/);
  if (missed) throw new Error(`${page.file} (${code}): ${missed[0]} was never filled in`);

  return (
    head(code, page, t, to) +
    header(code, page, t, to)
      .replace("{{icons}}", icons)
      .replace("{{include:mark}}", () => readFileSync(join(here, "pages", "_mark.html"), "utf8").trimEnd()) +
    body.trimEnd() +
    footer(code, page, t, to)
  );
}

/**
 * Every indexable address, each listing every language it comes in: Google's
 * own spec for hreflang in a sitemap repeats the full alternates block on each
 * entry, itself included, rather than stating it once per group.
 */
function sitemap() {
  // No <lastmod>. The only date the build knows is today's, which would claim
  // every page changed on every deploy; Google stops trusting a lastmod that
  // is always new, and it is better left out than wrong.
  const findable = ALL_PAGES.filter((page) => !page.rooted);

  const entries = findable.flatMap((page) =>
    LANGUAGES.map((language) => {
      const links = LANGUAGES.map(
        (alt) => `      <xhtml:link rel="alternate" hreflang="${alt.code}" href="${url(alt.code, page)}" />`,
      ).join("\n");

      return `  <url>
    <loc>${url(language.code, page)}</loc>
${links}
      <xhtml:link rel="alternate" hreflang="x-default" href="${url("en", page)}" />
  </url>`;
    }),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

/**
 * /llms.txt, the llmstxt.org summary an assistant reads before it answers a
 * question about Draggy: what it is in a sentence, then every English page
 * with its own summary, so a model can fetch the one it needs.
 */
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

function llms() {
  const t = lookup("en");
  const plain = (text) => stripTags(text).replace(/\s+/g, " ").trim();
  const line = (page, title, summary) => `- [${title}](${url("en", page)})${summary ? `: ${plain(summary)}` : ""}`;
  const site = (id) => PAGES.find((page) => page.id === id);

  return `# Draggy

> ${plain(t("hero.heading"))} ${plain(t("index.description"))}

${plain(t("hero.lede"))} Build ${release.build}, for Windows, macOS and Linux. Four languages: English, French, Spanish and Russian. Open source under the Apache License 2.0.

## Facts

- Price: free for all users. Any cloud feature added later will be billed.
- License: Apache License 2.0.
- Platforms: Windows 10 or 11 (64-bit), macOS (Apple silicon) and Linux (.deb and .rpm, x86-64).
- Account: none needed.
- Not to be confused with Drag, the email product.

## Site

${line(PAGES[0], "Home", t("index.ogDescription"))}
${line(PAGES[1], t("download.title"), t("download.description"))}
${line(PAGES[2], t("privacyPolicy.title"), "")}
${line(site("openSource"), t("openSource.title"), t("openSource.description"))}
${line(site("compare"), t("compare.title"), t("compare.description"))}
${line(site("pricing"), t("pricing.title"), t("pricing.description"))}
${line(site("accessibility"), t("accessibility.title"), t("accessibility.description"))}

## Languages

- [English](${url("en", PAGES[0])})
- [Français](${url("fr", PAGES[0])})
- [Español](${url("es", PAGES[0])})
- [Русский](${url("ru", PAGES[0])})

## Documentation

- [Draggy documentation](${DOCS}/llms.txt): guides and reference, in the four languages

## Optional

- [Source code](${REPO})
- [Releases](${REPO}/releases)
- [Website source](${WEB_REPO})
- [Documentation source](${DOCS_REPO})
`;
}

/* ---------- go ---------- */

/*
 * Everything is written into a folder beside the target first, and the target is replaced only once
 * every page has been written. A render that throws halfway, such as a missing string, leaves the last
 * good build where it was, instead of a public/ that is half pages. The target is entirely generated:
 * the pages, and a copy of assets/ beside them. Vercel serves that one folder, so tools/, the locale
 * files and package.json are never published, and a language folder left behind by a code we no longer
 * ship cannot outlive the build that made it.
 */
mkdirSync(dirname(target), { recursive: true });
const out = join(dirname(target), `.${basename(target)}-building-${process.pid}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

try {
  cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });

  for (const language of LANGUAGES) {
    const into = join(out, folder(language.code));
    mkdirSync(into, { recursive: true });

    for (const page of [...ALL_PAGES, ...ERRORS[language.code]]) {
      const file = join(into, page.file);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, render(language.code, page));
    }
  }

  writeFileSync(join(out, "sitemap.xml"), sitemap());
  writeFileSync(join(out, "robots.txt"), robots);
  writeFileSync(join(out, "llms.txt"), llms());
  writeFileSync(join(out, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
  mkdirSync(join(out, ".well-known"), { recursive: true });
  writeFileSync(join(out, ".well-known", "security.txt"), securityTxt());

  // Two renames, not one: the target may already exist, and a directory cannot be renamed over a full one.
  const previous = `${target}.previous-${process.pid}`;
  if (existsSync(target)) renameSync(target, previous);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(out, target);
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
  } catch (error) {
    if (existsSync(previous)) renameSync(previous, target);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  throw error;
}

const shown = target.startsWith(`${root}${sep}`) ? relative(root, target) : target;

console.log(
  `built ${LANGUAGES.length * (ALL_PAGES.length + ERROR_SLUGS.length)} pages into ${shown}/: ` +
    `${PAGES.length} pages and ${ERROR_SLUGS.length} unlisted error pages in ` +
    `${LANGUAGES.length} languages, plus sitemap.xml, robots.txt, llms.txt and security.txt`,
);
