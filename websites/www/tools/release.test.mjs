/**
 * The release data the site prints: how fetch-release.mjs reads it, checks it and links to it.
 * GitHub is never asked. The fetch is replaced by a stand-in that serves one fake release.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRelease, downloadUrl, fetchRelease, hashes, loadRelease, manifestFiles } from "./fetch-release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/Lucki74/draggy";
const API = "https://api.github.com/repos/Lucki74/draggy";

/** One fake build: its installers, and the manifests that list some of them. */
const TAG = "b-2";
const VERSION = "3.0.2";
const FILES = {
  "draggy_setup.exe": "windows bytes",
  "Draggy-3.0.2-macos-arm64.zip": "mac bytes",
  "draggy-3.0.2-1.x86_64.rpm": "rpm bytes",
  "draggy_3.0.2-1_amd64.deb": "deb bytes",
};
const MANIFESTS = {
  "latest.yml": ["draggy_setup.exe"],
};

const digest = (text) => createHash("sha512").update(text).digest("base64");

/** The electron-updater manifest the release workflow writes, with the keys of each list entry written in `order`. */
function manifestText(names, order = ["url", "sha512", "size"], version = VERSION) {
  const value = { url: (name) => name, sha512: (name) => digest(FILES[name]), size: (name) => String(FILES[name].length) };
  const entry = (name) => order.map((key, at) => `${at === 0 ? "  - " : "    "}${key}: ${value[key](name)}`);
  return [
    `version: ${version}`,
    "files:",
    ...names.flatMap(entry),
    `path: ${names[0]}`,
    `sha512: ${digest(FILES[names[0]])}`,
    "releaseDate: '2026-10-12T00:00:00.000Z'",
    "",
  ].join("\n");
}

/**
 * Replaces fetch for the length of one test: the release, its manifests and its files, all in
 * memory. Returns the mock, so a test can see which addresses were asked for.
 */
function stubGitHub(t, { order, version = VERSION, published = "2026-10-12T09:30:00Z" } = {}) {
  const names = [...Object.keys(MANIFESTS), ...Object.keys(FILES)];
  const release = {
    tag_name: TAG,
    published_at: published,
    assets: names.map((name) => ({
      name,
      size: (FILES[name] ?? manifestText(MANIFESTS[name], order, version)).length,
      browser_download_url: `${REPO}/releases/download/${TAG}/${name}`,
    })),
  };
  // The list GitHub gives for "recent": a draft, a prerelease, a tag that is no build, a build with
  // no manifest, and older builds with one. Each older build's manifest says its own version.
  const older = (tag, when, manifest = true) => ({
    tag_name: tag,
    published_at: when,
    draft: false,
    prerelease: false,
    assets: manifest ? [{ name: "latest.yml", size: 40, browser_download_url: `${REPO}/releases/download/${tag}/latest.yml` }] : [],
  });
  const list = [
    release,
    older("b-1", "2026-10-05T08:00:00Z"),
    { ...older("b-3", "2026-10-06T08:00:00Z"), prerelease: true },
    { ...older("b-4", "2026-10-07T08:00:00Z"), draft: true },
    older("nightly", "2026-10-08T08:00:00Z"),
    older("b-5", "2026-10-09T08:00:00Z", false),
    older("b-6", "2026-09-01T08:00:00Z"),
    older("b-7", "2026-08-01T08:00:00Z"),
  ];
  return t.mock.method(globalThis, "fetch", async (url) => {
    if (url === `${API}/releases/latest`) return Response.json(release);
    if (url === `${API}/releases?per_page=20`) return Response.json(list);
    if (url === API) return Response.json({ stargazers_count: 25 });
    const prefix = `${REPO}/releases/download/${TAG}/`;
    if (url.startsWith(prefix)) {
      const name = url.slice(prefix.length);
      if (MANIFESTS[name]) return new Response(manifestText(MANIFESTS[name], order, version));
      if (FILES[name]) return new Response(FILES[name]);
    }
    const old = /^https:\/\/github\.com\/Lucki74\/draggy\/releases\/download\/(b-\d+)\/latest\.yml$/.exec(url);
    if (old) return new Response(`version: 3.0.${old[1].slice(2)}\n`);
    return new Response("not found", { status: 404 });
  });
}

test("a download link names the release tag and the file, never latest", () => {
  assert.equal(downloadUrl("b-1", "draggy_setup.exe"), `${REPO}/releases/download/b-1/draggy_setup.exe`);
});

test("every link in release.json is pinned to the tag its checksum was taken from", () => {
  const release = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
  for (const [key, asset] of Object.entries(release.assets)) {
    assert.equal(asset.url, downloadUrl(asset.tag ?? release.tag, asset.name), key);
  }
});

test("fetchRelease links each file to the new tag and takes its checksum from the manifest", async (t) => {
  stubGitHub(t);
  const release = await fetchRelease();

  assert.equal(release.tag, TAG);
  assert.equal(release.build, 2);
  assert.equal(release.version, VERSION);
  assert.equal(release.assets["windows-exe"].url, `${REPO}/releases/download/${TAG}/draggy_setup.exe`);
  // Listed in a manifest: the checksum is the manifest's, converted from base64 to hex.
  assert.equal(release.assets["windows-exe"].sha512, createHash("sha512").update(FILES["draggy_setup.exe"]).digest("hex"));
});

test("manifest entries are read by key, so the order of the keys does not matter", () => {
  const manifest = [
    "version: 3.0.2",
    "files:",
    `  - sha512: ${digest("first")}`,
    "    size: 10",
    "    url: draggy_setup.exe",
    "  - size: 20",
    "    url: draggy_3.0.2-1_amd64.deb",
    `    sha512: ${digest("second")}`,
    "path: draggy_setup.exe",
    `sha512: ${digest("top level")}`,
    "releaseDate: '2026-10-12T00:00:00.000Z'",
    "",
  ].join("\n");
  assert.deepEqual(hashes(manifest), {
    "draggy_setup.exe": digest("first"),
    "draggy_3.0.2-1_amd64.deb": digest("second"),
  });
  assert.deepEqual(
    manifestFiles(manifest).map((file) => file.size),
    ["10", "20"],
  );
});

test("quoted values are read as their text, and CRLF line endings read the same", () => {
  const manifest = `files:\r\n  - url: 'draggy_setup.exe'\r\n    sha512: "${digest("quoted")}"\r\n`;
  assert.deepEqual(hashes(manifest), { "draggy_setup.exe": digest("quoted") });
});

test("a files list whose dashes sit at the margin is read as well as an indented one", () => {
  const manifest = [`files:`, `- url: draggy_setup.exe`, `  sha512: ${digest("margin")}`, `  size: 1`, `path: draggy_setup.exe`, `sha512: ${digest("after")}`, ""].join("\n");
  assert.deepEqual(hashes(manifest), { "draggy_setup.exe": digest("margin") });
});

test("only the files list is read: a checksum outside it is not an entry", () => {
  const manifest = ["version: 3.0.2", `sha512: ${digest("before")}`, "files:", "  - url: a.exe", `    sha512: ${digest("a")}`, ""].join("\n");
  assert.deepEqual(hashes(manifest), { "a.exe": digest("a") });
  assert.deepEqual(hashes("version: 3.0.2\npath: a.exe\n"), {});
});

test("an entry without a checksum of 64 bytes is left out, so the file is hashed instead", () => {
  const manifest = ["files:", "  - url: short.exe", "    sha512: abc", "  - url: none.exe", "    size: 1", "  - url: ok.exe", `    sha512: ${digest("ok")}`].join("\n");
  assert.deepEqual(hashes(manifest), { "ok.exe": digest("ok") });
});

test("a fetched release reads its checksums from the manifests whatever order their keys are in", async (t) => {
  const fetches = stubGitHub(t, { order: ["size", "sha512", "url"] });
  const release = await fetchRelease();

  assert.equal(release.assets["windows-exe"].sha512, createHash("sha512").update(FILES["draggy_setup.exe"]).digest("hex"));
  // Only Windows is fetched; its checksum is read from latest.yml rather than downloading the installer.
  const downloads = fetches.mock.calls
    .map((call) => call.arguments[0])
    .filter((url) => url.startsWith(`${REPO}/releases/download/`) && !url.endsWith(".yml"));
  assert.deepEqual(downloads, []);
});

const snapshot = () => JSON.parse(readFileSync(join(root, "release.json"), "utf8"));

test("the committed release.json passes the checks the build applies", () => {
  assert.doesNotThrow(() => checkRelease(snapshot()));
});

test("a version that is not three numbers is refused, since the page prints it", () => {
  for (const version of ["3.0", "v3.0.1", "3.0.1-beta", '3.0.1"><script>', undefined]) {
    assert.throws(() => checkRelease({ ...snapshot(), version }), /is not x\.y\.z/, String(version));
  }
});

test("a tag that is not b-N, or a build that is not its number, is refused", () => {
  for (const tag of ["b-0", "b-01", "3.0.1", "b-1<b>"]) {
    assert.throws(() => checkRelease({ ...snapshot(), tag }), /is not b-N/, tag);
  }
  assert.throws(() => checkRelease({ ...snapshot(), build: 999 }), /is not the number in tag/);
});

test("a file name, size or checksum that a link or a table could not hold is refused", () => {
  const withAsset = (change) => {
    const release = snapshot();
    Object.assign(release.assets["windows-exe"], change);
    return release;
  };
  assert.throws(() => checkRelease(withAsset({ name: "draggy setup.exe" })), /is not a plain name/);
  assert.throws(() => checkRelease(withAsset({ name: "../draggy_setup.exe" })), /is not a plain name/);
  assert.throws(() => checkRelease(withAsset({ size: 0 })), /size is not a byte count/);
  assert.throws(() => checkRelease(withAsset({ sha512: "abc" })), /sha512 is not 128 hex digits/);
});

test("fetchRelease refuses a manifest version that is not x.y.z", async (t) => {
  stubGitHub(t, { version: "3.0.2<img>" });
  await assert.rejects(fetchRelease(), /version "3.0.2<img>" is not x\.y\.z/);
});

test("fetchRelease dates the release from published_at and lists the three newest builds that GitHub confirms", async (t) => {
  stubGitHub(t);
  const release = await fetchRelease();

  assert.equal(release.date, "2026-10-12");
  // Drafts, prereleases, "nightly", b-5 (no manifest) and anything past the third are left out.
  assert.deepEqual(
    release.recent.map(({ notes, ...entry }) => entry),
    [
      { tag: "b-2", build: 2, version: "3.0.2", date: "2026-10-12", html_url: `${REPO}/releases/tag/b-2` },
      { tag: "b-1", build: 1, version: "3.0.1", date: "2026-10-05", html_url: `${REPO}/releases/tag/b-1` },
      { tag: "b-6", build: 6, version: "3.0.6", date: "2026-09-01", html_url: `${REPO}/releases/tag/b-6` },
    ],
  );
});

test("a release GitHub has not dated gets no date, and nothing is printed for it", async (t) => {
  stubGitHub(t, { published: null });
  const release = await fetchRelease();

  assert.equal(release.date, undefined);
  assert.equal(release.recent[0].date, undefined);
  // Left out of the file entirely, not written as null, so the page prints no date.
  assert.equal("date" in JSON.parse(JSON.stringify(release)), false);
});

test("a date that is not a calendar day, or a recent entry that does not add up, is refused", () => {
  assert.throws(() => checkRelease({ ...snapshot(), date: "12/10/2026" }), /is not YYYY-MM-DD/);
  assert.throws(() => checkRelease({ ...snapshot(), date: '2026-10-12"><script>' }), /is not YYYY-MM-DD/);
  assert.throws(() => checkRelease({ ...snapshot(), date: "2026-13-45" }), /is not YYYY-MM-DD/);

  const entry = { tag: "b-1", build: 1, version: "3.0.1", date: "2026-10-05", html_url: `${REPO}/releases/tag/b-1` };
  const withRecent = (...recent) => ({ ...snapshot(), recent });
  assert.doesNotThrow(() => checkRelease(withRecent(entry)));
  assert.doesNotThrow(() => checkRelease(withRecent({ ...entry, date: undefined })));
  assert.throws(() => checkRelease(withRecent({ ...entry, tag: "b-2" })), /not the number in tag b-2/);
  assert.throws(() => checkRelease(withRecent({ ...entry, version: "3.0" })), /is not x\.y\.z/);
  assert.throws(() => checkRelease(withRecent({ ...entry, date: "yesterday" })), /is not YYYY-MM-DD/);
  assert.throws(() => checkRelease(withRecent({ ...entry, html_url: "https://example.com/b-1" })), /is not its release page/);
  assert.throws(() => checkRelease(withRecent(entry, entry, entry, entry)), /at most 3 builds/);
});

/** Runs fn with environment variables set, or removed when the value is undefined, then restores them. */
async function withEnv(vars, fn) {
  const before = { ...process.env };
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const name of Object.keys(vars)) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
}

test("when GitHub refuses, the build keeps release.json, says why, and annotates the run in CI", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
  const warn = t.mock.method(console, "warn", () => {});
  const log = t.mock.method(console, "log", () => {});

  const release = await withEnv({ CI: "true", DRAGGY_OFFLINE: undefined }, loadRelease);

  assert.equal(release.source, "release.json");
  assert.equal(release.build, snapshot().build);
  assert.match(warn.mock.calls[0].arguments[0], /GitHub answered 403 \(forbidden or rate limited\) for .*releases\/latest/);
  const annotations = log.mock.calls.map((call) => call.arguments[0]).filter((line) => line.startsWith("::warning::"));
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /^::warning::release: GitHub answered 403/);
});

test("locally, the same fallback is a plain warning that names an unreachable GitHub", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  });
  const warn = t.mock.method(console, "warn", () => {});
  const log = t.mock.method(console, "log", () => {});

  const release = await withEnv({ CI: undefined, DRAGGY_OFFLINE: undefined }, loadRelease);

  assert.equal(release.source, "release.json");
  assert.match(warn.mock.calls[0].arguments[0], /GitHub could not be reached \(ENOTFOUND\)/);
  assert.equal(log.mock.calls.some((call) => String(call.arguments[0]).startsWith("::warning::")), false);
});
