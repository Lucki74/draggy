import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const imageModels = require("./imageModels.cjs");
const modelStorage = require("./modelStorage.cjs");
const embedServer = require("./embedServer.cjs");
const urlPolicy = require("./urlPolicy.cjs");

/** A minimal GGUF header naming an architecture, with the context length only a language model records. */
function ggufWithArchitecture(arch, contextLength = 0) {
  const parts = [];
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const str = (s) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
  parts.push(Buffer.from("GGUF"), u32(3), u64(0), u64(contextLength ? 2 : 1), str("general.architecture"), u32(8), str(arch));
  if (contextLength) parts.push(str(`${arch}.context_length`), u32(4), u32(contextLength));
  return Buffer.concat(parts);
}

let userData;
let dir;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-img-"));
  dir = imageModels.imageModelsDir(userData);
  fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("the curated image models", () => {
  it("pins every file by hash and size, from a repository that needs no account", () => {
    for (const entry of imageModels.IMAGE_MODELS) {
      expect(entry.license, entry.id).toBeTruthy();
      expect(entry.files.length).toBeGreaterThan(0);
      for (const file of entry.files) {
        expect(file.sha256, file.filename).toMatch(/^[0-9a-f]{64}$/);
        expect(file.size).toBeGreaterThan(0);
        expect(urlPolicy.isFetchableUrl(imageModels.fileUrl(file), { allowPrivate: false })).toBe(true);
      }
    }
  });

  it("never offers a bf16 file, which draws black images", () => {
    const names = imageModels.IMAGE_MODELS.flatMap((entry) => entry.files.map((file) => file.filename));
    expect(names.some((name) => /bf16/i.test(name))).toBe(false);
  });

  it("gives a bundle's files distinct names, so two parts never overwrite each other", () => {
    const names = imageModels.IMAGE_MODELS.flatMap((entry) => entry.files.map((file) => file.filename));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("where image models live", () => {
  it("keeps them out of the chat list and the embedding engine", () => {
    fs.writeFileSync(path.join(dir, "stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf"), "x");
    const modelsDir = path.join(userData, "models");

    expect(modelStorage.listGgufModels(modelsDir).map((entry) => entry.filename)).toEqual([]);
    expect(embedServer.resolveModelFile(modelsDir, "stable-diffusion")).toBeNull();
  });
});

describe("listing what is installed", () => {
  it("marks a curated model installed only when every file is there at its full size", () => {
    const sd = imageModels.IMAGE_MODELS.find((entry) => entry.id === "sd15-q8");
    const file = path.join(dir, sd.files[0].filename);
    fs.writeFileSync(file, "partial");

    let listed = imageModels.listImageModels(dir).find((entry) => entry.id === "sd15-q8");
    expect(listed.installed).toBe(false);

    fs.truncateSync(file, sd.files[0].size);
    listed = imageModels.listImageModels(dir).find((entry) => entry.id === "sd15-q8");
    expect(listed.installed).toBe(true);
    expect(imageModels.resolveImageModel(dir, "sd15-q8").paths.model).toBe(file);
  });

  it("reports the bytes of a download in progress, from its staged or partial file", () => {
    const sd = imageModels.IMAGE_MODELS.find((entry) => entry.id === "sd15-q8");
    const name = sd.files[0].filename;
    fs.writeFileSync(path.join(dir, `${name}${imageModels.UNVERIFIED}.download`), Buffer.alloc(1234));

    let listed = imageModels.listImageModels(dir).find((entry) => entry.id === "sd15-q8");
    expect(listed.installed).toBe(false);
    expect(listed.partial).toBe(true);
    expect(listed.onDiskBytes).toBe(1234);

    fs.writeFileSync(path.join(dir, name), "");
    fs.truncateSync(path.join(dir, name), sd.files[0].size);
    listed = imageModels.listImageModels(dir).find((entry) => entry.id === "sd15-q8");
    expect(listed.onDiskBytes).toBeGreaterThanOrEqual(sd.files[0].size);
  });

  it("lists a model file the user added themselves, safetensors and ckpt too", () => {
    fs.writeFileSync(path.join(dir, "my-style.safetensors"), "x");
    fs.writeFileSync(path.join(dir, "old.ckpt"), "x");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const custom = imageModels.listImageModels(dir).filter((entry) => !entry.curated).map((entry) => entry.id).sort();
    expect(custom).toEqual(["file:my-style.safetensors", "file:old.ckpt"]);
  });

  it("does not offer a language model GGUF in the image folder as an image model", () => {
    fs.writeFileSync(path.join(dir, "some-text-encoder.gguf"), ggufWithArchitecture("qwen3", 32768));
    fs.writeFileSync(path.join(dir, "converted-sd.gguf"), ggufWithArchitecture("unknown-diffusion"));
    const custom = imageModels.listImageModels(dir).filter((entry) => !entry.curated).map((entry) => entry.id);
    expect(custom).toEqual(["file:converted-sd.gguf"]);
  });

  it("offers Qwen-Image, whose architecture name looks like a language model's", () => {
    fs.writeFileSync(path.join(dir, "qwen-image-Q4_K_M.gguf"), ggufWithArchitecture("qwen_image"));
    const custom = imageModels.listImageModels(dir).filter((entry) => !entry.curated).map((entry) => entry.id);
    expect(custom).toEqual(["file:qwen-image-Q4_K_M.gguf"]);
  });

  it("resolves nothing for a path that tries to leave the folder", () => {
    expect(imageModels.resolveImageModel(dir, "file:../../secret.gguf")).toBeNull();
  });
});

describe("installing a curated model", () => {
  const entry = {
    id: "tiny",
    files: [{ role: "model", filename: "tiny.gguf", size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }],
  };
  const writer = (bytes) => async (_file, name) => {
    fs.writeFileSync(path.join(dir, name), bytes);
    return { success: true };
  };

  it("never shows a file under its real name before its hash is checked", async () => {
    const seen = [];
    const result = await imageModels.installCatalogueModel({
      entry,
      dir,
      download: async (file, name) => {
        await writer("hello")(file, name);
        seen.push(fs.existsSync(path.join(dir, "tiny.gguf")), imageModels.listImageModels(dir).some((one) => one.id === "file:tiny.gguf.unverified"));
        return { success: true };
      },
    });
    expect(result).toEqual({ success: true });
    expect(seen).toEqual([false, false]);
    expect(fs.readFileSync(path.join(dir, "tiny.gguf"), "utf8")).toBe("hello");
  });

  it("deletes a file whose hash does not match and never gives it the real name", async () => {
    const result = await imageModels.installCatalogueModel({ entry, dir, download: writer("world") });
    expect(result.code).toBe("E_MODEL_HASH");
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("starting a model", () => {
  it("loads a single-file model with -m", () => {
    const resolved = { entry: { id: "x" }, paths: { model: "/m/x.gguf" } };
    expect(imageModels.modelArgs(resolved)).toEqual(["-m", "/m/x.gguf"]);
  });

  it("maps a bundle's roles onto sd-server's flags, with its extra arguments after", () => {
    const entry = imageModels.catalogueEntry("z-image-turbo-q3");
    const resolved = { entry, paths: { diffusion: "/d.gguf", llm: "/q.gguf", vae: "/ae.safetensors" } };
    expect(imageModels.modelArgs(resolved)).toEqual([
      "--diffusion-model", "/d.gguf",
      "--llm", "/q.gguf",
      "--vae", "/ae.safetensors",
      "--diffusion-fa",
    ]);
  });

  it("refuses a role it has no flag for", () => {
    expect(() => imageModels.modelArgs({ entry: {}, paths: { mystery: "/x" } })).toThrow();
  });
});

describe("telling image repositories apart", () => {
  it("reads the task and the diffusers tag", () => {
    expect(imageModels.isImageRepo({ task: "text-to-image" })).toBe(true);
    expect(imageModels.isImageRepo({ tags: ["gguf", "diffusers:StableDiffusionPipeline"] })).toBe(true);
    expect(imageModels.isImageRepo({ task: "text-generation", tags: ["gguf"] })).toBe(false);
  });
});
