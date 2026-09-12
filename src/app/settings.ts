import { useEffect, useState } from "react";
import type { AppSettings } from "../types";
import { SETTINGS_KEY, storageBackend } from "../storage";
import { safeJsonParse, writeLocalStorage } from "../utils";

export const defaultSettings: AppSettings = {
  theme: "light",
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
  neuralVoice: "af_heart",
  voiceRate: 1,
  searchProvider: "auto",
  searxngUrl: "",
  braveApiKey: "",
  codeExecution: false,
  libraryEnabled: true,
  embedModel: "",
  showMetrics: true,
  autoUpdate: true,
};

export const FONT_SIZES = { sm: "13px", base: "15px", lg: "18px" };

/**
 * Read synchronously from localStorage rather than awaited from sqlite: the
 * first paint needs the theme and the language before any IPC can answer.
 */
export function loadSettings(): AppSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  const parsed = saved ? safeJsonParse<Partial<AppSettings>>(saved) : null;
  return parsed ? { ...defaultSettings, ...parsed } : defaultSettings;
}

/**
 * The settings object and everything that has to happen when it changes: saved
 * in both places, pushed to the main process, and applied to the document.
 */
export function useSettings(isSplashMode: boolean) {
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
        braveApiKey: settings.braveApiKey,
      })
      .catch(() => undefined);
  }, [settings.searchProvider, settings.searxngUrl, settings.braveApiKey]);

  // The main process owns the update schedule, so it has to be told what the
  // setting says, at startup as much as when it is changed.
  useEffect(() => {
    if (isSplashMode) return;
    window.electronAPI?.updater
      .configure({ automatic: settings.autoUpdate })
      .catch(() => undefined);
  }, [settings.autoUpdate, isSplashMode]);

  useEffect(() => {
    if (settings.theme === "dark") document.body.classList.add("dark");
    else document.body.classList.remove("dark");

    document.documentElement.style.setProperty(
      "--chat-font-size",
      FONT_SIZES[settings.fontSize],
    );
  }, [settings.theme, settings.fontSize]);

  return [settings, setSettings] as const;
}
