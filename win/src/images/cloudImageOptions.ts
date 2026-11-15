import type { SelectOption } from "../settings/Controls";

/** A provider with a stored key and an image protocol, as `images:cloud-models` lists it. */
export interface CloudImageProvider {
  id: string;
  name: string;
  models: string[];
}

export type ImageModelChoice = { source: "local" | "cloud"; provider?: string; model: string };

const LOCAL_PREFIX = "local:";
const CLOUD_PREFIX = "cloud:";

/** The Select value for a saved choice. Empty means automatic. */
export function encodeImageChoice(choice: ImageModelChoice): string {
  if (!choice.model) return "";
  if (choice.source === "cloud" && choice.provider) return `${CLOUD_PREFIX}${choice.provider}:${choice.model}`;
  return `${LOCAL_PREFIX}${choice.model}`;
}

/** Reads a Select value back into a saved choice. Provider ids never contain a colon, model ids may. */
export function decodeImageChoice(value: string): ImageModelChoice {
  if (value.startsWith(CLOUD_PREFIX)) {
    const rest = value.slice(CLOUD_PREFIX.length);
    const split = rest.indexOf(":");
    if (split > 0) return { source: "cloud", provider: rest.slice(0, split), model: rest.slice(split + 1) };
  }
  if (value.startsWith(LOCAL_PREFIX)) return { source: "local", model: value.slice(LOCAL_PREFIX.length) };
  return { source: "local", model: "" };
}

/**
 * Picker rows: automatic, then Local models, then one group per connected provider. Model names only.
 * Groups keep their order, so the local group comes first.
 */
export function imageModelOptions({
  localModels,
  cloud,
  automaticLabel,
  localLabel,
}: {
  localModels: { id: string; label: string }[];
  cloud: CloudImageProvider[];
  automaticLabel: string;
  localLabel: string;
}): SelectOption[] {
  const options: SelectOption[] = [{ id: "", label: automaticLabel }];
  for (const model of localModels) {
    options.push({ id: `${LOCAL_PREFIX}${model.id}`, label: model.label, group: localLabel });
  }
  for (const provider of cloud) {
    for (const model of provider.models) {
      options.push({ id: `${CLOUD_PREFIX}${provider.id}:${model}`, label: model, group: provider.name });
    }
  }
  return options;
}
