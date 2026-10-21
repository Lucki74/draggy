import { USABLE_RAM_FRACTION, USABLE_UNIFIED_RAM_FRACTION, type RuntimeTarget } from "../modelRecommendations";
import { USABLE_VRAM_FRACTION } from "../vram";

export interface ImageRecommendation {
  /** The smallest card that holds the diffusion weights and a 1024 px decode, in GB. */
  vram: number;
  /** All the memory it needs, card and RAM together: the encoder and VAE wait in RAM. */
  memory: number;
  /** What `sd:download-repo` resolves; the encoder and VAE come with it. */
  reference: string;
  /** The file the reference resolves to, for spotting it already on disk. */
  filename: string;
  label: string;
  params: string;
  /** The whole download, diffusion weights, encoder and VAE, in GB. */
  sizeGB: number;
  /** Small and few-step enough to finish an image on the processor alone. */
  cpu: boolean;
}

/** Ascending by quality, so the best rung that fits is the last one that does. */
export const imageLadder: ImageRecommendation[] = [
  { vram: 2.5, memory: 3, reference: "second-state/stable-diffusion-v1-5-GGUF:Q8_0", filename: "stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf", label: "Stable Diffusion 1.5", params: "0.9B", sizeGB: 1.76, cpu: true },
  { vram: 3.5, memory: 7, reference: "unsloth/FLUX.2-klein-4B-GGUF:Q4_K_M", filename: "flux-2-klein-4b-Q4_K_M.gguf", label: "FLUX.2 klein 4B", params: "4B", sizeGB: 5.44, cpu: true },
  { vram: 6.5, memory: 9.5, reference: "unsloth/Z-Image-Turbo-GGUF:Q4_K_M", filename: "z-image-turbo-Q4_K_M.gguf", label: "Z-Image Turbo", params: "6B", sizeGB: 7.86, cpu: false },
  { vram: 9, memory: 12, reference: "unsloth/Z-Image-Turbo-GGUF:Q8_0", filename: "z-image-turbo-Q8_0.gguf", label: "Z-Image Turbo Q8", params: "6B", sizeGB: 10.06, cpu: false },
  { vram: 9.5, memory: 13.5, reference: "unsloth/Qwen-Image-2.1-GGUF:Q6_K", filename: "qwen-image-2.1-Q6_K.gguf", label: "Qwen-Image 2.1", params: "7B", sizeGB: 11.98, cpu: false },
  { vram: 11, memory: 15, reference: "unsloth/Qwen-Image-2.1-GGUF:Q8_0", filename: "qwen-image-2.1-Q8_0.gguf", label: "Qwen-Image 2.1 Q8", params: "7B", sizeGB: 13.35, cpu: false },
];

/** Diffusion needs its weights on the card each step; the encoder and VAE can wait in RAM. */
export function imageRungFits(rung: ImageRecommendation, vram: number, target: RuntimeTarget = {}): boolean {
  const card = Number.isFinite(vram) && vram > 0 ? vram : 0;
  const ram = target.ram && target.ram > 0 ? target.ram : 0;
  if (target.platform === "darwin" && target.arch === "arm64") {
    return rung.memory <= (ram || card) * USABLE_UNIFIED_RAM_FRACTION;
  }
  if (card < 2) return rung.cpu && rung.memory <= ram * USABLE_RAM_FRACTION;
  return card >= rung.vram && rung.memory <= card * USABLE_VRAM_FRACTION + ram * USABLE_RAM_FRACTION;
}

export function getRecommendedImageModel(vram: number, target: RuntimeTarget = {}): ImageRecommendation {
  return imageLadder.findLast((rung) => imageRungFits(rung, vram, target)) ?? imageLadder[0];
}
