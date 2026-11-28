import { useEffect, useState } from "react";
import type { AppSettings } from "../types";
import { SETTINGS_KEY, storageBackend } from "../storage";
import { safeJsonParse, writeLocalStorage } from "../utils";
import { swallowed } from "../logger";
import { DEFAULT_ACCENT, applyAccent } from "./accent";
import { EFFORT_DEFAULT, effortFromLegacy, isEffortLevel } from "../ai/effort";
import { DEFAULT_BUDGETS } from "../stats/budget";
import { turnPricer } from "../stats/pricing";
import { resolveDisplayMoney, setDisplayMoney } from "../stats/displayMoney";

/** Thinking modes before the five effort levels, and the key each one became. */
const LEGACY_EFFORT_KEYS = [
  ["thinkingMode", "effort"],
  ["codeThinkingMode", "codeEffort"],
] as const;

export const defaultSettings: AppSettings = {
  // Only a new install gets this: anyone with saved settings keeps the theme they saved.
  theme: "system",
  accent: DEFAULT_ACCENT,
  fontSize: "base",
  language: "en",
  // Empty means "not chosen yet": the startup screen adopts whatever is
  // already installed, and sizes a model to the graphics card if nothing is.
  modelName: "",
  customInstructions: [],
  effort: EFFORT_DEFAULT,
  defaultEffort: EFFORT_DEFAULT,
  allowMaxInChat: true,
  newChatStart: "defaults",
  slowModelThinking: false,
  colibriLossy: false,
  webMode: "on",
  browserActions: true,
  voiceName: "",
  voiceModel: "",
  voiceEngine: "neural",
  neuralVoice: "F1",
  cloudProvider: "",
  cloudVoice: "",
  cloudModel: "",
  voiceSounds: true,
  interfaceSounds: false,
  voiceRate: 1,
  searchProvider: "auto",
  searxngUrl: "",
  researchModelStart: true,
  researchMaxDepth: "deep",
  researchKeep: "forever",
  subagents: true,
  subagentConcurrency: 2,
  subagentMaxPerTurn: 8,
  codeModel: "",
  planModel: "",
  summaryModel: "",
  codeInstructions: [],
  codeEffort: EFFORT_DEFAULT,
  codeDefaultEffort: EFFORT_DEFAULT,
  codeWebMode: "on",
  codePermissionMode: "acceptEdits",
  permissionRules: [],
  libraryEnabled: true,
  embedModel: "",
  showMetrics: false,
  compactLimit: null,
  fixedContextSize: null,
  imageModel: { source: "local", model: "" },
  imageResolution: "1024x1024",
  budgets: DEFAULT_BUDGETS,
  hooks: [],
  hookTrust: {},
  priceRefresh: true,
  displayCurrency: "USD",
};

export const FONT_SIZES = { sm: "13px", base: "15px", lg: "18px" };

export function resolveTheme(setting: AppSettings["theme"], prefersDark: boolean): "light" | "dark" {
  if (setting === "system") return prefersDark ? "dark" : "light";
  return setting === "light" ? "light" : "dark";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

let legacyBraveKey = "";

const VOICE_MIGRATED_KEY = "draggy.voiceEngineDefault";
const VALID_LANGUAGES =new Set(["en", "fr", "es", "ru"]);

/** Read synchronously from localStorage rather than awaited from sqlite: the first paint needs the
 * theme and the language before any IPC can answer. */
/** Reads the saved image model, whichever shape it was saved in. A bare string is a local model name. */
export function migrateImageModel(value: unknown): AppSettings["imageModel"] {
  if (typeof value === "string") return { source: "local", model: value };
  if (value && typeof value === "object" && typeof (value as { model?: unknown }).model === "string") {
    const saved = value as { source?: unknown; provider?: unknown; model: string };
    const provider = typeof saved.provider === "string" && saved.provider ? saved.provider : undefined;
    if (saved.source === "cloud" && provider) return { source: "cloud", provider, model: saved.model };
    return { source: "local", model: saved.model };
  }
  return { source: "local", model: "" };
}

export function loadSettings(): AppSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  const parsed = saved ? safeJsonParse<Partial<AppSettings> & { braveApiKey?: string }>(saved) : null;
  if (!parsed) {
    writeLocalStorage(VOICE_MIGRATED_KEY, "1");
    return defaultSettings;
  }
  // Earlier versions kept the Brave key here in the clear; it leaves for the keystore on the first save.
  if ("braveApiKey" in parsed) {
    legacyBraveKey = String(parsed.braveApiKey || "").trim();
    delete parsed.braveApiKey;
  }

  let migrated = false;
  // Updating is always on now, with no setting.
  if ("autoUpdate" in parsed) {
    delete (parsed as { autoUpdate?: unknown }).autoUpdate;
    migrated = true;
  }
  // Auto memory is always on now, with no setting.
  if ("autoMemory" in parsed) {
    delete (parsed as { autoMemory?: unknown }).autoMemory;
    migrated = true;
  }
  // Every build is a full release now, so there is no channel to choose.
  if ("updateChannel" in parsed) {
    delete (parsed as { updateChannel?: unknown }).updateChannel;
    migrated = true;
  }
  // Web access is On or Off now. "auto" meant the model chose, which is what On does.
  for (const key of ["webMode", "codeWebMode"] as const) {
    if ((parsed[key] as string | undefined) === "auto") {
      parsed[key] = "on";
      migrated = true;
    }
  }
  if ("permissionRules" in parsed && !Array.isArray(parsed.permissionRules)) {
    parsed.permissionRules = [];
    migrated = true;
  }
  if (parsed.language && !VALID_LANGUAGES.has(parsed.language)) {
    parsed.language = "en";
    migrated = true;
  }
  // The image model was a bare local name. It is now { source, provider?, model }.
  const imageModel = migrateImageModel((parsed as { imageModel?: unknown }).imageModel);
  if (JSON.stringify((parsed as { imageModel?: unknown }).imageModel) !== JSON.stringify(imageModel)) {
    (parsed as { imageModel?: unknown }).imageModel = imageModel;
    migrated = true;
  }

  // The neural voice is the default now. Someone saved on the old default "system" without ever
  // naming a system voice never chose it, so they move over once; a later choice sticks.
  if (!localStorage.getItem(VOICE_MIGRATED_KEY)) {
    if (parsed.voiceEngine === "system" && !parsed.voiceName) {
      parsed.voiceEngine = "neural";
      migrated = true;
    }
    writeLocalStorage(VOICE_MIGRATED_KEY, "1");
  }

  // Claude's listing no longer offers `default`; `opus` is the model it named.
  for (const key of ["modelName", "codeModel", "planModel", "summaryModel"] as const) {
    // A model key that is not text cannot name a model, so it resets to blank.
    if (key in parsed && typeof parsed[key] !== "string") {
      parsed[key] = "";
      migrated = true;
    }
    if (typeof parsed[key] === "string") parsed[key] = parsed[key].replace(/^(@claude(?:-\d+)?\/)default$/, "$1opus");
    // The ChatGPT backend refuses gpt-5.5 to plan accounts; Codex ranks gpt-6-astra first.
    if (typeof parsed[key] === "string") parsed[key] = parsed[key].replace(/^(@chatgpt(?:-\d+)?\/)gpt-5\.5$/, "$1gpt-6-astra");
  }
  // Thinking modes are now effort levels. Old "low" meant thinking off, so it maps to off. A blob
  // with both keys keeps the new one, and an unreadable value reads as the default.
  const legacy = parsed as Record<string, unknown>;
  for (const [oldKey, newKey] of LEGACY_EFFORT_KEYS) {
    if (!(oldKey in legacy)) continue;
    if (!(newKey in legacy)) legacy[newKey] = effortFromLegacy(legacy[oldKey]) ?? EFFORT_DEFAULT;
    delete legacy[oldKey];
    migrated = true;
  }
  for (const key of ["effort", "codeEffort", "defaultEffort", "codeDefaultEffort"] as const) {
    if (key in legacy && !isEffortLevel(legacy[key])) {
      legacy[key] = EFFORT_DEFAULT;
      migrated = true;
    }
  }
  // Local replies are priced by their own base model now, so the "compare against" choice is gone.
  if ("referenceModel" in parsed) {
    delete (parsed as { referenceModel?: unknown }).referenceModel;
    migrated = true;
  }
  // Hooks are a list and a map now; a hand-edited value of another shape is dropped.
  if ("hooks" in parsed && !Array.isArray(parsed.hooks)) {
    delete parsed.hooks;
    migrated = true;
  }
  if ("hookTrust" in parsed && (typeof parsed.hookTrust !== "object" || parsed.hookTrust === null)) {
    delete parsed.hookTrust;
    migrated = true;
  }
  // Earlier versions saved the speed line switched on without anyone asking for it.
  const resolved = parsed.metricsChosen
    ? ({ ...defaultSettings, ...parsed } as AppSettings)
    : ({ ...defaultSettings, ...parsed, showMetrics: false } as AppSettings);
  if (migrated) writeLocalStorage(SETTINGS_KEY, JSON.stringify(resolved));
  return resolved;
}

/** The settings object and everything that has to happen when it changes: saved in both places,
 * pushed to the main process, and applied to the document. */
/** `holdUpdates` keeps the updaters unscheduled while the first-run setup is showing: nothing may
 * reach the network before the user has chosen, and they choose on its Preferences step. */
export function useSettings(isSplashMode: boolean, holdUpdates = false) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  // localStorage is per origin and can be wiped, so an empty one is not a first run: sqlite is asked
  // first, and nothing is saved until it answers, or its copy would be overwritten with defaults.
  const [hydrated, setHydrated] = useState(() => !window.draggy?.db || localStorage.getItem(SETTINGS_KEY) !== null);

  useEffect(() => {
    if (hydrated) return;
    let live = true;
    storageBackend()
      .loadSettings()
      .then((stored) => {
        if (!live || !stored) return;
        writeLocalStorage(SETTINGS_KEY, JSON.stringify(stored));
        setSettings(loadSettings());
      })
      .catch(swallowed("app", "falls back to the defaults"))
      .finally(() => {
        if (live) setHydrated(true);
      });
    return () => {
      live = false;
    };
  }, [hydrated]);

  useEffect(() => {
    if (isSplashMode || !hydrated) return;

    writeLocalStorage(SETTINGS_KEY, JSON.stringify(settings));
    storageBackend()
      .saveSettings(settings)
      .catch(swallowed("app", "best effort, the screen works without it"));
  }, [settings, isSplashMode, hydrated]);

  useEffect(() => {
    window.draggy
      ?.setSearchConfig({
        searchProvider: settings.searchProvider,
        searxngUrl: settings.searxngUrl,
      })
      .catch(swallowed("app", "the main process already logged this call"));
  }, [settings.searchProvider, settings.searxngUrl]);

  useEffect(() => {
    const key = legacyBraveKey;
    legacyBraveKey = "";
    const api = window.draggy;
    if (!key || !api?.braveKeyStatus) return;
    // Main has usually moved it already, from its own copy; a key set since then is never replaced.
    void api
      .braveKeyStatus()
      .then((status) => (status.hasKey ? undefined : api.setBraveKey(key)))
      .catch(swallowed("app", "the main process already logged this call"));
  }, []);

  // Like the updater, the price refresh is the main process's to schedule. It is the only thing that
  // reaches the network for costs, so it waits for the first-run choice too.
  useEffect(() => {
    if (isSplashMode || holdUpdates) return;
    window.draggy?.pricing
      ?.configure({ automatic: settings.priceRefresh !== false })
      .catch(swallowed("app", "the main process already logged this call"));
  }, [settings.priceRefresh, isSplashMode, holdUpdates]);

  // Costs are stored in dollars. The display currency and its rate are applied where they are shown.
  const displayCurrency = settings.displayCurrency;
  useEffect(() => {
    const pricing = window.draggy?.pricing;
    if (!pricing) return;
    let live = true;
    const load = () =>
      pricing
        .rates()
        .then((answer) => {
          if (live) setDisplayMoney(resolveDisplayMoney(displayCurrency, answer?.success ? answer.rates?.rates : null));
        })
        .catch(swallowed("app", "costs show in dollars without rates"));
    void load();
    // A refreshed table changes what replies cost; forget the cached one and pick the new rates up.
    const stop = pricing.onUpdated?.(() => {
      turnPricer.reset();
      void load();
    });
    return () => {
      live = false;
      if (typeof stop === "function") stop();
    };
  }, [displayCurrency]);

  // The image engine runs in the main process, which keeps no settings of its own.
  useEffect(() => {
    if (isSplashMode) return;
    window.draggy?.sd
      ?.configure({
        model: settings.imageModel.source === "local" ? settings.imageModel.model : "",
        resolution: settings.imageResolution,
        cloud: settings.imageModel.source === "cloud" ? { provider: settings.imageModel.provider ?? "", model: settings.imageModel.model } : null,
      })
      .catch(swallowed("app", "the main process already logged this call"));
  }, [settings.imageModel.source, settings.imageModel.provider, settings.imageModel.model, settings.imageResolution, isSplashMode]);

  // Matching the system means following it while the app is open, not just reading it once.
  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
    const apply = () => {
      const theme = resolveTheme(settings.theme, query?.matches ?? true);
      document.body.classList.toggle("dark", theme === "dark");
      applyAccent(settings.accent, theme === "dark");
    };
    apply();
    if (settings.theme !== "system" || !query) return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings.theme, settings.accent]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
    document.documentElement.dir = "ltr";

    document.documentElement.style.setProperty(
      "--chat-font-size",
      FONT_SIZES[settings.fontSize],
    );
  }, [settings.fontSize, settings.language]);

  return [settings, setSettings] as const;
}
