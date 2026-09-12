import { useCallback, useEffect, useState } from "react";
import StartupScreen from "./StartupScreen";
import AppShell from "./app/AppShell";
import { useSettings } from "./app/settings";
import { isCloudModel, warmModel } from "./ollama";
import { registerBuiltinTools } from "./tools/builtin";
import { KEEP_ALIVE } from "./agent/agentLoop";

registerBuiltinTools();

/**
 * The composition root: which model is running, and therefore whether the user
 * sees the startup screen or the app. Everything else lives in `app/`.
 */
export default function App() {
  const isSplashMode = window.location.search.includes("splash=true");
  const [settings, setSettings] = useSettings(isSplashMode);

  const [model, setModel] = useState<string | null>(
    isSplashMode || isCloudModel(settings.modelName) ? null : settings.modelName,
  );

  useEffect(() => {
    if (isSplashMode) return;
    return window.electronAPI?.onBootModel((bootModel) => {
      setSettings((prev) =>
        prev.modelName === bootModel ? prev : { ...prev, modelName: bootModel },
      );
      setModel(bootModel);
    });
  }, [isSplashMode, setSettings]);

  const handleSplashReady = useCallback((selectedModel: string) => {
    window.electronAPI?.bootFinished(selectedModel);
  }, []);

  const handleModelReady = useCallback(
    (selectedModel: string) => {
      setModel(selectedModel);
      setSettings((prev) =>
        prev.modelName === selectedModel
          ? prev
          : { ...prev, modelName: selectedModel },
      );
      // Loading the weights takes seconds, and the first message is where that
      // hurts most. Sized for an empty chat; typing into a long one warms again.
      if (!isCloudModel(selectedModel)) {
        warmModel(selectedModel, KEEP_ALIVE).catch(() => undefined);
      }
    },
    [setSettings],
  );

  if (isSplashMode) {
    return (
      <div
        className="w-screen h-screen overflow-hidden flex"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={handleSplashReady}
        />
      </div>
    );
  }

  if (!model) {
    return (
      <div
        className="w-screen h-screen overflow-hidden flex"
        style={{ backgroundColor: "var(--bg-base)", color: "var(--text-main)" }}
      >
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={handleModelReady}
        />
      </div>
    );
  }

  return (
    <AppShell
      model={model}
      settings={settings}
      onUpdateSettings={setSettings}
      onSelectModel={handleModelReady}
    />
  );
}
