/**
 * The one piece of this site that cannot be checked by looking at it. The
 * country arrives in a header only Vercel sets, so locally everybody is
 * English and a broken map would look exactly like a working one.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import middleware from "../middleware.js";

const ask = (headers = {}, url = "https://draggy.org/") =>
  middleware(new Request(url, { headers }));

/** Where a visitor ends up: the root when the middleware leaves them alone. */
const lands = (headers) => {
  const response = ask(headers);
  const location = response?.headers?.get("Location");
  return location ? new URL(location).pathname : "/";
};

const from = (country, rest = {}) => ({ "x-vercel-ip-country": country, ...rest });

test("sends a visitor to the language of the country they are in", () => {
  assert.equal(lands(from("FR")), "/fr");
  assert.equal(lands(from("ES")), "/es");
  assert.equal(lands(from("MX")), "/es");
  assert.equal(lands(from("RU")), "/ru");
  assert.equal(lands(from("BY")), "/ru");
});

test("leaves an English-speaking country alone", () => {
  // English is the root, so there is nowhere to send them and no redirect to
  // pay for.
  assert.equal(lands(from("US")), "/");
  assert.equal(lands(from("GB")), "/");
  assert.equal(lands(from("AU")), "/");
  assert.equal(lands(from("CA")), "/");
});

test("falls back to the browser for a country we ship nothing for", () => {
  assert.equal(lands(from("IN")), "/");
  assert.equal(lands(from("IN", { "accept-language": "es-MX,es;q=0.9" })), "/es");
  assert.equal(lands({ "accept-language": "ru-RU,ru;q=0.9,en;q=0.8" }), "/ru");
});

test("Accept-Language is read by its q-values, highest first", () => {
  // The browser's own ranking. A list that merely starts with French does not
  // make a visitor French when they weighted English higher.
  assert.equal(lands({ "accept-language": "fr;q=0.1,en;q=0.9" }), "/");
  assert.equal(lands({ "accept-language": "es;q=0.4,ru;q=0.8" }), "/ru");
  // Equal weights keep the order the browser listed them in.
  assert.equal(lands({ "accept-language": "fr;q=0.8,es;q=0.8" }), "/fr");
  // A weight we cannot read counts as refused, so the next language wins.
  assert.equal(lands({ "accept-language": "fr;q=abc,es;q=0.2" }), "/es");
  // A wildcard names no language.
  assert.equal(lands({ "accept-language": "*;q=0.5,ru;q=0.1" }), "/ru");
});

test("a language the browser refuses with q=0 is never used", () => {
  assert.equal(lands({ "accept-language": "fr;q=0,en;q=0.5" }), "/");
  assert.equal(lands({ "accept-language": "fr;q=0,es;q=0.5" }), "/es");
});

test("knowing nothing about a visitor means English", () => {
  assert.equal(lands({}), "/");
});

test("a language chosen from the menu outranks the country", () => {
  // Where somebody is and what they read are different questions, and an
  // explicit choice must survive being asked again.
  assert.equal(lands(from("FR", { cookie: "draggy-lang=es" })), "/es");
  assert.equal(lands(from("FR", { cookie: "draggy-lang=en" })), "/");
  assert.equal(
    lands(from("FR", { cookie: "draggy-lang=ru" })),
    "/ru",
  );
  // The menu beats the browser too.
  assert.equal(lands({ cookie: "draggy-lang=ru", "accept-language": "en-US,en;q=0.9" }), "/ru");
});

test("the browser's language outranks the country", () => {
  // An English-language browser in France is English. Where its owner happens
  // to be is not what they read.
  assert.equal(lands(from("FR", { "accept-language": "en-US,en;q=0.9" })), "/");
  assert.equal(lands(from("ES", { "accept-language": "en-GB,en;q=0.9" })), "/");
  assert.equal(lands(from("SG", { "accept-language": "en-GB,en;q=0.9" })), "/");
  assert.equal(lands(from("FR", { "accept-language": "fr;q=0,en;q=0.5" })), "/");
  // A browser asking for a language we ship gets it, from any country.
  assert.equal(lands(from("US", { "accept-language": "fr-CA,fr;q=0.9" })), "/fr");
  assert.equal(lands(from("CN", { "accept-language": "es-MX,es;q=0.9" })), "/es");
});

test("the country decides when the browser asks for nothing we ship", () => {
  assert.equal(lands(from("FR", { "accept-language": "de-DE,de;q=0.9" })), "/fr");
  assert.equal(lands(from("MX", { "accept-language": "ja-JP" })), "/es");
});

test("a cookie naming a language we do not have is ignored", () => {
  assert.equal(lands(from("FR", { cookie: "draggy-lang=zz" })), "/fr");
  assert.equal(lands(from("FR", { cookie: "draggy-lang=" })), "/fr");
  assert.equal(lands(from("FR", { cookie: "draggy-lang=de" })), "/fr");
});

test("a cookie naming a dropped language is ignored and cleared", () => {
  const res = ask(from("FR", { cookie: "draggy-lang=de" }));
  assert.equal(lands(from("FR", { cookie: "draggy-lang=de" })), "/fr");
  assert.match(res.headers.get("Set-Cookie"), /draggy-lang=;/);

  const resEn = ask(from("US", { cookie: "draggy-lang=ja" }));
  assert.equal(resEn.headers.get("x-middleware-next"), "1");
  assert.match(resEn.headers.get("Set-Cookie"), /draggy-lang=;/);
});

test("Belgium and Switzerland follow Accept-Language", () => {
  assert.equal(lands(from("BE")), "/");
  assert.equal(lands(from("BE", { "accept-language": "fr-BE,fr;q=0.9,nl;q=0.8" })), "/fr");
  assert.equal(lands(from("BE", { "accept-language": "nl-BE,nl;q=0.9" })), "/");

  assert.equal(lands(from("CH")), "/");
  assert.equal(lands(from("CH", { "accept-language": "fr-CH,fr;q=0.9,de;q=0.8" })), "/fr");
  assert.equal(lands(from("CH", { "accept-language": "de-CH,de;q=0.9" })), "/");
});

test("a crawler always gets English, whatever country it crawls from", () => {
  // Googlebot mostly crawls from the US, but not only from the US. If it
  // sometimes got redirected, "/" would read as a redirect in Search Console
  // some of the time and a page the rest of the time and the crawler needs one
  // answer, always, so the hreflang tags can do the rest of the work.
  assert.equal(lands(from("FR", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" })), "/");
  assert.equal(lands(from("JP", { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" })), "/");
  assert.equal(lands(from("EG", { "user-agent": "DuckDuckBot/1.1" })), "/");
  assert.equal(lands(from("CN", { "user-agent": "Mozilla/5.0 (compatible; Baiduspider/2.0)" })), "/");
  // Search Console's live test, which has no "bot" in its name.
  assert.equal(lands(from("DE", { "user-agent": "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)" })), "/");
});

test("bot inside another word is not a crawler, so a phone called CUBOT is a visitor", () => {
  // CUBOT is a phone brand. Matching "bot" anywhere kept its owners on English
  // for good, with the crawler's answer.
  const cubot = "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  assert.equal(lands(from("FR", { "user-agent": cubot })), "/fr");
  assert.equal(lands(from("FR", { "user-agent": "Mozilla/5.0 (Linux; Android 13; CUBOT_NOTE_PLUS) Mobile" })), "/fr");
});

test("named and generic crawlers are still crawlers", () => {
  for (const agent of [
    "Mozilla/5.0 (compatible; Googlebot-Image/1.0)",
    "Mozilla/5.0 (compatible; GoogleOther)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Applebot/0.1 (+http://www.apple.com/go/applebot)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
    "Sogou web spider/4.0 (+http://www.sogou.com/docs/help/webmasters.htm#07)",
    "Mozilla/5.0 (compatible; Mediapartners-Google)",
    "Some-Monitor/2.0 (crawler; +https://example.org/bot)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Chrome-Lighthouse",
  ]) {
    assert.equal(lands(from("FR", { "user-agent": agent })), "/", agent);
  }
});

test("navigating inside the site never flips the language", () => {
  // Clicking Home on the English page from a French address used to land on
  // the French one, changing the language halfway through a visit.
  assert.equal(lands(from("FR", { referer: "https://draggy.org/download" })), "/");
  assert.equal(lands(from("FR", { referer: "https://news.ycombinator.com/" })), "/fr");
  assert.equal(lands(from("FR", { referer: "not a url" })), "/fr");
});

test("the language redirect keeps the query string", () => {
  // Campaign tags such as utm_source are how a visit is attributed, so the
  // first page on the way in must not throw them away.
  const response = ask(from("FR"), "https://draggy.org/?utm_source=hn&ref=x");
  assert.equal(response.headers.get("Location"), "https://draggy.org/fr?utm_source=hn&ref=x");

  const index = ask(from("FR"), "https://draggy.org/index.html?a=1");
  assert.equal(index.headers.get("Location"), "https://draggy.org/fr?a=1");
});

test("the redirect is never shared between two visitors", () => {
  const response = ask(from("FR"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Vary"), /Cookie/);
});

test("every answer, pass-through or redirect, names what it depends on in Vary", () => {
  // Without it a shared cache could keep the English page for "/" and hand it
  // to a French visitor who should be sent to /fr, or keep a crawler's answer
  // for a person. The same list has to cover both answers.
  const names = ["Cookie", "Accept-Language", "Referer", "User-Agent", "X-Vercel-IP-Country"];
  const answers = [
    ask({}),
    ask({}, "https://draggy.org/index.html"),
    ask({ "user-agent": "Googlebot/2.1" }),
    ask(from("US", { cookie: "draggy-lang=ja" })),
    ask(from("FR")),
  ];

  for (const response of answers) {
    const vary = response.headers.get("Vary");
    assert.ok(vary, "no Vary header");
    for (const name of names) assert.match(vary, new RegExp(name, "i"));
  }

  assert.equal(answers[0].headers.get("x-middleware-next"), "1");
  assert.equal(answers[0].headers.get("Vary"), answers[4].headers.get("Vary"));
});

test("every country in the map names a language the site has", () => {
  // A typo here is a redirect to a folder that does not exist.
  const shipped = new Set(["fr", "es", "ru"]);
  const seen = new Set();

  for (const country of Object.keys({ ...ISO })) {
    const to = lands(from(country));
    if (to === "/") continue;
    const code = to.replace(/\//g, "");
    assert.ok(shipped.has(code), `${country} goes to ${to}`);
    seen.add(code);
  }

  // and every language is reachable from somewhere
  assert.deepEqual([...shipped].filter((code) => !seen.has(code)), []);
});

/** Every two-letter country code, so the map is checked rather than sampled. */
const ISO = Object.fromEntries(
  "AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GE GF GH GN GP GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KM KP KR KW KZ LA LB LI LK LR LT LU LV LY MA MC MD ME MG MK ML MM MN MO MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NZ OM PA PE PF PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SD SE SG SI SK SL SM SN SO SR ST SV SX SY SZ TD TG TH TJ TL TM TN TR TT TW TZ UA UG US UY UZ VA VE VN VU YE YT ZA ZM ZW"
    .split(" ")
    .map((code) => [code, true]),
);

/**
 * vercel.json, read as data. Its redirects are followed the way Vercel reads
 * them: in order, first match wins, `:name` is one segment, and `:name*` and
 * `:name+` take the rest of the path. This reads only the patterns this file
 * uses. It is a check on the file, not a copy of Vercel's router, so a preview
 * deployment is still the final word.
 */
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

function toRegExp(source) {
  const body = source
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

/** Where one redirect from vercel.json sends a path, or null. Host-only rules are skipped. */
function redirectFor(path) {
  for (const rule of vercel.redirects) {
    if (rule.has) continue;
    const match = toRegExp(rule.source).exec(path);
    if (match) return fill(rule.destination, match.groups);
  }
  return null;
}

/** Follows the redirects from a path to the address it finally lands on. */
function landing(path) {
  const hops = [];
  let at = path;

  for (let next = redirectFor(at); next !== null; next = redirectFor(at)) {
    hops.push(next);
    at = next;
    assert.ok(hops.length <= 3, `${path} is still redirecting after ${hops.length} hops`);
  }

  return { at, hops: hops.length };
}

test("every redirect in vercel.json is permanent", () => {
  for (const rule of vercel.redirects) assert.equal(rule.permanent, true, rule.source);
});

test("the redirects that already existed still apply", () => {
  assert.deepEqual(landing("/index.html"), { at: "/", hops: 1 });
  assert.deepEqual(landing("/fr/index.html"), { at: "/fr", hops: 1 });
  assert.deepEqual(landing("/de"), { at: "/", hops: 1 });
  assert.deepEqual(landing("/de/privacy-policy"), { at: "/privacy-policy", hops: 1 });
});

test("the wiki now lives at docs.draggy.org, in every language", () => {
  assert.deepEqual(landing("/wiki"), { at: "https://docs.draggy.org", hops: 1 });
  assert.deepEqual(landing("/wiki/models"), { at: "https://docs.draggy.org/models", hops: 1 });
  assert.deepEqual(landing("/fr/wiki"), { at: "https://docs.draggy.org/fr", hops: 1 });
  assert.deepEqual(landing("/ru/wiki/troubleshooting"), { at: "https://docs.draggy.org/ru/troubleshooting", hops: 1 });
  assert.deepEqual(landing("/fr/wiki/models/macos-table"), { at: "https://docs.draggy.org/fr/models", hops: 1 });
  assert.deepEqual(landing("/en/wiki/models"), { at: "https://docs.draggy.org/models", hops: 2 });
  assert.deepEqual(landing("/de/wiki"), { at: "https://docs.draggy.org", hops: 2 });
});

test("the old download.html address goes to /download", () => {
  assert.deepEqual(landing("/download.html"), { at: "/download", hops: 1 });
  assert.deepEqual(landing("/en/download.html"), { at: "/download", hops: 1 });

  for (const code of ["fr", "es", "ru"]) {
    assert.deepEqual(landing(`/${code}/download.html`), { at: `/${code}/download`, hops: 1 });
  }
});

test("/en and everything under it go to the English address", () => {
  assert.deepEqual(landing("/en"), { at: "/", hops: 1 });
  assert.deepEqual(landing("/en/"), { at: "/", hops: 1 });
  assert.deepEqual(landing("/en/index.html"), { at: "/", hops: 1 });
  assert.deepEqual(landing("/en/download"), { at: "/download", hops: 1 });
  assert.deepEqual(landing("/en/download/"), { at: "/download/", hops: 1 });
  assert.deepEqual(landing("/en/privacy-policy"), { at: "/privacy-policy", hops: 1 });
  assert.deepEqual(landing("/en/error/out-of-memory"), { at: "/error/out-of-memory", hops: 1 });
});

test("the canonical addresses are answered directly, never redirected", () => {
  // Every address the site links to, and so every address in the sitemap, is
  // served by its own file or folder. A redirect here would be a second hop
  // for every crawler and visitor.
  for (const path of [
    "/",
    "/fr",
    "/download",
    "/fr/download",
    "/privacy-policy",
    "/fr/privacy-policy",
    "/error",
    "/error/out-of-memory",
    "/fr/error/out-of-memory",
  ]) {
    assert.equal(redirectFor(path), null, path);
  }
});
