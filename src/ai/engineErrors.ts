import { translate } from "../i18n";
import { translations } from "../translations";

const SITE = "https://draggy.org";

/** The phrases llama.cpp prints. Only the image, tool-call and missing-file ones have been seen in Draggy's logs. */
const BY_TEXT: ReadonlyArray<{ pattern: RegExp; slug: string; key: string }> = [
  { pattern: /image input is not supported/i, slug: "image-not-supported", key: "engineImageNotSupported" },
  { pattern: /exceeds? the available context size|context size has been exceeded/i, slug: "context-too-long", key: "engineContextTooLong" },
  { pattern: /failed to parse (messages|tool call)/i, slug: "tool-call-unreadable", key: "engineToolCallUnreadable" },
  // The whole message: "error loading model" in a failed load must not match.
  { pattern: /^\s*loading model\.?\s*$/i, slug: "model-still-loading", key: "engineModelStillLoading" },
  { pattern: /out of memory|failed to allocate|cudaMalloc|OutOfDeviceMemory|OutOfHostMemory/i, slug: "out-of-memory", key: "engineOutOfMemory" },
  { pattern: /unknown model architecture/i, slug: "unsupported-architecture", key: "engineUnsupportedArchitecture" },
  { pattern: /invalid magic characters|not within the file bounds|model is corrupted or incomplete/i, slug: "damaged-model-file", key: "engineDamagedModelFile" },
  { pattern: /failed to load GGUF split|failed to open GGUF file/i, slug: "missing-model-file", key: "engineMissingModelFile" },
  { pattern: /couldn't bind HTTP server socket|address already in use/i, slug: "port-in-use", key: "enginePortInUse" },
];

/** What the main process names its own failures, so nothing has to parse its English. */
const BY_KIND: Record<string, string> = {
  "load-timeout": "load-timeout",
  "stopped-loading": "engine-stopped-loading",
  "parts-missing": "model-parts-missing",
  "another-model": "another-model-started",
  "engine-missing": "engine-would-not-start",
};

export interface EngineResult {
  error?: string;
  kind?: string;
  params?: Record<string, string>;
}

interface Options {
  /** Chat renders markdown, so the link there is a real one; elsewhere it is the bare address. */
  markdown?: boolean;
}

const languageNow = () =>
  typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";

function say(language: string, key: string, params: Record<string, string> = {}): string {
  return translate(language, key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
}

/** The article for a failure, in the reader's language when the site has one, English otherwise. */
export function articleUrl(slug: string, language: string): string {
  const folder = language !== "en" && translations[language] ? `${language}/` : "";
  return `${SITE}/${folder}error/${slug}`;
}

function withArticle(message: string, slug: string, language: string, options: Options): string {
  const url = articleUrl(slug, language);
  return options.markdown
    ? `${message} [${say(language, "engineErrorLink")}](${url})`
    : `${message} ${url}`;
}

function known(text: string) {
  return BY_TEXT.find(({ pattern }) => pattern.test(text)) ?? null;
}

/** What to show for a failure of the engine, in the reader's language with a link to the article on it. */
export function engineFailure(source: string | EngineResult | null | undefined, options: Options = {}): string {
  const language = languageNow();
  const result: EngineResult = typeof source === "string" ? { error: source } : (source ?? {});
  const text = String(result.error ?? "").trim();
  const params = result.params ?? {};

  if (result.kind && BY_KIND[result.kind]) {
    const slug = BY_KIND[result.kind];

    // A crash whose last words are a known cause is that cause, not the generic crash.
    if (result.kind === "stopped-loading") {
      const cause = known(`${params.log ?? ""}\n${params.reason ?? ""}`);
      if (cause) return withArticle(say(language, cause.key), cause.slug, language, options);
    }

    const key = {
      "load-timeout": "engineLoadTimeout",
      "stopped-loading": "engineStoppedLoading",
      "parts-missing": "engineModelPartsMissing",
      "another-model": "engineAnotherModelStarted",
      "engine-missing": "missingGgufEngine",
    }[result.kind] as string;

    const detail = params.reason ? `: ${params.reason}` : "";
    return withArticle(say(language, key, { ...params, detail }), slug, language, options);
  }

  if (!text) return withArticle(say(language, "engineWouldNotStart"), "engine-would-not-start", language, options);

  const match = known(text);
  if (match) return withArticle(say(language, match.key), match.slug, language, options);

  // Unrecognised: the engine's own words stay, since hiding them leaves nothing to search for.
  return withArticle(say(language, "engineUnknownProblem", { text }), "unknown-engine-error", language, options);
}

/** The engine started and then could not be connected to. */
export function engineUnreachable(options: Options = {}): string {
  const language = languageNow();
  return withArticle(say(language, "engineUnreachable"), "engine-unreachable", language, options);
}
