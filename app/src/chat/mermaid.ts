/** Lazy Mermaid loader. The library is its own chunk and loads on the first diagram only. */

type MermaidApi = typeof import("mermaid").default;

let loading: Promise<MermaidApi> | null = null;
const cache = new Map<string, string>();
let cachedChars = 0;
let counter = 0;
let configured = "";
let queue: Promise<unknown> = Promise.resolve();

const MAX_SOURCE = 50_000;
const MAX_CACHE_CHARS = 8_000_000;
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_AREA = 32_000_000;
const SVG_ROOT = /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/;

const TOKENS = {
  bg: ["--surface-base", "#ffffff"],
  raised: ["--surface-raised", "#f3f4f6"],
  text: ["--text-primary", "#1a1e24"],
  line: ["--text-secondary", "#565b62"],
  accent: ["--accent", "#d55e00"],
} as const;

export function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.body.classList.contains("dark");
}

/** Accepts only hex or rgb(a) colours, so a theme value can never break out of an SVG attribute. */
export function safeColor(value: string, fallback: string): string {
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value) ? value : fallback;
}

function token(name: keyof typeof TOKENS): string {
  const [variable, fallback] = TOKENS[name];
  if (typeof document === "undefined") return fallback;
  const value = safeColor(getComputedStyle(document.body).getPropertyValue(variable).trim(), fallback);
  return value || fallback;
}

export function themeVariables() {
  return {
    background: token("bg"),
    primaryColor: token("raised"),
    primaryTextColor: token("text"),
    primaryBorderColor: token("line"),
    lineColor: token("line"),
    secondaryColor: token("raised"),
    tertiaryColor: token("bg"),
    textColor: token("text"),
    noteBkgColor: token("raised"),
    noteTextColor: token("text"),
    darkMode: isDarkTheme(),
  };
}

function loadMermaid(): Promise<MermaidApi> {
  loading ??= import("mermaid").then((mod) => mod.default);
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export type MermaidResult = { ok: true; svg: string } | { ok: false; error: string };

/** Renders one diagram to SVG text; never throws. Renders run one at a time; results are cached per theme and source.
 * isCancelled is checked when the render reaches the front of the queue, so an unmounted block skips the work. */
export function renderMermaid(source: string, isCancelled: () => boolean = () => false): Promise<MermaidResult> {
  const run = queue.then(() => renderOne(source, isCancelled));
  queue = run;
  return run;
}

export function cachedKeys(): string[] {
  return [...cache.keys()];
}

/** Keeps at most 30 diagrams and about 8M characters of SVG, evicting the oldest first. */
export function remember(key: string, svg: string): void {
  while (cache.size > 0 && (cache.size >= 30 || cachedChars + svg.length > MAX_CACHE_CHARS)) {
    const oldest = cache.keys().next().value as string;
    cachedChars -= cache.get(oldest)?.length ?? 0;
    cache.delete(oldest);
  }
  cache.set(key, svg);
  cachedChars += svg.length;
}

/** Mermaid leaves its temp render node in body when a render fails. */
export function removeStrayNodes(id: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(`d${id}`)?.remove();
  document.getElementById(id)?.remove();
}

/** Scale for a PNG of this size: 2x, capped by side length and total pixel area. */
export function canvasScale(width: number, height: number): number {
  const side = Math.max(width, height, 1);
  const area = Math.max(width * height, 1);
  return Math.min(2, MAX_CANVAS_SIDE / side, Math.sqrt(MAX_CANVAS_AREA / area));
}

/** Data URL that loads the SVG as an image, so its markup never runs in the page. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${svgBase64(svg)}`;
}

/** Gives each returned copy its own SVG id, so the same diagram shown twice keeps its #id styles apart. */
function uniqueId(svg: string): string {
  const next = `draggy-mermaid-${++counter}`;
  return svg.replace(/draggy-mermaid-\d+/g, next);
}

async function renderOne(source: string, isCancelled: () => boolean): Promise<MermaidResult> {
  if (isCancelled()) return { ok: false, error: "Render cancelled" };
  const vars = themeVariables();
  const theme = Object.values(vars).join("|");
  const key = `${theme}\n${source}`;
  const hit = cache.get(key);
  if (hit) return { ok: true, svg: uniqueId(hit) };
  const id = `draggy-mermaid-${++counter}`;
  try {
    if (source.length > MAX_SOURCE) throw new Error("Diagram is too large");
    const mermaid = await loadMermaid();
    if (configured !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: vars,
        flowchart: { htmlLabels: false },
        htmlLabels: false,
        suppressErrorRendering: true,
        maxTextSize: MAX_SOURCE,
        maxEdges: 500,
      } as Parameters<MermaidApi["initialize"]>[0]);
      configured = theme;
    }
    await mermaid.parse(source);
    const { svg } = await mermaid.render(id, source);
    if (!SVG_ROOT.test(svg)) throw new Error("Diagram contains unsafe markup");
    remember(key, svg);
    return { ok: true, svg: uniqueId(svg) };
  } catch (error) {
    removeStrayNodes(id);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.split("\n").find((line) => line.trim()) ?? "Invalid diagram" };
  }
}

/** Reads the SVG's size from its viewBox, falling back to width and height. */
export function svgSize(svg: string): { width: number; height: number } {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (box) return { width: Number(box[1]), height: Number(box[2]) };
  const w = /width="([\d.]+)/.exec(svg);
  const h = /height="([\d.]+)/.exec(svg);
  return { width: Number(w?.[1] ?? 800), height: Number(h?.[1] ?? 600) };
}

/** Adds a background rect under the diagram so a saved SVG matches the current theme. */
export function svgWithBackground(svg: string): string {
  const { width, height } = svgSize(svg);
  const box = /viewBox="([-\d.]+) ([-\d.]+) /.exec(svg);
  const rect = `<rect x="${box?.[1] ?? 0}" y="${box?.[2] ?? 0}" width="${width}" height="${height}" fill="${token("bg")}"/>`;
  return svg.replace(/<svg\b[^>]*>/, (open) => `${open}${rect}`);
}

export function svgBase64(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Rasterises the SVG to a PNG data URL at 2x. */
export function svgToPng(svg: string): Promise<string> {
  const { width, height } = svgSize(svg);
  const sized = svg.replace(/<svg /, `<svg width="${width}" height="${height}" `).replace(/(<svg [^>]*?)width="100%"/, "$1");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = canvasScale(width, height);
      if (scale < 0.5) return reject(new Error("too large, save SVG"));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.fillStyle = token("bg");
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/png");
      if (!url.startsWith("data:image/png")) return reject(new Error("render failed"));
      resolve(url);
    };
    img.onerror = () => reject(new Error("render failed"));
    img.src = `data:image/svg+xml;base64,${svgBase64(sized)}`;
  });
}
