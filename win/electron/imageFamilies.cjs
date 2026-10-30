const { log } = require("./logger.cjs");

/** What each image model family needs beside its own weights, from stable-diffusion.cpp's docs at the pinned release. */

/** Text encoders and VAEs, each pinned by hash and shared by every family that uses it. None needs an account. */
const COMPONENTS = {
  "flux-vae": { hfRepo: "Comfy-Org/z_image_turbo", repoPath: "split_files/vae/ae.safetensors", filename: "z-image-ae.safetensors", sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38", size: 335304388 },
  "flux2-vae": { hfRepo: "Comfy-Org/flux2-dev", repoPath: "split_files/vae/flux2-vae.safetensors", filename: "flux2-vae.safetensors", sha256: "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5", size: 336213556 },
  "qwen-image-vae": { hfRepo: "Comfy-Org/Qwen-Image_ComfyUI", repoPath: "split_files/vae/qwen_image_vae.safetensors", filename: "qwen_image_vae.safetensors", sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f", size: 253806246 },
  "qwen-image-2.1-vae": { hfRepo: "Comfy-Org/Qwen-Image-2.1", repoPath: "vae/qwen_image_2.1_vae_bf16.safetensors", filename: "qwen_image_2.1_vae_bf16.safetensors", sha256: "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9", size: 675509688 },
  "wan-2.1-vae": { hfRepo: "Comfy-Org/Wan_2.1_ComfyUI_repackaged", repoPath: "split_files/vae/wan_2.1_vae.safetensors", filename: "wan_2.1_vae.safetensors", sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b", size: 253815318 },
  "clip-l": { hfRepo: "comfyanonymous/flux_text_encoders", filename: "clip_l.safetensors", sha256: "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd", size: 246144152 },
  "clip-g": { hfRepo: "Comfy-Org/stable-diffusion-3.5-fp8", repoPath: "text_encoders/clip_g.safetensors", filename: "clip_g.safetensors", sha256: "ec310df2af79c318e24d20511b601a591ca8cd4f1fce1d8dff822a356bcdb1f4", size: 1389382176 },
  t5xxl: { hfRepo: "comfyanonymous/flux_text_encoders", filename: "t5xxl_fp8_e4m3fn.safetensors", sha256: "7d330da4816157540d6bb7838bf63a0f02f573fc48ca4d8de34bb0cbfd514f09", size: 4893934904 },
  "qwen2.5-vl-7b": { hfRepo: "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF", filename: "Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf", sha256: "0f00a930ba3108b6861ddadf74d8ebbd82e257c63eba728e62c3e8970f5eed94", size: 4683072512 },
  "qwen2.5-vl-7b-vision": { hfRepo: "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF", filename: "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf", sha256: "2185ca0adf339f96845318c7b666f5d242f86bbace5657a89cb834785d0cea57", size: 853119712 },
  "qwen3-vl-8b": { hfRepo: "unsloth/Qwen3-VL-8B-Instruct-GGUF", filename: "Qwen3-VL-8B-Instruct-Q4_K_M.gguf", sha256: "108e7ff92b78eefd3db4741885104acba514255c11b617d3c7b197a5f46efe89", size: 5027785568 },
  "qwen3-vl-4b": { hfRepo: "Qwen/Qwen3-VL-4B-Instruct-GGUF", filename: "Qwen3VL-4B-Instruct-Q4_K_M.gguf", sha256: "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a", size: 2497281664 },
  "qwen3-4b-instruct": { hfRepo: "unsloth/Qwen3-4B-Instruct-2507-GGUF", filename: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597", size: 2497281120 },
  "qwen3-4b": { hfRepo: "unsloth/Qwen3-4B-GGUF", filename: "Qwen3-4B-Q4_K_M.gguf", sha256: "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a", size: 2497281312 },
  "qwen3-8b": { hfRepo: "unsloth/Qwen3-8B-GGUF", filename: "Qwen3-8B-Q4_K_M.gguf", sha256: "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4", size: 5027784512 },
  "qwen3-0.6b-base": { hfRepo: "circlestone-labs/Anima", repoPath: "split_files/text_encoders/qwen_3_06b_base.safetensors", filename: "qwen_3_06b_base.safetensors", sha256: "cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba", size: 1192135096 },
  "mistral-small-24b": { hfRepo: "unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF", filename: "Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf", sha256: "a3cc56310807ed0d145eaf9f018ccda9ae7ad8edb41ec870aa2454b0d4700b3c", size: 14333922848 },
  "ministral-3b": { hfRepo: "unsloth/Ministral-3-3B-Instruct-2512-GGUF", filename: "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf", sha256: "fd46fc371ff0509bfa8657ac956b7de8534d7d9baaa4947975c0648c3aa397f4", size: 2146497824 },
  "ovis-2.5": { hfRepo: "Comfy-Org/Ovis-Image", repoPath: "split_files/text_encoders/ovis_2.5.safetensors", filename: "ovis_2.5.safetensors", sha256: "f453ee5e7a25cb23cf2adf7aae3e5b405f22097cb67f2cfcca029688cb3f740d", size: 5140950080 },
};

const size = (width, steps, cfgScale) => ({ width, height: width, steps, cfgScale, maxSide: Math.round(width * 1.25) });
const FAST = size(1024, 8, 1);

/** `main` is the role the downloaded file plays; `parts` maps each other role to a component. First match wins. */
const FAMILIES = [
  { id: "qwen-image-2.1", test: /qwen[-_ ]?image[-_ ]?2[._]\d(\D|$)/, main: "diffusion", parts: { llm: "qwen3-vl-8b", vae: "qwen-image-2.1-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 20, 4) },
  { id: "qwen-image-edit", test: /qwen[-_ ]?image[-_ ]?edit/, main: "diffusion", parts: { llm: "qwen2.5-vl-7b", llm_vision: "qwen2.5-vl-7b-vision", vae: "qwen-image-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 20, 2.5) },
  { id: "qwen-image", test: /qwen[-_ ]?image/, main: "diffusion", parts: { llm: "qwen2.5-vl-7b", vae: "qwen-image-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 20, 2.5) },
  { id: "longcat-image", test: /longcat/, main: "diffusion", parts: { llm: "qwen2.5-vl-7b", vae: "flux-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 20, 4) },
  { id: "z-image", test: /z[-_ ]?image/, main: "diffusion", parts: { llm: "qwen3-4b-instruct", vae: "flux-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 28, 5), turbo: FAST },
  { id: "ovis-image", test: /ovis[-_ ]?image/, main: "diffusion", parts: { llm: "ovis-2.5", vae: "flux-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 20, 5) },
  { id: "anima", test: /(^|[^a-z])anima(\d|[^a-z]|$)/, main: "diffusion", parts: { llm: "qwen3-0.6b-base", vae: "qwen-image-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 30, 4) },
  { id: "ernie-image", test: /ernie[-_ ]?image/, main: "diffusion", parts: { llm: "ministral-3b", vae: "flux2-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 30, 4), turbo: FAST },
  { id: "krea-2", test: /krea[-_ ]?2/, main: "diffusion", parts: { llm: "qwen3-vl-4b", vae: "wan-2.1-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 28, 4), turbo: FAST },
  { id: "flux2-klein-9b", test: /flux[-_. ]?2.*klein.*9b/, main: "diffusion", parts: { llm: "qwen3-8b", vae: "flux2-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 4, 1), base: size(1024, 20, 4) },
  { id: "flux2-klein-4b", test: /flux[-_. ]?2.*klein/, main: "diffusion", parts: { llm: "qwen3-4b", vae: "flux2-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 4, 1), base: size(1024, 20, 4) },
  { id: "flux2-dev", test: /flux[-_. ]?2/, main: "diffusion", parts: { llm: "mistral-small-24b", vae: "flux2-vae" }, serverArgs: ["--diffusion-fa"], defaults: size(1024, 28, 4) },
  { id: "chroma-radiance", test: /chroma.*radiance/, main: "diffusion", parts: { t5xxl: "t5xxl" }, defaults: size(1024, 26, 4) },
  { id: "chroma", test: /chroma/, main: "diffusion", parts: { t5xxl: "t5xxl", vae: "flux-vae" }, defaults: size(1024, 26, 4) },
  { id: "flux", test: /flux|kontext/, main: "diffusion", parts: { clip_l: "clip-l", t5xxl: "t5xxl", vae: "flux-vae" }, defaults: size(1024, 20, 1), schnell: size(1024, 4, 1) },
  // A checkpoint with its encoders built in loads alone, like any Stable Diffusion file.
  { id: "sd3", test: /(^|[^a-z0-9])sd[-_ ]?3|stable[-_ ]?diffusion[-_ ]?3/, unless: /incl[-_]?clips/, main: "model", parts: { clip_l: "clip-l", clip_g: "clip-g", t5xxl: "t5xxl" }, defaults: size(1024, 28, 4.5) },
];

const SDXL = /sdxl|[-_ ]xl[-_ .]|xl[-_]?base|pony|illustrious|noob|animagine|juggernaut/;

/** The family a model belongs to, read from its repository, file name and GGUF architecture together. */
function familyOf(...hints) {
  const text = hints.filter(Boolean).join(" ").toLowerCase();
  const family = FAMILIES.find((item) => item.test.test(text) && !(item.unless && item.unless.test(text))) || null;
  log.debug("engine.image", "family matched", { family: family?.id ?? "none" });
  return family;
}

/** The size, steps and guidance a model draws with when nobody says otherwise. */
function defaultsFor(family, ...hints) {
  const text = hints.filter(Boolean).join(" ").toLowerCase();
  if (!family) return SDXL.test(text) ? size(1024, 25, 7) : { width: 512, height: 512, steps: 20, cfgScale: 7, maxSide: 768 };
  if (family.turbo && /turbo|distill|lightning/.test(text)) return family.turbo;
  if (family.schnell && /schnell/.test(text)) return family.schnell;
  if (family.base && /base/.test(text)) return family.base;
  return family.defaults;
}

/** Families whose pictures are edited by showing the model the original (sd-server `ref_images`), not by adding noise to it. */
const EDIT_FAMILIES = new Set(["qwen-image-edit", "flux2-klein-9b", "flux2-klein-4b", "flux2-dev"]);

/**
 * How a model takes a reference picture: "edit" (the original goes in as a reference image), "img2img" (it is the
 * starting point, noised by `strength`), or null for a model that cannot use one. Plain checkpoints do img2img.
 */
function referenceModeOf(family, ...hints) {
  const text = hints.filter(Boolean).join(" ").toLowerCase();
  if ((family && EDIT_FAMILIES.has(family.id)) || /kontext|[-_ ]edit/.test(text)) return "edit";
  return "img2img";
}

/** The components a family needs, as downloadable files carrying their role. */
function partsOf(family) {
  if (!family) return [];
  return Object.entries(family.parts).map(([role, id]) => ({ role, id, ...COMPONENTS[id] }));
}

const COMPONENT_FILES = new Set(Object.values(COMPONENTS).map((component) => component.filename));

module.exports = { COMPONENTS, FAMILIES, COMPONENT_FILES, familyOf, defaultsFor, partsOf, referenceModeOf };
