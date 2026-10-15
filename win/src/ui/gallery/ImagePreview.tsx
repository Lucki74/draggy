import ImageCard from "../../chat/ImageCard";
import { ImageModelRow } from "../../settings/ImageModelsSection";
import { translations } from "../../translations";
import type { ImageModelEntry, ImageStepInfo } from "../../types";

const noop = () => {};
const t = (key: string) => translations.en[key] || key;

/** A picture drawn from two flat washes, so the card has something to show without a file on disk. */
const PICTURE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9c7a8"/><stop offset="1" stop-color="#4a5568"/></linearGradient></defs><rect width="768" height="512" fill="url(#g)"/><circle cx="560" cy="150" r="56" fill="#f3e7cf"/></svg>',
  );

const NOW = Date.now();
const PROMPT = "a lighthouse on a cliff at dusk, oil painting";

const CARDS: { label: string; image: ImageStepInfo; picture?: boolean }[] = [
  { label: "Loading the model", image: { prompt: PROMPT, status: "loading-model", requestId: "a", startedAt: NOW - 14_000, width: 768, height: 512 } },
  { label: "Queued", image: { prompt: PROMPT, status: "queued", requestId: "b", queuePosition: 2, startedAt: NOW - 3_000 } },
  { label: "Drawing", image: { prompt: PROMPT, status: "generating", requestId: "c", startedAt: NOW - 38_000, width: 512, height: 768 } },
  {
    label: "Done",
    picture: true,
    image: { prompt: PROMPT, status: "done", location: "created", filename: "lighthouse.png", path: "C:\\Draggy\\lighthouse.png", width: 768, height: 512, seed: 48213907, model: "Z-Image Turbo" },
  },
  { label: "Stopped", image: { prompt: PROMPT, status: "cancelled", finishedAt: NOW - 1_000 } },
  { label: "Stopped when Draggy closed", image: { prompt: PROMPT, status: "cancelled" } },
  {
    label: "Failed",
    image: {
      prompt: PROMPT,
      status: "error",
      error: "There is not enough memory for this image model: it needs about 9 GB. Close the chat model or pick a smaller image model. [More about this error](https://example.invalid/error)",
    },
  },
];

const model = (patch: Partial<ImageModelEntry>): ImageModelEntry => ({
  id: "file:z-image-turbo-Q4_K_M.gguf",
  name: "Z-Image Turbo",
  variant: "Q4_K_M",
  kind: "single",
  curated: true,
  installed: true,
  partial: false,
  size: 4.6 * 1024 ** 3,
  vramGB: 6,
  defaults: { width: 768, height: 512, steps: 8, cfgScale: 1 },
  license: "Apache 2.0",
  licenseUrl: "",
  files: [],
  ...patch,
});

/** The picture card in every state, and the installed model rows of the Models page. */
export function ImagePreview() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-1 rounded-md bg-surface-canvas p-6">
        {CARDS.map(({ label, image, picture }) => (
          <div key={label} data-gallery={`image-${label.toLowerCase().replace(/\W+/g, "-")}`}>
            <p className="mb-1 text-[12px] text-text-tertiary">{label}</p>
            <ImageCard step={{ id: label, type: "image", content: image.prompt, isComplete: !["loading-model", "queued", "generating"].includes(image.status), image }} t={t} previewSrc={picture ? PICTURE : undefined} />
          </div>
        ))}
      </div>
      <div className="space-y-6 rounded-md bg-surface-canvas p-6">
        <div className="divide-y divide-rule rounded-md bg-surface-base shadow-[0_0_0_1px_var(--rule-strong)]" data-gallery="image-model-rows">
          <ImageModelRow entry={model({})} active onRemove={noop} t={t} />
          <ImageModelRow entry={model({ id: "file:sd15", name: "Stable Diffusion 1.5", variant: "", size: 2.1 * 1024 ** 3, license: "CreativeML OpenRAIL-M" })} active={false} onRemove={noop} t={t} />
        </div>
      </div>
    </div>
  );
}
