import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Logo from "../Logo";
import StartupScreen from "../StartupScreen";
import { ConfirmDialog } from "../settings/Controls";
import { useTranslator } from "../i18n";
import { languages } from "../translations";
import { SETTINGS_KEY } from "../storage";
import { displayModelName } from "../llama";
import { adoptInstalled, planFirstDownload, type FirstDownloadPlan } from "../boot/bootSequence";
import type { AppSettings, OnboardingPath } from "../types";
import { canContinue, nextStep, previousStep, stepsFor, type StepId } from "./flow";
import { localeToLanguage } from "./locale";
import { fill } from "./text";
import { useFirstDownload } from "./useFirstDownload";
import DownloadBar from "./DownloadBar";
import Welcome from "./steps/Welcome";
import Appearance from "./steps/Appearance";
import LocalModel, { type ModelChoice } from "./steps/LocalModel";
import Ready from "./steps/Ready";

interface OnboardingProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onFinish: (model: string) => void;
}

interface Surroundings {
  plan: FirstDownloadPlan;
  installed: string | null;
  modelsDir: string;
}

const CODES = languages.map((language) => language.code);

/** The first-run setup, in the main window. Nothing downloads until the Local model step's Continue,
 * and Skip, on every screen, runs the splash's own automatic setup instead. */
export default function Onboarding({ settings, onUpdateSettings, onFinish }: OnboardingProps) {
  const t = useTranslator(settings.language);
  const api = window.electronAPI;
  const download = useFirstDownload(api);
  const steps = useMemo(() => stepsFor("local"), []);

  const [step, setStep] = useState<StepId>(steps[0]);
  const [surroundings, setSurroundings] = useState<Surroundings | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // Read before the first save, so only a language never chosen is guessed from the system.
  const [firstVisit] = useState(() => {
    try {
      return localStorage.getItem(SETTINGS_KEY) === null;
    } catch {
      return false;
    }
  });
  const loadingRef = useRef<Promise<Surroundings> | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api?.onboarding?.start().catch(() => undefined);
    if (firstVisit && settings.language === "en") {
      const guessed = localeToLanguage(navigator.language, CODES);
      if (guessed !== "en") onUpdateSettings({ language: guessed });
    }
    // Once, on arrival: later language changes are the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const probeOnline = useCallback(() => {
    api
      ?.checkInternet?.()
      .then((result) => setOnline(Boolean(result)))
      .catch(() => setOnline(false));
  }, [api]);

  /** Hardware, free space and any model already on disk: all local, asked once. */
  const loadSurroundings = useCallback(() => {
    if (!loadingRef.current) {
      loadingRef.current = (async () => {
        const [plan, installed, status] = await Promise.all([
          planFirstDownload(api ?? {}),
          api ? adoptInstalled(api, settings.modelName) : Promise.resolve(null),
          api?.gguf?.status().catch(() => null),
        ]);
        const loaded = { plan, installed, modelsDir: status?.modelsDir ?? "" };
        setSurroundings(loaded);
        setChoice(
          (current) =>
            current ??
            (installed
              ? { reference: installed, label: displayModelName(installed), fitsOnDisk: true, installed }
              : {
                  reference: plan.recommended.reference,
                  label: plan.recommended.label,
                  fitsOnDisk: plan.recommended.fitsOnDisk,
                  sizeBytes: plan.recommended.sizeBytes,
                }),
        );
        return loaded;
      })();
    }
    return loadingRef.current;
  }, [api, settings.modelName]);

  useEffect(() => {
    if (step !== "local") return;
    void loadSurroundings();
    if (online === null) probeOnline();
    // The check runs when the step opens and on Retry, not on every render of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Settings remember a model by its file, which is only known once the download resolves.
  const finished = download.model.phase === "done" ? download.model.filename : undefined;
  useEffect(() => {
    if (finished && finished !== settings.modelName) onUpdateSettings({ modelName: finished });
  }, [finished, settings.modelName, onUpdateSettings]);

  const flowState = useMemo(
    () => ({
      online,
      choice,
      modelOnDisk: download.model.phase === "done",
      engineReady: download.engine.phase === "done",
    }),
    [online, choice, download.model.phase, download.engine.phase],
  );
  const allowed = canContinue(step, flowState);
  const isFirst = step === steps[0];

  const goTo = useCallback((target: StepId) => setStep(target), []);

  const next = useCallback(() => {
    if (!canContinue(step, flowState)) return;
    if (step === "local" && choice) download.chooseModel(choice.reference, choice.installed);
    setStep(nextStep(steps, step));
  }, [step, flowState, choice, download, steps]);

  const back = useCallback(() => setStep((current) => previousStep(steps, current)), [steps]);

  const finish = useCallback(
    async (path: OnboardingPath, model: string) => {
      await api?.onboarding?.complete(path).catch(() => undefined);
      onFinish(model);
    },
    [api, onFinish],
  );

  const openSkip = useCallback(async () => {
    await loadSurroundings().catch(() => undefined);
    setConfirmSkip(true);
  }, [loadSurroundings]);

  const skip = useCallback(async () => {
    setConfirmSkip(false);
    download.cancelAll();
    await download.engineIdle();
    setSkipping(true);
  }, [download]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const root = stepRef.current;
      const target =
        root?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not(:disabled)') ??
        root?.querySelector<HTMLElement>("button:not(:disabled), input, [tabindex]:not([tabindex='-1'])");
      target?.focus();
    }, 220);
    return () => clearTimeout(timer);
  }, [step]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (confirmSkip || skipping) return;
    const target = event.target as HTMLElement;
    if (event.key === "Enter") {
      // A radio or the page itself continues; any other control keeps its own Enter.
      const plain = target === event.currentTarget || target.getAttribute("role") === "radio";
      if (!plain || step === "ready") return;
      event.preventDefault();
      next();
    } else if (event.key === "Escape") {
      if (document.querySelector('[role="listbox"]') || isFirst) return;
      event.preventDefault();
      back();
    }
  };

  if (skipping) {
    return (
      <div className="w-screen h-screen overflow-hidden flex bg-[var(--bg-base)] text-[var(--text-main)]">
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={(model) => void finish("skipped", model)}
        />
      </div>
    );
  }

  const gb = (bytes: number) =>
    `${new Intl.NumberFormat(settings.language, { maximumFractionDigits: 1 }).format(bytes / 1e9)} GB`;
  const skipBody = [
    surroundings?.installed
      ? t("onbSkipBodyInstalled")
      : fill(t("onbSkipBody"), { size: surroundings ? gb(surroundings.plan.recommended.sizeBytes) : "?" }),
    online === false ? t("onbSkipOffline") : "",
  ]
    .filter(Boolean)
    .join(" ");

  const themeLabel = { light: t("light"), dark: t("dark"), system: t("themeSystem") }[settings.theme];
  const sizeLabel = { sm: t("textSmall"), base: t("textMedium"), lg: t("textLarge") }[settings.fontSize];
  const summary = [
    { label: t("language"), value: languages.find((entry) => entry.code === settings.language)?.name ?? settings.language, step: "welcome" as const },
    { label: t("theme"), value: `${themeLabel} · ${sizeLabel}`, step: "appearance" as const },
    { label: t("model"), value: choice?.label ?? "", step: "local" as const },
  ];

  return (
    <div
      className="w-screen h-screen overflow-hidden flex flex-col bg-[var(--bg-base)] text-[var(--text-main)]"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <header className="flex-shrink-0 flex flex-col items-center gap-3 pt-8 pb-4">
        <Logo className="w-9 h-9 text-[var(--text-main)]" />
        <div aria-label={t("onbProgress")} role="group" className="flex items-center gap-2">
          {steps.map((id) => (
            <span
              key={id}
              aria-current={id === step ? "step" : undefined}
              className={`h-2 rounded-full transition-all ${
                id === step ? "w-6 bg-[var(--text-main)]" : steps.indexOf(id) < steps.indexOf(step) ? "w-2 bg-[var(--text-main)]" : "w-2 bg-[var(--border-light)]"
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            ref={stepRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-auto w-full max-w-[560px] px-6 py-4"
          >
            {step === "welcome" && (
              <Welcome language={settings.language} onLanguage={(language) => onUpdateSettings({ language })} t={t} />
            )}
            {step === "appearance" && (
              <Appearance
                theme={settings.theme}
                fontSize={settings.fontSize}
                onTheme={(theme) => onUpdateSettings({ theme })}
                onFontSize={(fontSize) => onUpdateSettings({ fontSize })}
                t={t}
              />
            )}
            {step === "local" && (
              <LocalModel
                plan={surroundings?.plan ?? null}
                installed={surroundings?.installed ?? null}
                modelsDir={surroundings?.modelsDir ?? ""}
                online={online}
                onRetryOnline={() => {
                  setOnline(null);
                  probeOnline();
                }}
                choice={choice}
                onChoose={setChoice}
                language={settings.language}
                t={t}
              />
            )}
            {step === "ready" && (
              <Ready
                summary={summary}
                onEdit={goTo}
                download={download}
                canStart={allowed}
                onStart={() => {
                  if (finished) void finish("local", finished);
                }}
                language={settings.language}
                t={t}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="flex-shrink-0">
        <div className="mx-auto w-full max-w-[560px] px-6 py-4 flex items-center gap-3">
          {!isFirst && (
            <button type="button" onClick={back} className="ui-btn-ghost px-4 py-2">
              {t("onbBack")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void openSkip()}
            className="mr-auto text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] underline-offset-2 hover:underline"
          >
            {t("onbSkip")}
          </button>
          {step !== "ready" && (
            <button type="button" onClick={next} disabled={!allowed} className="ui-btn px-6 py-2 disabled:opacity-40 disabled:cursor-not-allowed">
              {t("onbContinue")}
            </button>
          )}
        </div>
        {step !== "ready" && <DownloadBar download={download} language={settings.language} t={t} />}
      </footer>

      {confirmSkip && (
        <ConfirmDialog
          title={t("onbSkipTitle")}
          body={skipBody}
          confirmLabel={t("onbSkipConfirm")}
          cancelLabel={t("cancel")}
          tone="primary"
          onConfirm={() => void skip()}
          onCancel={() => setConfirmSkip(false)}
        />
      )}
    </div>
  );
}
