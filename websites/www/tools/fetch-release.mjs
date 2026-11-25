/**
 * The newest release of the app, read at build time.
 *
 *   npm run release
 *
 * The site used to ask api.github.com from every visitor's browser. That is a
 * third-party request on every page load, and it is rate limited per visitor.
 * Now the build asks once, writes the answer into the pages, and a visitor's
 * browser talks to nobody but this site.
 *
 * What it reads: the release itself for the version and the file names, and the
 * update manifest (latest.yml) that the app's release workflow uploads next to the
 * Windows installer, for its SHA-512. That file is the bridge the Electron builds
 * read, so it is in the numbered release (b-N) and carries the Tauri setup.
 * Those hashes are base64 there; Get-FileHash and shasum print hex, so they are
 * converted here, once, rather than in front of the reader. The publish day comes from the release's
 * published_at, and the "recent" list from the newest three numbered builds, each with its own manifest.
 *
 * The links point at this release's tag, not at "latest". The checksum and size
 * describe the files of one tag, so a link that followed "latest" would serve a
 * newer file than the page describes until the next refresh.
 *
 * When GitHub cannot be reached, or answers with a rate limit, the last good
 * answer in release.json is used instead. `npm run release` refreshes that
 * file, and the build itself never writes it. The build says so when it falls
 * back: a warning in its output, and in GitHub Actions an annotation on the run.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(root, "release.json");
const REPO = "Lucki74/draggy";

/** The downloads the page offers, and how to recognise each in the release. Only the Windows installer is in an update manifest, so only it carries a checksum. */
const ASSETS = {
  "windows-exe": (name) => name === "draggy_setup.exe",
  "linux-deb": (name) => /^draggy_[\d.]+-\d+_amd64\.deb$/.test(name),
  "linux-rpm": (name) => /^draggy-[\d.]+-\d+\.x86_64\.rpm$/.test(name),
};

const MANIFESTS = ["latest.yml"];

/** How many builds the site lists under "Recent releases". */
const RECENT = 3;

const headers = {
  Accept: "application/vnd.github+json",
  // Anonymous calls are limited to sixty an hour per address, and a CI runner shares its address.
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

/** The address of one file of one tagged release. Pinned to the tag, so the link and its checksum move together. */
export function downloadUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${tag}/${name}`;
}

/** The release page of one tagged build: the address the page links to, and the one a recent build links to. */
export function releaseUrl(tag) {
  return `https://github.com/${REPO}/releases/tag/${tag}`;
}

/** A calendar day as YYYY-MM-DD, the only form the page prints. */
const isDate = (text) => typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));

/** The day a release was published, from GitHub's published_at. Undefined when GitHub gives none, so no date is printed. */
const dateOf = (release) => (release.published_at ? release.published_at.slice(0, 10) : undefined);

/** What a refused request usually means, in words a build log can carry. */
const STATUS_WHY = { 401: "unauthorized", 403: "forbidden or rate limited", 429: "rate limited" };

async function get(url, as) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(`GitHub could not be reached (${error.cause?.code ?? error.message})`);
  }
  if (!response.ok) {
    const why = STATUS_WHY[response.status];
    throw new Error(`GitHub answered ${response.status}${why ? ` (${why})` : ""} for ${url}`);
  }
  return as === "json" ? response.json() : response.text();
}

/** A YAML scalar as electron-builder writes it: bare, or in single or double quotes. */
function scalar(text) {
  return text.trim().replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * The entries of the `files:` list of an electron-builder manifest, one object per entry, with each
 * key read by name. The order of the keys does not matter. Nothing outside the list is read.
 * It is a line reader rather than a YAML parser: the manifests are flat, and the list holds one
 * level of `key: value` lines under each `- `.
 */
export function manifestFiles(text) {
  const files = [];
  let inFiles = false;
  let entry = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // A key at the left margin ends the list before it, and only `files:` starts one. YAML also
    // lets the `- ` items sit at the margin under `files:`, so those are not keys.
    if (!/^\s/.test(line) && !(inFiles && line.startsWith("-"))) {
      inFiles = /^files:\s*$/.test(line);
      entry = null;
      continue;
    }
    if (!inFiles) continue;
    const match = /^\s*(-\s+)?([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (!match) continue;
    const [, dash, key, value] = match;
    if (dash) {
      entry = {};
      files.push(entry);
    }
    if (entry) entry[key] = scalar(value);
  }
  return files;
}

/** Base64 of exactly 64 bytes: the shape of a SHA-512 in a manifest. */
function isSha512(text) {
  return typeof text === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(text) && Buffer.from(text, "base64").length === 64;
}

/** The SHA-512 of each file a manifest lists, by file name, base64 as the manifest writes it. */
export function hashes(manifest) {
  const found = {};
  for (const file of manifestFiles(manifest)) {
    if (file.url && isSha512(file.sha512)) found[file.url] = file.sha512;
  }
  return found;
}

/**
 * The notes of a release as two lists. GitHub gives them as Markdown: a bold heading ("**Updates**",
 * "**Fixes**") and a bullet list under each. Anything else, such as the closing link, is dropped.
 */
export function parseNotes(body) {
  const notes = { updates: [], fixes: [] };
  let section = null;
  for (const line of String(body ?? "").split(/\r?\n/)) {
    const heading = /^\*\*(.+?)\*\*\s*$/.exec(line.trim())?.[1];
    if (heading) {
      section = /fix/i.test(heading) ? "fixes" : /update|new|add|change/i.test(heading) ? "updates" : null;
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line)?.[1];
    if (section && item && notes[section].length < 12) notes[section].push(item.trim().slice(0, 240));
  }
  return notes;
}

/** The version an update manifest of one release writes, or null when none of its manifests has one. */
async function manifestVersion(release) {
  for (const name of MANIFESTS) {
    const asset = release.assets?.find((item) => item.name === name);
    if (!asset) continue;
    const written = /^version:(.*)$/m.exec(await get(asset.browser_download_url, "text"))?.[1];
    if (written !== undefined) return scalar(written);
  }
  return null;
}

/**
 * The newest RECENT numbered builds, newest first, each with its version and publish day. Drafts,
 * prereleases and a build whose manifests give no version are left out: the list holds only what
 * GitHub confirms, so a line on the page never has a guess in it.
 */
async function recentReleases() {
  const list = await get(`https://api.github.com/repos/${REPO}/releases?per_page=20`, "json");
  const recent = [];
  for (const release of list) {
    if (recent.length === RECENT) break;
    const build = Number(/^b-(\d+)$/.exec(release.tag_name)?.[1]);
    if (!build || release.draft || release.prerelease) continue;
    const version = await manifestVersion(release);
    if (!version) continue;
    recent.push({ tag: release.tag_name, build, version, date: dateOf(release), html_url: releaseUrl(release.tag_name), notes: parseNotes(release.body) });
  }
  return recent;
}

export async function fetchRelease() {
  const release = await get(`https://api.github.com/repos/${REPO}/releases/latest`, "json");
  // Builds are tagged b-N and released as 3.0.N; the number is the name people know them by.
  const build = Number(/^b-(\d+)$/.exec(release.tag_name)?.[1]);
  if (!build) throw new Error(`release ${release.tag_name} is not a numbered build`);

  const byName = {};
  let version = null;
  for (const name of MANIFESTS) {
    const asset = release.assets.find((item) => item.name === name);
    if (!asset) continue;
    const manifest = await get(asset.browser_download_url, "text");
    const written = /^version:(.*)$/m.exec(manifest)?.[1];
    version ??= written === undefined ? null : scalar(written);
    Object.assign(byName, hashes(manifest));
  }
  if (!version) throw new Error(`release ${release.tag_name} has no version in its update manifests`);

  const assets = {};
  for (const [key, matches] of Object.entries(ASSETS)) {
    const asset = release.assets.find((item) => matches(item.name));
    if (!asset) throw new Error(`release ${release.tag_name} has no file for ${key}`);

    const base64 = byName[asset.name];

    assets[key] = {
      name: asset.name,
      url: downloadUrl(release.tag_name, asset.name),
      size: asset.size,
      ...(base64 ? { sha512: Buffer.from(base64, "base64").toString("hex") } : {}),
    };
  }

  // Shown beside the source link. Read once here, like the rest, so no visitor asks GitHub.
  const repo = await get(`https://api.github.com/repos/${REPO}`, "json");

  return checkRelease({
    version,
    build,
    tag: release.tag_name,
    date: dateOf(release),
    stars: repo.stargazers_count,
    assets,
    recent: await recentReleases(),
  });
}

/**
 * Refuses release data the page could not print or link safely. The version lands in HTML text and
 * JSON-LD, the tag and build in text, and each file name in a link, so each is checked here.
 */
export function checkRelease(data) {
  if (!/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error(`version "${data.version}" is not x.y.z`);
  const number = /^b-([1-9]\d*)$/.exec(data.tag)?.[1];
  if (!number) throw new Error(`tag "${data.tag}" is not b-N`);
  if (data.build !== Number(number)) throw new Error(`build ${data.build} is not the number in tag ${data.tag}`);
  if (data.date !== undefined && !isDate(data.date)) throw new Error(`date "${data.date}" is not YYYY-MM-DD`);
  if (data.recent !== undefined) {
    if (!Array.isArray(data.recent) || data.recent.length > RECENT) throw new Error(`recent lists at most ${RECENT} builds`);
    for (const entry of data.recent) checkRecent(entry);
  }
  for (const [key, asset] of Object.entries(data.assets ?? {})) {
    if (!/^[\w.-]+$/.test(asset.name)) throw new Error(`${key}: file name "${asset.name}" is not a plain name`);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error(`${key}: size is not a byte count`);
    if (asset.sha512 !== undefined && !/^[0-9a-f]{128}$/.test(asset.sha512)) throw new Error(`${key}: sha512 is not 128 hex digits`);
  }
  return data;
}

/** One line of "Recent releases": the same checks as the release, and a link that is its own release page. */
function checkRecent(entry) {
  const number = /^b-([1-9]\d*)$/.exec(entry?.tag)?.[1];
  if (!number) throw new Error(`recent tag "${entry?.tag}" is not b-N`);
  if (entry.build !== Number(number)) throw new Error(`recent build ${entry.build} is not the number in tag ${entry.tag}`);
  if (!/^\d+\.\d+\.\d+$/.test(entry.version)) throw new Error(`recent version "${entry.version}" is not x.y.z`);
  if (entry.date !== undefined && !isDate(entry.date)) throw new Error(`recent date "${entry.date}" is not YYYY-MM-DD`);
  if (entry.html_url !== releaseUrl(entry.tag)) throw new Error(`recent link for ${entry.tag} is not its release page`);
  for (const part of ["updates", "fixes"]) {
    const list = entry.notes?.[part] ?? [];
    if (!Array.isArray(list) || list.some((line) => typeof line !== "string" || !line)) throw new Error(`recent ${entry.tag}: ${part} is not a list of lines`);
  }
}

/**
 * A warning from the build. Printed locally; in GitHub Actions also as a `::warning::` annotation,
 * which the run shows on its summary page rather than only in the log.
 */
function warn(message) {
  console.warn(`release: ${message}`);
  if (process.env.CI) {
    const escaped = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::warning::release: ${escaped}`);
  }
}

/** Live if GitHub answers, otherwise what release.json remembers. Fails only when it has neither. */
export async function loadRelease() {
  let reason = null;
  if (!process.env.DRAGGY_OFFLINE) {
    try {
      const res = await fetchRelease();
      if (process.env.DRAGGY_STARS !== undefined) res.stars = Number(process.env.DRAGGY_STARS);
      return { ...res, source: "github" };
    } catch (error) {
      reason = error.message;
    }
  }

  if (!existsSync(FILE)) {
    throw new Error(`no release.json to fall back on${reason ? ` (${reason})` : ""}: run \`npm run release\` once with a connection`);
  }
  const data = checkRelease(JSON.parse(readFileSync(FILE, "utf8")));
  if (reason) warn(`${reason}. The site uses release.json (build ${data.build}) instead.`);
  if (process.env.DRAGGY_STARS !== undefined) data.stars = Number(process.env.DRAGGY_STARS);
  return { ...data, source: "release.json" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const release = await fetchRelease();
  writeFileSync(FILE, `${JSON.stringify(release, null, 2)}\n`);
  console.log(`release.json: build ${release.build}, ${Object.keys(release.assets).length} files`);
}
