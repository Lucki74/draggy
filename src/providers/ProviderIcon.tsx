import { hueFor } from "../utils";

const FILES = import.meta.glob<string>("./icons/*.svg", { eager: true, query: "?url", import: "default" });
const url = (name: string) => FILES[`./icons/${name}.svg`];

/** Catalog ids whose logo file is named after the brand rather than the id. */
const BRAND: Record<string, string> = {
  chatgpt: "openai",
  anthropic: "claude",
  mlx: "apple",
};

/** One-colour logos: painted with the text colour so they stay visible in both themes. */
const MONO = new Set(["openai", "xai", "groq", "cerebras", "openrouter", "moonshot", "zai", "ollama", "lmstudio", "apple"]);

/** A provider's logo, or its first letter on a tile when it has none (the server types without a brand mark). */
export function ProviderIcon({ type, name, size = "w-5 h-5" }: { type: string | undefined; name: string; size?: string }) {
  const file = type ? (BRAND[type] ?? type) : "";
  const src = file ? url(file) : undefined;
  const box = `${size} flex-shrink-0 select-none`;

  if (src && MONO.has(file)) {
    return (
      <span
        aria-hidden="true"
        data-icon={file}
        className={`${box} bg-[var(--text-main)]`}
        style={{ maskImage: `url("${src}")`, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }}
      />
    );
  }
  if (src) return <img src={src} alt="" aria-hidden="true" data-icon={file} className={`${box} object-contain`} />;

  return (
    <span
      aria-hidden="true"
      className={`${box} rounded-md flex items-center justify-center text-[10px] font-bold text-white`}
      style={{ backgroundColor: `hsl(${hueFor(name)} 55% 45%)` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
