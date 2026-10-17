import { formatBytes } from "../formatBytes";
import { fill } from "../onboarding/text";
import { formatContextCeiling, quantizationOf, type InstalledModel } from "../llama";

type Translate = (key: string) => string;

/** The engine reports a model's layer count as "35L"; the number alone says nothing to a reader. */
export function layersLabel(parameterSize: string | undefined, t: Translate): string {
  const match = parameterSize?.match(/^(\d+)L$/);
  return match ? fill(t("modelLayers"), { n: match[1] }) : (parameterSize ?? "");
}

/** Size, layers, quantization and context, in the order a reader weighs a model by. */
export function modelMetaParts(entry: InstalledModel, t: Translate): string[] {
  return [
    formatBytes(entry.size),
    layersLabel(entry.parameterSize, t),
    quantizationOf(entry.name),
    entry.contextLength ? `${formatContextCeiling(entry.contextLength)} ${t("modelContext")}` : "",
  ].filter(Boolean);
}
