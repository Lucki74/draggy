const path = require("node:path");
const { log } = require("./logger.cjs");

/** What the renderer may ask of the image engine, checked in the main process. No field may carry a path of its own choosing. */

const MAX_PROMPT = 4000;
const OUTPUT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_INIT_IMAGE_CHARS = 30 * 1024 * 1024;

function number(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

/** A file name from a prompt: plain words, short, never empty. */
function slugFor(prompt) {
  const words = String(prompt || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 40) break;
    slug = next;
  }
  return slug || "image";
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** The name an image gets in the output folder, made unique against what is already there. */
function outputName(prompt, exists = () => false, date = new Date()) {
  const base = `${stamp(date)}-${slugFor(prompt)}`;
  let name = `${base}.png`;
  for (let n = 2; exists(name); n++) name = `${base}-${n}.png`;
  return name;
}

/** "style:0.8" or "style" into a LoRA entry. Names only: the folder they are found in is Draggy's to choose. */
function parseLora(value) {
  const match = /^([A-Za-z0-9 _.-]{1,80}?)(?::(-?\d+(?:\.\d+)?))?$/.exec(String(value || "").trim());
  if (!match || match[1].includes("..")) return null;
  const weight = match[2] === undefined ? 1 : Number(match[2]);
  return { name: match[1].trim(), multiplier: Math.min(2, Math.max(-2, weight)) };
}

/** Checks a request and returns the clean version, or the reason it was refused. */
function checkImageRequest(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const requestId = String(input.requestId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) return { ok: false, reason: "no-request-id", error: "A request needs an id" };

  const prompt = String(input.prompt || "").trim();
  if (!prompt) return { ok: false, reason: "no-prompt", error: "An image needs a description" };
  if (prompt.length > MAX_PROMPT) return { ok: false, reason: "prompt-too-long", error: `The description is longer than ${MAX_PROMPT} characters` };

  const request = {
    requestId,
    prompt,
    negativePrompt: String(input.negativePrompt || "").slice(0, MAX_PROMPT),
    width: number(input.width, 64, 2048),
    height: number(input.height, 64, 2048),
    steps: number(input.steps, 1, 150),
    cfgScale: number(input.cfgScale, 0, 30),
    seed: Number.isInteger(Number(input.seed)) && Number(input.seed) >= 0 ? Number(input.seed) : -1,
    strength: number(input.strength, 0, 1),
    hires: Boolean(input.hires),
    fitModel: Boolean(input.fitModel),
    model: typeof input.model === "string" ? input.model.slice(0, 300) : "",
    lora: [],
    init: null,
    destination: { kind: "chat" },
  };

  for (const entry of Array.isArray(input.lora) ? input.lora.slice(0, 4) : []) {
    const lora = parseLora(entry);
    if (!lora) return { ok: false, reason: "bad-lora", error: `Not a LoRA name: ${String(entry).slice(0, 80)}` };
    request.lora.push(lora);
  }

  const init = input.init;
  if (init && typeof init === "object") {
    if (init.kind === "attachment") {
      const url = String(init.dataUrl || "");
      if (!/^data:image\/(png|jpe?g|webp|bmp|gif);base64,/i.test(url) || url.length > MAX_INIT_IMAGE_CHARS) {
        return { ok: false, reason: "bad-init-image", error: "The starting image is not a usable picture" };
      }
      request.init = { kind: "attachment", dataUrl: url };
    } else if (init.kind === "project") {
      const target = String(init.path || "").trim();
      if (!target) return { ok: false, reason: "init-path-missing", error: "The starting image needs a path" };
      request.init = { kind: "project", workspaceId: String(init.workspaceId || "default"), path: target, optional: Boolean(init.optional) };
    } else if (init.kind === "created") {
      const target = String(init.path || "").trim();
      if (!target) return { ok: false, reason: "init-path-missing", error: "The starting image needs a path" };
      // A picture from the output folder; when it has gone the job draws from the text alone.
      request.init = { kind: "created", path: target, optional: true };
    } else {
      return { ok: false, reason: "unknown-init", error: "Unknown starting image" };
    }
  }

  const destination = input.destination;
  if (destination && destination.kind === "project") {
    const target = String(destination.path || "").trim();
    if (!target) return { ok: false, reason: "dest-path-missing", error: "Saving into a project needs a path" };
    if (!OUTPUT_EXTENSIONS.has(path.extname(target).toLowerCase())) {
      return { ok: false, reason: "bad-extension", error: "An image can only be saved as .png, .jpg or .webp" };
    }
    request.destination = {
      kind: "project",
      workspaceId: String(destination.workspaceId || "default"),
      path: target,
      chatId: destination.chatId ? String(destination.chatId) : undefined,
      overwrite: Boolean(destination.overwrite),
    };
  }

  return { ok: true, request };
}

/** Logs the outcome by id, lengths and counts only: never the prompt, the paths or the refusal text. */
function validateImageRequest(raw) {
  const result = checkImageRequest(raw);
  if (!result.ok) {
    log.debug("ipc", "image request refused", { reason: result.reason });
    return result;
  }
  const { request } = result;
  log.debug("ipc", "image request accepted", {
    requestId: request.requestId,
    promptChars: request.prompt.length,
    width: request.width ?? null,
    height: request.height ?? null,
    steps: request.steps ?? null,
    cfgScale: request.cfgScale ?? null,
    seed: request.seed,
    lora: request.lora.length,
    init: request.init?.kind ?? "none",
    destination: request.destination.kind,
  });
  return result;
}

module.exports = {
  MAX_PROMPT,
  OUTPUT_EXTENSIONS,
  slugFor,
  outputName,
  parseLora,
  validateImageRequest,
};
