/**
 * IndexNow: tells Bing, Yandex, Seznam and Naver which pages exist, so a deploy shows up in their
 * results within hours instead of whenever they next crawl. The key is not a secret: the build
 * publishes it at /<key>.txt, which is how the engines check the ping came from this site.
 *
 * Run after a deploy is live (the workflow does it): `node tools/indexnow.mjs`. It reads the
 * live sitemap, so it sends what visitors can actually reach.
 */
import { pathToFileURL } from "node:url";

export const INDEXNOW_KEY = "ffd6817e65d6e751d651412552be431a";
const SITE = "https://draggy.org";

async function ping() {
  const sitemap = await fetch(`${SITE}/sitemap.xml`).then((r) => {
    if (!r.ok) throw new Error(`sitemap: HTTP ${r.status}`);
    return r.text();
  });
  const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!urlList.length) throw new Error("sitemap lists no pages");

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: "draggy.org", key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList }),
  });
  // 200 and 202 both mean accepted; 202 is the usual answer while the key is still being checked.
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow: HTTP ${res.status} ${await res.text()}`);
  console.log(`IndexNow accepted ${urlList.length} URLs (HTTP ${res.status})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ping().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
