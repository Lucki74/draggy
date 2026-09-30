import { useCallback, useEffect, useMemo, useState } from "react";
import StartupScreen from "./StartupScreen";
import Onboarding, { type SetupOutcome } from "./onboarding/Onboarding";
import { useFirstDownload } from "./onboarding/useFirstDownload";
import { MODE_KEY } from "./app/modes";
import { writeLocalStorage } from "./utils";
import AppShell from "./app/AppShell";
import { useSettings } from "./app/settings";
import { warmModel } from "./llama";
import { isRemote } from "./ai/providers";
import { registerBuiltinTools } from "./tools/builtin";
import { registerFileTools } from "./tools/files";
import { registerPlanTools } from "./tools/plan";
import { registerSkillTools } from "./tools/skills";
import { registerExploreTools } from "./tools/explore";
import { registerGitTools } from "./tools/git";
import { registerCommandTools } from "./tools/commands";
import { KEEP_ALIVE } from "./agent/agentLoop";
import type { AppSettings } from "./types";

registerBuiltinTools();
registerFileTools();
registerPlanTools();
registerSkillTools();
registerExploreTools();
registerGitTools();
registerCommandTools();

/** The composition root: which model is running, and therefore whether the user sees the startup
 * screen or the app. Everything else lives in `app/`. */
export default function App() {
  const isSplashMode = window.location.search.includes("splash=true");
  // Main loads the page this way only for a new install; finishing drops it, so a reload opens the app.
  const [onboarding, setOnboarding] = useState(() => window.location.search.includes("onboarding=true"));
  const [settings, setSettings] = useSettings(isSplashMode, onboarding);

  const [model, setModel] = useState<string | null>(
    isSplashMode || isRemote(settings.modelName) ? null : settings.modelName,
  );

  // The splash handed over to Settings, Providers: the app opens there, with no local model if need be.
  const [openSettingsOn, setOpenSettingsOn] = useState<"providers" | undefined>();
  useEffect(() => {
    if (isSplashMode) return;
    return window.electronAPI?.onBootOpen?.((page) => {
      if (page === "providers") setOpenSettingsOn(page);
    });
  }, [isSplashMode]);

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

  const handleUseProvider = useCallback(() => {
    window.electronAPI?.bootFinished("", "providers");
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
      if (!isRemote(selectedModel)) {
        warmModel(selectedModel, KEEP_ALIVE, 0, settings.fixedContextSize).catch(() => undefined);
      }
    },
    [setSettings, settings.fixedContextSize],
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => setSettings((prev) => ({ ...prev, ...patch })),
    [setSettings],
  );

  // Held here rather than in the setup, so a download it started carries on once the app is open.
  const firstDownload = useFirstDownload(window.electronAPI);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [landingPath, setLandingPath] = useState<"local" | "both">("local");
  const [seedPrompt, setSeedPrompt] = useState<string | undefined>();
  const usable = firstDownload.model.phase === "done" && firstDownload.engine.phase === "done";

  // The model the app opened on has arrived: remembered, then recorded and warmed below.
  if (waitingFor && usable) {
    setLanded(waitingFor);
    setWaitingFor(null);
    setSettings((prev) => (prev.modelName === waitingFor ? prev : { ...prev, modelName: waitingFor }));
  }

  useEffect(() => {
    if (!landed) return;
    // Only now: a record written before the model was on disk would skip the setup after a quit.
    window.electronAPI?.onboarding?.complete(landingPath).catch(() => undefined);
    warmModel(landed, KEEP_ALIVE, 0, settings.fixedContextSize).catch(() => undefined);
  }, [landed, landingPath, settings.fixedContextSize]);

  // The optional downloads join the app's own list once the model is in, never beside it.
  const takeOver = useMemo(
    () =>
      !onboarding && (firstDownload.model.phase === "done" || firstDownload.modelless)
        ? firstDownload.extras
            .filter((extra) => extra.phase === "queued" || extra.phase === "downloading")
            .map((extra) => extra.reference)
        : [],
    [onboarding, firstDownload.model.phase, firstDownload.modelless, firstDownload.extras],
  );

  const handleOnboardingFinish = useCallback(
    (selectedModel: string, outcome: SetupOutcome) => {
      window.history.replaceState(null, "", window.location.pathname);
      setOnboarding(false);
      // A suggested prompt is a chat one, so the app opens on Chat to show it.
      if (outcome.prompt) {
        writeLocalStorage(MODE_KEY, "chat");
        setSeedPrompt(outcome.prompt);
      }
      if (outcome.path === "skipped" || outcome.path === "provider") {
        handleModelReady(selectedModel);
        return;
      }
      setLandingPath(outcome.path === "both" ? "both" : "local");
      setModel(selectedModel);
      setWaitingFor(selectedModel);
    },
    [handleModelReady],
  );

  if (onboarding) {
    return (
      <Onboarding
        settings={settings}
        onUpdateSettings={updateSettings}
        download={firstDownload}
        onFinish={handleOnboardingFinish}
      />
    );
  }

  if (isSplashMode) {
    return (
      <div
        className="w-screen h-screen overflow-hidden flex"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={handleSplashReady}
          onUseProvider={handleUseProvider}
        />
      </div>
    );
  }

  if (!model && !openSettingsOn) {
    if (window.electronAPI) {
      return (
        <div
          className="w-screen h-screen overflow-hidden flex items-center justify-center bg-[var(--bg-base)] text-[var(--text-main)]"
        />
      );
    }

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
      model={model ?? ""}
      openSettingsOn={openSettingsOn}
      settings={settings}
      onUpdateSettings={setSettings}
      onSelectModel={handleModelReady}
      startDownloads={takeOver}
      arrivingModel={waitingFor ? firstDownload : undefined}
      seedPrompt={seedPrompt}
      onSeedUsed={() => setSeedPrompt(undefined)}
    />
  );
}
