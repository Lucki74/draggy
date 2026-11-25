/**
 * Sends a visitor to the site in their own language, once, on the way in.
 *
 * Vercel Edge Middleware. It runs before the static file is served and only on
 * the front door: somebody who typed /de/, or followed a link to
 * /download, gets exactly the page they asked for. English lives at the
 * root, so an English visitor is never redirected at all. A crawler is never
 * redirected either, so "/" reads as one page to Search Console instead of a
 * page some of the time and a redirect the rest of the time.
 *
 * Order of preference:
 *
 *   1. A language the visitor picked from the menu, remembered in a cookie.
 *      An explicit choice is never overridden by where somebody happens to be.
 *   2. The first language in their browser's Accept-Language, by q-value, that
 *      this site has. The browser says what its owner reads, which is a better
 *      guess than where the owner is: an English-language browser in France is
 *      English, and a Norwegian browser that asks for French is served French.
 *   3. The country their IP is in, from Vercel's own geolocation header, for a
 *      browser that asks for nothing we ship.
 *   4. English.
 */

const SHIPPED = new Set([
  "en",
  "fr",
  "es",
  "ru",
]);

/**
 * A country is not a language. France, Spain and Russia (and their principal
 * language peers) point to their language. Belgium and Switzerland have no
 * entry, since neither has one language: the browser decides, and a browser
 * that asks for nothing we ship gets English.
 */
const BY_COUNTRY = {
  FR: "fr", MC: "fr", LU: "fr", SN: "fr", CI: "fr", ML: "fr", BF: "fr",
  NE: "fr", TG: "fr", BJ: "fr", GA: "fr", CG: "fr", CD: "fr", CM: "fr",
  MG: "fr", HT: "fr", GN: "fr", TD: "fr", CF: "fr", NC: "fr", PF: "fr",
  GP: "fr", MQ: "fr", RE: "fr", GF: "fr", YT: "fr",

  ES: "es", MX: "es", AR: "es", CO: "es", PE: "es", VE: "es", CL: "es",
  EC: "es", GT: "es", CU: "es", BO: "es", DO: "es", HN: "es", PY: "es",
  SV: "es", NI: "es", CR: "es", PA: "es", UY: "es", PR: "es", GQ: "es",

  RU: "ru", BY: "ru",
};

export const config = {
  // The front door only, in both the forms a browser can ask for it.
  matcher: ["/", "/index.html"],
};

/** The cookie the language menu writes, read without a cookie parser. */
function chosen(request) {
  const header = request.headers.get("cookie") || "";
  const found = header.match(/(?:^|;\s*)draggy-lang=([a-z]{2})(?:;|$)/);
  return found && SHIPPED.has(found[1]) ? found[1] : null;
}

/**
 * The language the visitor's browser ranks highest that this site has. Each
 * entry is a tag with an optional weight, "fr-CA;q=0.8". A missing weight is 1,
 * a weight of 0 means "not acceptable" and is dropped, and an unreadable weight
 * is dropped too. Ties keep the order the browser listed them in.
 */
function preferred(request) {
  const header = request.headers.get("accept-language") || "";

  const ranked = header
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.split(";").map((piece) => piece.trim());
      const q = params.find((piece) => /^q=/i.test(piece));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { language: tag.slice(0, 2).toLowerCase(), weight, order };
    })
    .filter(({ language, weight }) => SHIPPED.has(language) && weight > 0 && weight <= 1)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);

  return ranked.length ? ranked[0].language : null;
}

/**
 * A crawler gets English every time, never a guess based on the country its
 * request happened to come from. Googlebot crawls mostly from the US but not
 * only from the US, so without this the same URL, "/", is sometimes a page
 * and sometimes a redirect in Search Console's eyes - and that inconsistency
 * is what gets a homepage excluded as "page with redirect". The hreflang tags
 * already tell every search engine about the other eleven languages; this
 * redirect is a courtesy for human visitors, not for crawlers.
 */
function isCrawler(request) {
  return CRAWLER.test(request.headers.get("user-agent") || "");
}

/**
 * Crawlers, matched as whole words. "bot" inside another word is not a crawler:
 * CUBOT is a phone. A crawler that goes by its own name is listed by name, and
 * the generic words "bot", "google" and "lighthouse" have to stand alone.
 * "google" is there for Search Console's live test, which announces itself as
 * Google-InspectionTool with no "bot" anywhere in it. "crawl" and "spider" are
 * matched from the start of a word, which is where crawlers use them.
 */
const CRAWLER =
  /\b(?:googlebot|googleother|bingbot|duckduckbot|baiduspider|yandexbot|applebot|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|pinterestbot|facebookexternalhit|slurp|bot|google|lighthouse)\b|\b(?:crawl|spider)/i;

/**
 * Somebody already on the site who clicks Home is not arriving, they are
 * navigating, and they are reading whatever language they are already in.
 * Redirecting them there would flip the language under them halfway through a
 * visit, which is worse than guessing wrong on the way in.
 */
function alreadyHere(request) {
  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    return new URL(referer).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const CLEAR_COOKIE = "draggy-lang=; Path=/; Max-Age=0; SameSite=Lax";

function droppedLangCookie(request) {
  const header = request.headers.get("cookie") || "";
  const found = header.match(/(?:^|;\s*)draggy-lang=([a-z]{2})(?:;|$)/);
  return Boolean(found && !SHIPPED.has(found[1]));
}

/**
 * Every request header an answer depends on, for any cache in front of the
 * site. Without all of them a cache could hand one visitor's answer to another:
 * a pass-through to a French visitor who should be sent to /fr, or a redirect
 * to a crawler. The country header is in it because the country picks the
 * language. Pass-through and redirect answers carry the same list.
 */
const VARY = "Cookie, Accept-Language, Referer, User-Agent, X-Vercel-IP-Country";

/**
 * Carry the request on to the site, with headers added to the answer. The
 * "carry on" header is set here, not by a Vercel helper, since this file
 * imports nothing: every pass-through goes through this one function.
 */
const next = (headers = {}) =>
  new Response(null, { headers: { "x-middleware-next": "1", Vary: VARY, ...headers } });

export default function middleware(request) {
  if (isCrawler(request)) return next();
  if (alreadyHere(request)) return next();

  const clear = droppedLangCookie(request);

  const language =
    chosen(request) ||
    preferred(request) ||
    BY_COUNTRY[request.headers.get("x-vercel-ip-country") || ""] ||
    "en";

  // English is the root. There is nowhere to send it.
  if (language === "en") {
    return clear ? next({ "Set-Cookie": CLEAR_COOKIE }) : next();
  }

  const headers = {
    // /fr, not /fr/: trailingSlash is off, so /fr/ is itself a 308 to /fr,
    // and every visitor sent there took two redirects to arrive. The query
    // string comes along, so ?utm_source=... still reaches the page.
    Location: new URL(`/${language}${new URL(request.url).search}`, request.url).toString(),
    // Two visitors from two countries must not share one cached answer, and
    // a redirect that outlives the visitor's next choice is a trap.
    "Cache-Control": "no-store",
    Vary: VARY,
  };

  if (clear) headers["Set-Cookie"] = CLEAR_COOKIE;

  return new Response(null, {
    status: 307,
    headers,
  });
}

