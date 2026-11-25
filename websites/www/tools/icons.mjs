/**
 * Builds assets/img/icons.svg from @phosphor-icons/core, so the site and the
 * interface it advertises are drawn from the app's own Phosphor icon set.
 *
 *   npm run icons
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const phosphorDir = join(root, "node_modules", "@phosphor-icons", "core", "assets", "regular");

/** Phosphor icon names used across the site. */
const phosphorIcons = [
  "arrow-counter-clockwise",
  "arrow-right",
  "arrow-down",
  "book-open",
  "books",
  "caret-down",
  "chat-circle",
  "check",
  "check-circle",
  "circle-half",
  "cloud",
  "code",
  "copy",
  "cpu",
  "download-simple",
  "file-text",
  "folder-open",
  "folder-simple",
  "gear-six",
  "git-branch",
  "git-diff",
  "github-logo",
  "globe-simple",
  "hard-drive",
  "image",
  "key",
  "lightning",
  "lock-simple",
  "magnifying-glass",
  "microphone",
  "moon",
  "package",
  "pause",
  "arrows-out",
  "play",
  "plug",
  "puzzle-piece",
  "scales",
  "shield-check",
  "sidebar-simple",
  "sign-in",
  "sparkle",
  "star",
  "sun",
  "terminal",
  "terminal-window",
  "translate",
  "user-minus",
  "warning",
  "waveform",
  "x",
];

/** Aliases for templates referencing generic or previous names. */
const aliases = {
  "arrow-right": "arrow-right",
  "audio-lines": "waveform",
  "blocks": "puzzle-piece",
  "book-open": "book-open",
  "check": "check",
  "chevron-down": "caret-down",
  "circle-check": "check-circle",
  "cloud": "cloud",
  "copy": "copy",
  "cpu": "cpu",
  "download": "download-simple",
  "file-text": "file-text",
  "folder-open": "folder-open",
  "folder-search": "magnifying-glass",
  "git-branch": "git-branch",
  "globe": "globe-simple",
  "hard-drive": "hard-drive",
  "key-round": "key",
  "languages": "translate",
  "lock": "lock-simple",
  "log-in": "sign-in",
  "message-square": "chat-circle",
  "mic": "microphone",
  "moon": "moon",
  "package": "package",
  "plug": "plug",
  "rotate-ccw": "arrow-counter-clockwise",
  "scale": "scales",
  "search": "magnifying-glass",
  "settings": "gear-six",
  "shield-check": "shield-check",
  "star": "star",
  "sun": "sun",
  "terminal": "terminal",
  "undo-2": "arrow-counter-clockwise",
  "user-round-x": "user-minus",
  "wrench": "gear-six",
  "zap": "lightning",
};

/**
 * Platform brand marks for the download options.
 */
const solid = (rule, subpaths) =>
  `<path fill="currentColor" stroke="none"${rule ? ` fill-rule="${rule}"` : ""}` +
  ` d="${subpaths.join(" ")}"/>`;

const platforms = {
  "kofi": solid(null, [
    "M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298",
  ]),
  "os-windows": solid(null, [
    "M3 5.7 10.4 4.5v7.1H3z",
    "M11.5 4.3 21 3v8.6h-9.5z",
    "M3 12.7h7.4v7.1L3 18.6z",
    "M11.5 12.7H21V21l-9.5-1.3z",
  ]),
  "os-macos": solid(null, [
    "M16.1 12.5c0-2.4 1.9-3.5 2-3.6",
    "-1.1-1.6-2.8-1.8-3.4-1.9-1.5-.1-2.8.8-3.5.8s-1.8-.8-3-.8",
    "c-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3",
    "1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7",
    "-.1 0-2.5-1-2.5-3.4z",
    "M13.7 5.5c.6-.8 1.1-1.9 1-3-.9.1-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9",
    "1 .1 2.1-.5 2.8-1.3z",
  ]),
  "os-linux": solid("evenodd", [
    "M12 1.6",
    "c-2.5 0-4.4 2-4.4 4.5 v1.9 c0 .9-.35 1.6-.95 2.3",
    "C5.1 12 4.2 13.9 3.9 15.9",
    "c-.2 1.25-.7 2.3-1.45 3.2 -.55.65-.2 1.65.65 1.8",
    "1.35.25 2.5-.25 3.35-1.1 .2-.2.55-.05.55.25",
    ".1.95.9 1.7 1.85 1.7 h6.2 c.95 0 1.75-.75 1.85-1.7",
    "0-.3.35-.45.55-.25 .85.85 2 1.35 3.35 1.1",
    ".85-.15 1.2-1.15.65-1.8 -.75-.9-1.25-1.95-1.45-3.2",
    "-.3-2-1.2-3.9-2.75-5.6 -.6-.7-.95-1.4-.95-2.3",
    "V6.1 c0-2.5-1.9-4.5-4.4-4.5 z",
    "M12 7.6",
    "c-2.1 0-3.3 1.2-3.6 2.6 -.4 1.9-1.6 3.4-1.6 6.2",
    "0 2.9 2.1 4.6 5.2 4.6 s5.2-1.7 5.2-4.6",
    "c0-2.8-1.2-4.3-1.6-6.2 -.3-1.4-1.5-2.6-3.6-2.6 z",
    "M10 9.4a2 1.25 0 1 1 4 0a2 1.25 0 1 1-4 0z",
    "M8.9 5.6a1.4 1.6 0 1 1 2.8 0a1.4 1.6 0 1 1-2.8 0z",
    "M12.3 5.6a1.4 1.6 0 1 1 2.8 0a1.4 1.6 0 1 1-2.8 0z",
    "M9.98 5.8a.62 .62 0 1 1 1.24 0a.62 .62 0 1 1-1.24 0z",
    "M12.78 5.8a.62 .62 0 1 1 1.24 0a.62 .62 0 1 1-1.24 0z",
  ]),
};

const iconBodies = new Map();

for (const name of phosphorIcons) {
  const filePath = join(phosphorDir, `${name}.svg`);
  const content = readFileSync(filePath, "utf8");
  const inner = content.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").trim();
  iconBodies.set(name, inner);
}

const symbols = [];

// Write canonical Phosphor symbols
for (const [name, body] of iconBodies.entries()) {
  symbols.push(`<symbol id="i-${name}" viewBox="0 0 256 256" fill="currentColor">${body}</symbol>`);
}

// Write aliases
for (const [aliasName, target] of Object.entries(aliases)) {
  if (aliasName === target) continue;
  const body = iconBodies.get(target);
  if (body) {
    symbols.push(`<symbol id="i-${aliasName}" viewBox="0 0 256 256" fill="currentColor">${body}</symbol>`);
  }
}

// Write platform symbols
for (const [name, body] of Object.entries(platforms)) {
  symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`);
}

const sprite = [
  `<svg xmlns="http://www.w3.org/2000/svg">`,
  symbols.join(""),
  `</svg>`,
].join("");

writeFileSync(join(root, "assets", "img", "icons.svg"), sprite);

const hidden = sprite.replace("<svg ", '<svg aria-hidden="true" style="display:none" ');
writeFileSync(join(root, "tools", "pages", "_icons.html"), `${hidden}\n`);

console.log(`icons.svg: ${symbols.length} Phosphor symbols written.`);
