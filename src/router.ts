import { OLLAMA_HOST, isCloudModel, pullModel } from "./ollama";
import { getRecommendedHelperModel, helperRecommendations } from "./modelRecommendations";
import { safeJsonParse } from "./utils";

export const ROUTER_CANDIDATES = [
  "qwen3:0.6b",
  "llama3.2:1b",
  "smollm2:360m",
  "qwen3:1.7b",
  "gemma3:1b",
];

export const ROUTER_KEEP_ALIVE = "10m";

const ROUTER_CONTEXT = 2048;

export interface RouterOptions {
  numPredict?: number;
  temperature?: number;
  signal?: AbortSignal;
  keepAlive?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export function chooseRouterModel(
  installed: string[],
  mainModel: string,
): string | null {
  const local = installed.filter((name) => !isCloudModel(name));
  const bases = new Map(local.map((name) => [name.split(":")[0], name]));

  for (const candidate of ROUTER_CANDIDATES) {
    if (local.includes(candidate) && candidate !== mainModel) return candidate;

    const base = candidate.split(":")[0];
    const match = bases.get(base);
    if (match && match !== mainModel) return match;
  }

  return null;
}

export async function complete(
  model: string,
  system: string,
  user: string,
  options: RouterOptions = {},
): Promise<string> {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: options.keepAlive ?? ROUTER_KEEP_ALIVE,
      options: {
        num_ctx: ROUTER_CONTEXT,
        num_predict: options.numPredict ?? 48,
        temperature: options.temperature ?? 0,
      },
      messages: [
        { role: "system", content: system },
        ...(options.history ?? []),
        { role: "user", content: user },
      ],
    }),
    signal: options.signal,
  });

  if (!response.ok) throw new Error(`Router model returned ${response.status}`);

  const body = await response.json();
  return String(body?.message?.content ?? "").trim();
}

/**
 * Deciding what a question needs before answering it.
 *
 * The wording matters more than it looks. Told merely to "answer with one
 * word", a small model answers the question instead of labelling it: asked
 * what two hundred and fifty times four is, it replies "5000". Naming the job
 * as classification and showing worked examples is what makes the label the
 * obvious output.
 *
 * Measured over nineteen questions covering all three cases, this prompt
 * scored 19/19 on a 9B model. The same prompt on a 1B model scored 7/19 and
 * collapsed to one label, which is why routing runs on the answering model
 * rather than on a small helper.
 */
const ROUTE_SYSTEM = `You are a classifier. You never answer the user's question. You only print one label.

Print SEARCH if answering well needs information from today's internet: news, weather, prices, sport results, timetables, opening hours, or the current version or release of something.
Print LOCAL if it is about the user's own files, documents, notes or projects.
Print KNOWN for everything else, including maths, definitions, history, geography, science, code, writing and chat.

Print only the single word SEARCH, LOCAL or KNOWN. Never answer the question itself.`;

const ROUTE_EXAMPLES: { user: string; assistant: string }[] = [
  { user: "What is two hundred and fifty times four?", assistant: "KNOWN" },
  { user: "What is the weather in Berlin today?", assistant: "SEARCH" },
  { user: "Write a short poem about rain", assistant: "KNOWN" },
  { user: "What does my lease say about pets?", assistant: "LOCAL" },
  { user: "Explain how a diesel engine works", assistant: "KNOWN" },
  { user: "What is the latest release of Python?", assistant: "SEARCH" },
];

const ROUTE_HISTORY = ROUTE_EXAMPLES.flatMap((example) => [
  { role: "user" as const, content: example.user },
  { role: "assistant" as const, content: example.assistant },
]);

export type Route = "search" | "local" | "known";

export function parseRoute(raw: string): Route | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .toUpperCase();

  if (/\bLOCAL\b/.test(cleaned)) return "local";
  if (/\bSEARCH\b/.test(cleaned)) return "search";
  if (/\bKNOWN\b/.test(cleaned)) return "known";

  return null;
}

export async function routeQuestion(
  model: string,
  question: string,
  signal?: AbortSignal,
): Promise<Route | null> {
  const trimmed = question.trim();
  if (!trimmed) return null;

  try {
    const reply = await complete(model, ROUTE_SYSTEM, trimmed.slice(0, 1200), {
      numPredict: 4,
      history: ROUTE_HISTORY,
      signal,
    });
    return parseRoute(reply);
  } catch {
    return null;
  }
}

const LANGUAGE_SYSTEM = `Identify the language of the text. Reply with the two-letter ISO 639-1 code only, lowercase, nothing else.`;

export async function detectLanguage(
  model: string,
  text: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const reply = await complete(model, LANGUAGE_SYSTEM, text.slice(0, 400), {
      numPredict: 4,
      signal,
    });
    const match = reply.toLowerCase().match(/\b([a-z]{2})\b/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export interface RouterState {
  model: string | null;
  enabled: boolean;
  downloading: string | null;
  percent: number;
  error: string | null;
}

export interface RouterResolution {
  ready: string | null;
  needsDownload: string | null;
}

export function resolveRouterModel(
  installed: string[],
  mainModel: string,
  vram: number,
): RouterResolution {
  const ready = chooseRouterModel(installed, mainModel);
  if (ready) return { ready, needsDownload: null };

  const recommended = getRecommendedHelperModel(vram);
  if (recommended !== mainModel) return { ready: null, needsDownload: recommended };

  // The best helper for this machine is already the model doing the answering,
  // so step down the ladder rather than leaving the user with no helper at all.
  const smaller = helperRecommendations
    .filter((entry) => entry.vram <= vram && entry.model !== mainModel)
    .sort((a, b) => b.vram - a.vram)[0];

  return { ready: null, needsDownload: smaller ? smaller.model : null };
}

let state: RouterState = {
  model: null,
  enabled: true,
  downloading: null,
  percent: 0,
  error: null,
};

const listeners = new Set<(next: RouterState) => void>();

function publish(patch: Partial<RouterState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function onRouterState(listener: (next: RouterState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function setRouterState(next: Partial<RouterState>) {
  publish(next);
}

export function routerState(): RouterState {
  return { ...state };
}

export function routerModel(): string | null {
  return state.enabled ? state.model : null;
}

let provisioning: Promise<string | null> | null = null;

export async function ensureRouterModel(
  installed: string[],
  mainModel: string,
  vram: number,
): Promise<string | null> {
  if (!state.enabled) return null;
  if (state.model) return state.model;
  if (provisioning) return provisioning;

  const { ready, needsDownload } = resolveRouterModel(installed, mainModel, vram);

  if (ready) {
    publish({ model: ready, error: null });
    return ready;
  }

  if (!needsDownload) {
    publish({ model: null });
    return null;
  }

  provisioning = (async () => {
    publish({ downloading: needsDownload, percent: 0, error: null });

    try {
      await pullModel(needsDownload, (progress) => {
        publish({ percent: Math.round(progress.percent) });
      });

      publish({ model: needsDownload, downloading: null, percent: 100 });
      return needsDownload;
    } catch (error) {
      publish({
        downloading: null,
        percent: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      provisioning = null;
    }
  })();

  return provisioning;
}

export function parseRouterSettings(raw: string | null): RouterState {
  const parsed = safeJsonParse<Partial<RouterState>>(raw ?? "");
  return {
    model: parsed?.model ?? null,
    enabled: parsed?.enabled ?? true,
    downloading: null,
    percent: 0,
    error: null,
  };
}
