import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import handler, { limited, validEmail } from "../api/macos-waitlist.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function call(body, headers = {}) {
  const res = { statusCode: 0, body: null, location: null, headers: {} };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (data) => ((res.body = data), res);
  res.redirect = (code, to) => ((res.statusCode = code), (res.location = to), res);
  res.setHeader = (k, v) => (res.headers[k] = v);
  return handler({ method: "POST", headers: { "content-type": "application/json", ...headers }, body }, res).then(() => res);
}

test("the waitlist accepts a plain address and refuses junk", () => {
  assert.ok(validEmail("a@b.co"));
  assert.ok(!validEmail("nope"));
  assert.ok(!validEmail(`${"a".repeat(250)}@b.co`));
  assert.ok(!validEmail(undefined));
});

test("the waitlist limits one address to five tries in ten minutes", () => {
  const ip = "203.0.113.9";
  for (let i = 0; i < 5; i++) assert.ok(!limited(ip, 1000 + i));
  assert.ok(limited(ip, 2000));
  assert.ok(!limited(ip, 1000 + 11 * 60 * 1000));
});

test("the waitlist refuses a bad address and redirects a form post back to the macOS card", async () => {
  assert.equal((await call({ email: "x" }, { "x-forwarded-for": "198.51.100.1" })).statusCode, 400);
  const form = await call({ email: "x" }, { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.2" });
  assert.equal(form.statusCode, 303);
  assert.equal(form.location, "/download#macos");
});

test("no page offers a macOS download", () => {
  const page = join(root, "public", "index.html");
  if (!existsSync(page)) throw new Error(`${page} is missing: run npm run build first`);
  const html = readFileSync(page, "utf8");
  assert.ok(!/macos-arm64|\.dmg/.test(html));
  const mac = html.match(/<div class="os-btn-group" data-os-match="macos">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(mac.includes("download#macos"), "Mac visitors go to the waitlist card");
});
