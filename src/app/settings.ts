import { useEffect, useState } from "react";
import type { AppSettings } from "../types";
import { SETTINGS_KEY, storageBackend } from "../storage";
import { safeJsonParse, writeLocalStorage } from "../utils";

export const defaultSettings: AppSettings = {
  // Only a new install gets this: anyone with saved settings keeps the theme they saved.
  theme: "system",
  fontSize: "base",
  language: "en",
  // Empty means "not chosen yet": the startup screen adopts whatever is
  // already installed, and sizes a model to the graphics card if nothing is.
  modelName: "",
  customInstructions: [],
  thinkingMode: "medium",
  webMode: "auto",
  voiceName: "",
  voiceModel: "",
  voiceEngine: "system",
  neuralVoice: "F1",
  voiceSounds: true,
  voiceRate: 1,
  searchProvider: "auto",
  searxngUrl: "",
  codeModel: "",
  codeInstructions: [],
  codeThinkingMode: "medium",
  codeWebMode: "auto",
  codePermissionMode: "acceptEdits",
  libraryEnabled: true,
  embedModel: "",
  showMetrics: false,
  autoUpdate: true,
  compactLimit: null,
  fixedContextSize: null,
  updateChannel: "release",
};

export const FONT_SIZES = { sm: "13px", base: "15px", lg: "18px" };

export function resolveTheme(setting: AppSettings["theme"], prefersDark: boolean): "light" | "dark" {
  if (setting === "system") return prefersDark ? "dark" : "light";
  return setting === "light" ? "light" : "dark";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

let legacyBraveKey = "";

/** Read synchronously from localStorage rather than awaited from sqlite: the first paint needs the
 * theme and the language before any IPC can answer. */
export function loadSettings(): AppSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  const parsed = saved ? safeJsonParse<Partial<AppSettings> & { braveApiKey?: string }>(saved) : null;
  if (!parsed) return defaultSettings;
  // Earlier versions kept the Brave key here in the clear; it leaves for the keystore on the first save.
  if ("braveApiKey" in parsed) {
    legacyBraveKey = String(parsed.braveApiKey || "").trim();
    delete parsed.braveApiKey;
  }

  // Earlier versions saved the speed line switched on without anyone asking for it.
  return parsed.metricsChosen ? { ...defaultSettings, ...parsed } : { ...defaultSettings, ...parsed, showMetrics: false };
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
      .catch(() => undefined);
  }, [settings, isSplashMode]);

  useEffect(() => {
    window.electronAPI
      ?.setSearchConfig({
        searchProvider: settings.searchProvider,
        searxngUrl: settings.searxngUrl,
      })
      .catch(() => undefined);
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
      .catch(() => undefined);
  }, []);

  // The main process owns the update schedule, so it has to be told what the
  // setting says, at startup as much as when it is changed.
  useEffect(() => {
    if (isSplashMode || holdUpdates) return;
    window.electronAPI?.updater
      .configure({ automatic: settings.autoUpdate, channel: settings.updateChannel })
      .catch(() => undefined);
  }, [settings.autoUpdate, settings.updateChannel, isSplashMode, holdUpdates]);

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
    document.documentElement.dir = settings.language === "ar" ? "rtl" : "ltr";

    document.documentElement.style.setProperty(
      "--chat-font-size",
      FONT_SIZES[settings.fontSize],
    );
  }, [settings.fontSize, settings.language]);

  return [settings, setSettings] as const;
}
