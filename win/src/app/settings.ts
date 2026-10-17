import { useEffect, useState } from "react";
import type { AppSettings } from "../types";
import { SETTINGS_KEY, storageBackend } from "../storage";
import { safeJsonParse, writeLocalStorage } from "../utils";
import { swallowed } from "../logger";
import { EFFORT_DEFAULT, effortFromLegacy, isEffortLevel } from "../ai/effort";

/** Thinking modes before the five effort levels, and the key each one became. */
const LEGACY_EFFORT_KEYS = [
  ["thinkingMode", "effort"],
  ["codeThinkingMode", "codeEffort"],
] as const;

export const defaultSettings: AppSettings = {
  // Only a new install gets this: anyone with saved settings keeps the theme they saved.
  theme: "system",
  fontSize: "base",
  language: "en",
  // Empty means "not chosen yet": the startup screen adopts whatever is
  // already installed, and sizes a model to the graphics card if nothing is.
  modelName: "",
  customInstructions: [],
  effort: EFFORT_DEFAULT,
  allowMaxInChat: false,
  slowModelThinking: false,
  colibriLossy: false,
  webMode: "auto",
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
  codeModel: "",
  codeInstructions: [],
  codeEffort: EFFORT_DEFAULT,
  codeWebMode: "auto",
  codePermissionMode: "acceptEdits",
  libraryEnabled: true,
  embedModel: "",
  showMetrics: false,
  autoUpdate: true,
  compactLimit: null,
  fixedContextSize: null,
  imageModel: "",
};

export const FONT_SIZES = { sm: "13px", base: "15px", lg: "18px" };

export function resolveTheme(setting: AppSettings["theme"], prefersDark: boolean): "light" | "dark" {
  if (setting === "system") return prefersDark ? "dark" : "light";
  return setting === "light" ? "light" : "dark";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

let legacyBraveKey = "";

const VOICE_MIGRATED_KEY = "draggy.voiceEngineDefault";
const VALID_LANGUAGES =new Set(["en", "fr", "es", "zh"]);

/** Read synchronously from localStorage rather than awaited from sqlite: the first paint needs the
 * theme and the language before any IPC can answer. */
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
  // Every build is a full release now, so there is no channel to choose.
  if ("updateChannel" in parsed) {
    delete (parsed as { updateChannel?: unknown }).updateChannel;
    migrated = true;
  }
  if (parsed.language && !VALID_LANGUAGES.has(parsed.language)) {
    parsed.language = "en";
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
  for (const key of ["modelName", "codeModel"] as const) {
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
  for (const key of ["effort", "codeEffort"] as const) {
    if (key in legacy && !isEffortLevel(legacy[key])) {
      legacy[key] = EFFORT_DEFAULT;
      migrated = true;
    }
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

  useEffect(() => {
    if (isSplashMode) return;

    writeLocalStorage(SETTINGS_KEY, JSON.stringify(settings));
    storageBackend()
      .saveSettings(settings)
      .catch(swallowed("app", "best effort, the screen works without it"));
  }, [settings, isSplashMode]);

  useEffect(() => {
    window.electronAPI
      ?.setSearchConfig({
        searchProvider: settings.searchProvider,
        searxngUrl: settings.searxngUrl,
      })
      .catch(swallowed("app", "the main process already logged this call"));
  }, [settings.searchProvider, settings.searxngUrl]);

  useEffect(() => {
    const key = legacyBraveKey;
    legacyBraveKey = "";
    const api = window.electronAPI;
    if (!key || !api?.braveKeyStatus) return;
    // Main has usually moved it already, from its own copy; a key set since then is never replaced.
    void api
      .braveKeyStatus()
      .then((status) => (status.hasKey ? undefined : api.setBraveKey(key)))
      .catch(swallowed("app", "the main process already logged this call"));
  }, []);

  // The main process owns the update schedule, so it has to be told what the
  // setting says, at startup as much as when it is changed.
  useEffect(() => {
    if (isSplashMode || holdUpdates) return;
    window.electronAPI?.updater
      .configure({ automatic: settings.autoUpdate })
      .catch(swallowed("app", "the main process already logged this call"));
  }, [settings.autoUpdate, isSplashMode, holdUpdates]);

  // The image engine runs in the main process, which keeps no settings of its own.
  useEffect(() => {
    if (isSplashMode) return;
    window.electronAPI?.sd
      ?.configure({ model: settings.imageModel })
      .catch(swallowed("app", "the main process already logged this call"));
  }, [settings.imageModel, isSplashMode]);

  // Matching the system means following it while the app is open, not just reading it once.
  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
    const apply = () => {
      const theme = resolveTheme(settings.theme, query?.matches ?? true);
      document.body.classList.toggle("dark", theme === "dark");
    };
    apply();
    if (settings.theme !== "system" || !query) return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings.theme]);

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
