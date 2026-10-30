import { afterEach, beforeEach, describe, expect, it } from "vitest";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const imageFamilies = require("./imageFamilies.cjs");
const imageModels = require("./imageModels.cjs");

/** Real repository and file names from Hugging Face, each with the family stable-diffusion.cpp needs it loaded as. */
const NAMED = [
  ["QuantStack/Qwen-Image-GGUF", "Qwen_Image-Q4_K_M.gguf", "qwen-image"],
  ["unsloth/Qwen-Image-2512-GGUF", "qwen-image-2512-Q4_K_M.gguf", "qwen-image"],
  ["QuantStack/Qwen-Image-Edit-2509-GGUF", "Qwen-Image-Edit-2509-Q4_K_M.gguf", "qwen-image-edit"],
  ["leejet/Qwen-Image-2.1-GGUF", "qwen_image_2.1-Q4_K.gguf", "qwen-image-2.1"],
  ["KasugaiSakura/Qwen-Image-2.1-Uncensored-Abenzerps", "abenzerps-Q4_K_M.gguf", "qwen-image-2.1"],
  ["leejet/Z-Image-Turbo-GGUF", "z_image_turbo-Q4_K.gguf", "z-image"],
  ["leejet/FLUX.1-schnell-gguf", "flux1-schnell-q4_k.gguf", "flux"],
  ["QuantStack/FLUX.1-Kontext-dev-GGUF", "flux1-kontext-dev-Q4_K_M.gguf", "flux"],
  ["leejet/FLUX.2-klein-4B-GGUF", "flux-2-klein-4b-Q4_K.gguf", "flux2-klein-4b"],
  ["leejet/FLUX.2-klein-9B-GGUF", "flux-2-klein-9b-Q4_K.gguf", "flux2-klein-9b"],
  ["city96/FLUX.2-dev-gguf", "flux2-dev-Q4_K_M.gguf", "flux2-dev"],
  ["silveroxides/Chroma-GGUF", "chroma-unlocked-v40-Q4_K_M.gguf", "chroma"],
  ["silveroxides/Chroma1-Radiance-GGUF", "Chroma1-Radiance-Q4_K_M.gguf", "chroma-radiance"],
  ["city96/stable-diffusion-3.5-large-gguf", "sd3.5_large-Q4_0.gguf", "sd3"],
  ["vantagewithai/LongCat-Image-GGUF", "LongCat-Image-Q4_K_M.gguf", "longcat-image"],
  ["leejet/Ovis-Image-7B-GGUF", "ovis_image-Q4_0.gguf", "ovis-image"],
  ["Bedovyy/Anima-GGUF", "anima-preview-Q8_0.gguf", "anima"],
  ["unsloth/ERNIE-Image-Turbo-GGUF", "ernie-image-turbo-Q4_K_M.gguf", "ernie-image"],
  ["realrebelai/KREA-2_GGUFs", "Krea-2-Raw-Q8_0.gguf", "krea-2"],
];

describe("which family a model is", () => {
  for (const [repo, file, family] of NAMED) {
    it(`loads ${repo} as ${family}`, () => {
      expect(imageFamilies.familyOf(repo, file)?.id).toBe(family);
    });
  }

  it("loads Stable Diffusion checkpoints alone, including SD3 with its encoders built in", () => {
    expect(imageFamilies.familyOf("second-state/stable-diffusion-v1-5-GGUF", "v1-5-pruned-emaonly-Q8_0.gguf")).toBeNull();
    expect(imageFamilies.familyOf("gpustack/stable-diffusion-xl-base-1.0-GGUF", "sd_xl_base_1.0-Q4_0.gguf")).toBeNull();
    expect(imageFamilies.familyOf("someone/Animagine-XL-4.0-GGUF", "animagine-xl-4.0-Q8_0.gguf")).toBeNull();
    expect(imageFamilies.familyOf("x/sd3", "sd3_medium_incl_clips_t5xxlfp16.gguf")).toBeNull();
  });

  it("draws an SDXL checkpoint at the size it was trained on", () => {
    expect(imageFamilies.defaultsFor(null, "animagine-xl-4.0-Q8_0.gguf").width).toBe(1024);
    expect(imageFamilies.defaultsFor(null, "v1-5-pruned-emaonly-Q8_0.gguf").width).toBe(512);
    expect(imageFamilies.defaultsFor(imageFamilies.familyOf("z_image_turbo"), "z_image_turbo").steps).toBe(8);
  });

  it("pins every component it would download", () => {
    for (const family of imageFamilies.FAMILIES) {
      for (const part of imageFamilies.partsOf(family)) {
        expect(part.sha256, `${family.id} ${part.role}`).toMatch(/^[0-9a-f]{64}$/);
        expect(part.size).toBeGreaterThan(0);
        expect(imageModels.ROLE_FLAGS[part.role], part.role).toBeTruthy();
      }
    }
  });
});

describe("a family model in the image folder", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-family-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const place = (component) => {
    const file = path.join(dir, component.filename);
    fs.writeFileSync(file, "");
    fs.truncateSync(file, component.size);
  };

  it("is not offered until its encoder and VAE are there, then loads with all of them", () => {
    fs.writeFileSync(path.join(dir, "Qwen_Image-Q4_K_M.gguf"), "weights");
    const listed = () => imageModels.listImageModels(dir).find((entry) => entry.id === "file:Qwen_Image-Q4_K_M.gguf");
    expect(listed().installed).toBe(false);
    expect(imageModels.resolveImageModel(dir, "file:Qwen_Image-Q4_K_M.gguf")).toBeNull();

    place(imageFamilies.COMPONENTS["qwen2.5-vl-7b"]);
    place(imageFamilies.COMPONENTS["qwen-image-vae"]);
    expect(listed().installed).toBe(true);
    // The encoder and VAE are parts of it, never models of their own.
    expect(imageModels.listImageModels(dir).filter((entry) => !entry.curated)).toHaveLength(1);

    const args = imageModels.modelArgs(imageModels.resolveImageModel(dir, "file:Qwen_Image-Q4_K_M.gguf"));
    expect(args).toContain("--diffusion-model");
    expect(args).not.toContain("-m");
    expect(args[args.indexOf("--llm") + 1]).toMatch(/Qwen2\.5-VL-7B/);
    expect(args[args.indexOf("--vae") + 1]).toMatch(/qwen_image_vae/);
  });

  it("remembers the family of a file whose name does not say it", () => {
    fs.writeFileSync(path.join(dir, "abenzerps-Q4_K_M.gguf"), "weights");
    expect(imageModels.familyOfFile(dir, "abenzerps-Q4_K_M.gguf")).toBeNull();
    imageModels.recordFamily(dir, "abenzerps-Q4_K_M.gguf", "qwen-image-2.1");
    expect(imageModels.familyOfFile(dir, "abenzerps-Q4_K_M.gguf")?.id).toBe("qwen-image-2.1");
  });

  it("still loads a Stable Diffusion file on its own with -m", () => {
    fs.writeFileSync(path.join(dir, "v1-5-pruned-emaonly-Q8_0.gguf"), "weights");
    const resolved = imageModels.resolveImageModel(dir, "file:v1-5-pruned-emaonly-Q8_0.gguf");
    expect(imageModels.modelArgs(resolved).slice(0, 1)).toEqual(["-m"]);
  });
});

describe("every family", () => {
  const { FAMILIES, COMPONENTS, partsOf, familyOf, referenceModeOf } = require("./imageFamilies.cjs");

  it("names components that exist, with a hash and a size", () => {
    for (const family of FAMILIES) {
      for (const part of partsOf(family)) {
        expect(COMPONENTS[part.id], `${family.id} part ${part.role}`).toBeTruthy();
        expect(part.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(part.size).toBeGreaterThan(0);
      }
      expect(family.defaults.width).toBeGreaterThan(0);
    }
  });

  it("routes real file names to their family", () => {
    expect(familyOf("unsloth/Qwen-Image-2.1-GGUF", "qwen-image-2.1-Q4_K_M.gguf").id).toBe("qwen-image-2.1");
    expect(familyOf("Qwen-Image-Edit-2509-Q4_K_M.gguf").id).toBe("qwen-image-edit");
    expect(familyOf("flux1-dev-Q4_0.gguf").id).toBe("flux");
  });

  it("edits by reference only where the family takes reference images", () => {
    expect(referenceModeOf(familyOf("qwen-image-edit-Q4.gguf"))).toBe("edit");
    expect(referenceModeOf(familyOf("flux2-klein-4b.gguf"))).toBe("edit");
    expect(referenceModeOf(familyOf("flux1-kontext-dev.gguf"), "flux1-kontext-dev.gguf")).toBe("edit");
    expect(referenceModeOf(familyOf("qwen-image-2.1-Q4_K_M.gguf"))).toBe("img2img");
    expect(referenceModeOf(null, "sd-turbo.gguf")).toBe("img2img");
  });
});
