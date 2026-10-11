const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const ggufParser = require("./ggufParser.cjs");
const imageFamilies = require("./imageFamilies.cjs");
const { log } = require("./logger.cjs");

/** Image models Draggy offers by name. Every file is pinned by hash, and none of the repositories needs an account. */
const IMAGE_MODELS = [
  {
    id: "sd15-q8",
    name: "Stable Diffusion 1.5",
    variant: "Q8_0",
    kind: "single",
    files: [
      {
        role: "model",
        hfRepo: "second-state/stable-diffusion-v1-5-GGUF",
        filename: "stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf",
        sha256: "d0555243938c62faeefb4ac93f6c7a053ad373a4290c5256bce229aeb193bf94",
        size: 1763578176,
      },
    ],
    vramGB: 2.5,
    defaults: { width: 512, height: 512, steps: 20, cfgScale: 7, maxSide: 768 },
    license: "CreativeML OpenRAIL-M",
    licenseUrl: "https://huggingface.co/spaces/CompVis/stable-diffusion-license",
  },
  {
    id: "sd15-q4",
    name: "Stable Diffusion 1.5",
    variant: "Q4_0",
    kind: "single",
    files: [
      {
        role: "model",
        hfRepo: "second-state/stable-diffusion-v1-5-GGUF",
        filename: "stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf",
        sha256: "b8944e9fe0b69b36ae1b5bb0185b3a7b8ef14347fe0fa9af6c64c4829022261f",
        size: 1566768416,
      },
    ],
    vramGB: 2,
    defaults: { width: 512, height: 512, steps: 20, cfgScale: 7, maxSide: 768 },
    license: "CreativeML OpenRAIL-M",
    licenseUrl: "https://huggingface.co/spaces/CompVis/stable-diffusion-license",
  },
  {
    id: "z-image-turbo-q3",
    name: "Z-Image Turbo",
    variant: "Q3_K",
    kind: "bundle",
    files: [
      {
        role: "diffusion",
        hfRepo: "leejet/Z-Image-Turbo-GGUF",
        filename: "z_image_turbo-Q3_K.gguf",
        sha256: "4b44bdaa7814f20d7cf144e3939bd93aa32f50660204dd0c2aea5c5376232980",
        size: 3143559104,
      },
      {
        role: "llm",
        hfRepo: "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        filename: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
        sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
        size: 2497281120,
      },
      {
        role: "vae",
        hfRepo: "Comfy-Org/z_image_turbo",
        repoPath: "split_files/vae/ae.safetensors",
        filename: "z-image-ae.safetensors",
        sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
        size: 335304388,
      },
    ],
    vramGB: 6,
    // Flash attention in the diffusion model is what the upstream guide runs this model with.
    serverArgs: ["--diffusion-fa"],
    defaults: { width: 1024, height: 1024, steps: 8, cfgScale: 1, maxSide: 1024 },
    license: "Apache 2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  },
];

const IMAGE_EXTENSIONS = new Set([".gguf", ".safetensors", ".ckpt", ".sft"]);

/** How sd-server is told which file plays which part. A single-file model is one `-m`. */
const ROLE_FLAGS = {
  model: "-m",
  diffusion: "--diffusion-model",
  vae: "--vae",
  llm: "--llm",
  llm_vision: "--llm_vision",
  clip_l: "--clip_l",
  clip_g: "--clip_g",
  t5xxl: "--t5xxl",
};

/** Kept apart from the chat models, which the chat list and the embedding engine both scan. */
function imageModelsDir(userDataDir) {
  return path.join(userDataDir, "models", "image");
}

function loraDir(userDataDir) {
  return path.join(imageModelsDir(userDataDir), "loras");
}

function isImageFileName(name) {
  return IMAGE_EXTENSIONS.has(path.extname(String(name)).toLowerCase());
}

function catalogueEntry(id) {
  return IMAGE_MODELS.find((entry) => entry.id === id) || null;
}

function fileUrl(file) {
  const inRepo = file.repoPath || file.filename;
  return `https://huggingface.co/${file.hfRepo}/resolve/main/${inRepo}?download=true`;
}

/** Hugging Face says what a repository is for; an image one is downloaded here rather than beside chat models. */
function isImageRepo({ task = "", tags = [] } = {}) {
  const imageTasks = new Set(["text-to-image", "image-to-image", "unconditional-image-generation"]);
  if (imageTasks.has(task)) return true;
  return tags.some((tag) => imageTasks.has(String(tag).toLowerCase()) || /^diffusers(:|$)/i.test(String(tag)));
}

/** A text encoder, not a model to pick. Only a language model records a context length; "qwen_image" fooled a name match. */
function isComponentFile(file) {
  if (path.extname(file).toLowerCase() !== ".gguf") return false;
  try {
    return Boolean(ggufParser.parseGgufHeader(file)?.contextLength);
  } catch (error) {
    log.swallow("files.images", error, "an unreadable header is not a language model");
    return false;
  }
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Bytes of a catalogue file fetched so far: the staged copy waiting for its hash, or the transfer's partial. */
function stagedBytes(dir, file) {
  const staged = path.join(dir, `${file.filename}${UNVERIFIED}`);
  return Math.min(file.size, Math.max(sizeOf(staged), sizeOf(`${staged}.download`)));
}

const FAMILY_FILE = "families.json";

/** Families recorded at download, for a file whose own name does not say what it is. */
function readFamilyMap(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, FAMILY_FILE), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordFamily(dir, filename, familyId) {
  const map = readFamilyMap(dir);
  if (familyId) map[filename] = familyId;
  else delete map[filename];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FAMILY_FILE), JSON.stringify(map, null, 2));
}

function ggufArchitecture(file) {
  if (path.extname(file).toLowerCase() !== ".gguf") return "";
  try {
    return ggufParser.parseGgufHeader(file)?.architecture || "";
  } catch (error) {
    log.swallow("files.images", error, "an unreadable header falls back to the file name");
    return "";
  }
}

/** The family of a file in the image folder: recorded at download, else read from its name and architecture. */
function familyOfFile(dir, name, map = readFamilyMap(dir)) {
  const recorded = imageFamilies.FAMILIES.find((family) => family.id === map[name]);
  return recorded || imageFamilies.familyOf(name, ggufArchitecture(path.join(dir, name)));
}

/** A model file the user downloaded, with the encoders and VAE its family needs beside it. */
function customEntry(dir, name, map) {
  const family = familyOfFile(dir, name, map);
  const parts = imageFamilies.partsOf(family);
  const files = [
    { role: family ? family.main : "model", filename: name, size: sizeOf(path.join(dir, name)), present: true },
    ...parts.map((part) => ({ role: part.role, filename: part.filename, size: part.size, present: sizeOf(path.join(dir, part.filename)) === part.size })),
  ];
  const complete = files.every((file) => file.present);
  return {
    id: `file:${name}`,
    name: name.replace(/\.(gguf|safetensors|ckpt|sft)$/i, ""),
    variant: "",
    kind: parts.length > 0 ? "bundle" : "single",
    family: family ? family.id : null,
    curated: false,
    installed: complete,
    partial: !complete,
    size: files.reduce((sum, file) => sum + file.size, 0),
    vramGB: 0,
    defaults: imageFamilies.defaultsFor(family, name),
    serverArgs: family ? family.serverArgs : [],
    license: "",
    licenseUrl: "",
    files,
  };
}

/** The catalogue with what is on disk, then any other model file the user put in the folder themselves. */
function listImageModels(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => isImageFileName(name));
  } catch (error) {
    if (error?.code !== "ENOENT") log.warn("files.images", "image folder unreadable", { code: error?.code ?? null });
    names = [];
  }
  const present = new Set(names);
  const claimed = new Set([...IMAGE_MODELS.flatMap((entry) => entry.files.map((file) => file.filename)), ...imageFamilies.COMPONENT_FILES]);
  const map = readFamilyMap(dir);

  const catalogue = IMAGE_MODELS.map((entry) => {
    const files = entry.files.map((file) => {
      const isPresent = present.has(file.filename) && sizeOf(path.join(dir, file.filename)) === file.size;
      return { role: file.role, filename: file.filename, size: file.size, present: isPresent, onDisk: isPresent ? file.size : stagedBytes(dir, file) };
    });
    return {
      id: entry.id,
      name: entry.name,
      variant: entry.variant,
      kind: entry.kind,
      curated: true,
      installed: files.every((file) => file.present),
      partial: files.some((file) => file.present || file.onDisk > 0) && !files.every((file) => file.present),
      size: entry.files.reduce((sum, file) => sum + file.size, 0),
      onDiskBytes: files.reduce((sum, file) => sum + file.onDisk, 0),
      vramGB: entry.vramGB,
      defaults: entry.defaults,
      license: entry.license,
      licenseUrl: entry.licenseUrl,
      files,
    };
  });

  const custom = names
    .filter((name) => !claimed.has(name))
    .filter((name) => !isComponentFile(path.join(dir, name)))
    .map((name) => customEntry(dir, name, map));

  return [...catalogue, ...custom];
}

/** A model ready to start: its catalogue entry and each file's full path, or null if anything is missing. */
function resolveImageModel(dir, id) {
  const wanted = String(id || "");
  const entry = catalogueEntry(wanted);
  if (entry) {
    const paths = {};
    for (const file of entry.files) {
      const full = path.join(dir, file.filename);
      if (sizeOf(full) !== file.size) return null;
      paths[file.role] = full;
    }
    return { entry, paths };
  }

  if (wanted.startsWith("file:")) {
    const name = path.basename(wanted.slice(5));
    const full = path.join(dir, name);
    if (!isImageFileName(name) || !fs.existsSync(full)) return null;
    const entry = customEntry(dir, name);
    if (!entry.installed) return null;
    const paths = {};
    for (const file of entry.files) paths[file.role] = path.join(dir, file.filename);
    return { entry, paths };
  }
  return null;
}

/** The command-line arguments that load this model, file roles mapped onto sd-server's flags. */
function modelArgs(resolved) {
  const args = [];
  for (const [role, file] of Object.entries(resolved.paths)) {
    const flag = ROLE_FLAGS[role];
    if (!flag) throw new Error(`Unknown model file role: ${role}`);
    args.push(flag, file);
  }
  return [...args, ...(resolved.entry.serverArgs || [])];
}

/** The model's memory need in GB: the catalogue's figure, or the files' size when it has none. */
function memoryNeedGB(resolved) {
  if (resolved.entry.vramGB) return resolved.entry.vramGB;
  const bytes = Object.values(resolved.paths).reduce((sum, file) => sum + sizeOf(file), 0);
  return Math.max(1, (bytes / 1024 ** 3) * 1.3);
}

async function sha256Of(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

/** The name a file downloads under until its hash is checked; the image folder lists nothing by it. */
const UNVERIFIED = ".unverified";

/** Downloads each file of a catalogue model and gives it its real name only once its hash matches. */
async function installCatalogueModel({ entry, dir, download, onProgress = () => {} }) {
  const total = entry.files.reduce((sum, file) => sum + file.size, 0);
  const timer = log.time("files.images", "install model", { files: entry.files.length, bytes: total });
  let before = 0;
  for (const file of entry.files) {
    const target = path.join(dir, file.filename);
    if (sizeOf(target) !== file.size) {
      const staged = `${file.filename}${UNVERIFIED}`;
      const result = await download(file, staged, (progress) => {
        const completed = before + (progress.completed || 0);
        onProgress({
          status: "model-download",
          completed,
          total,
          percent: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0,
          remainingSeconds: progress.remainingSeconds ?? null,
        });
      });
      if (!result?.success) {
        if (result?.cancelled) timer.end({ status: "cancelled" });
        else timer.fail(null, { status: "download failed" });
        return { success: false, cancelled: Boolean(result?.cancelled) };
      }

      onProgress({ status: "model-verify" });
      const stagedPath = path.join(dir, staged);
      if ((await sha256Of(stagedPath)) !== file.sha256) {
        fs.rmSync(stagedPath, { force: true });
        timer.fail(null, { code: "E_MODEL_HASH" });
        return { success: false, code: "E_MODEL_HASH", error: `${file.filename} did not match its pinned hash` };
      }
      fs.renameSync(stagedPath, target);
    }
    before += file.size;
  }
  onProgress({ status: "model-done" });
  timer.end({ status: "done" });
  return { success: true };
}

/** LoRA files the user has put in the loras folder, by the name a request uses. */
function listLoras(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.(safetensors|gguf|ckpt|pt)$/i.test(name))
      .map((name) => ({ name: name.replace(/\.[^.]+$/, ""), file: name }));
  } catch {
    return [];
  }
}

module.exports = {
  IMAGE_MODELS,
  ROLE_FLAGS,
  imageModelsDir,
  loraDir,
  isImageFileName,
  catalogueEntry,
  fileUrl,
  isImageRepo,
  isComponentFile,
  familyOfFile,
  recordFamily,
  listImageModels,
  resolveImageModel,
  modelArgs,
  memoryNeedGB,
  sha256Of,
  UNVERIFIED,
  installCatalogueModel,
  listLoras,
};
