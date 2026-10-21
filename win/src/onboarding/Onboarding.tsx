import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StartupScreen from "../StartupScreen";
import { formatBytes } from "../formatBytes";
import { ConfirmDialog } from "../settings/Controls";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons/Icon";
import { useTranslator } from "../i18n";
import { languages } from "../translations";
import { SETTINGS_KEY } from "../storage";
import { displayModelName } from "../llama";
import { MODE_KEY, type AppMode } from "../app/modes";
import { writeLocalStorage } from "../utils";
import { tierFor } from "../voice/talkModel";
import { installedMatch, tierForEmbed } from "../embedModel";
import { adoptInstalled, planFirstDownload, type FirstDownloadPlan } from "../boot/bootSequence";
import { getRecommendedImageModel } from "../images/imageRecommendations";
import type { AppSettings, OnboardingPath, SystemSpecs } from "../types";
import { useProviders } from "../providers/useProviders";
import { canContinue, nextStep, previousStep, stepsFor, type SetupPath, type StepId } from "./flow";
import { localeToLanguage } from "./locale";
import { fill } from "./text";
import type { FirstDownload } from "./useFirstDownload";
import DownloadBar from "./DownloadBar";
import Welcome from "./steps/Welcome";
import Appearance from "./steps/Appearance";
import AiSource from "./steps/AiSource";
import LocalModel, { type ModelChoice } from "./steps/LocalModel";
import Provider from "./steps/Provider";
import Ready from "./steps/Ready";
import Preferences, { type ExtraKind, type ExtraOffer } from "./steps/Preferences";
import { swallowed } from "../logger";

export interface SetupOutcome {
  path: OnboardingPath;
  /** A suggested first message, for the composer, not sent. */
  prompt?: string;
}

interface OnboardingProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  /** Held by the app, so a download started here carries on once the app has opened. */
  download: FirstDownload;
  /** The local path is recorded by the app once the model is on disk; Skip's is recorded here. */
  onFinish: (model: string, outcome: SetupOutcome) => void;
}

interface Surroundings {
  plan: FirstDownloadPlan;
  installed: string | null;
  installedFiles: string[];
  /** Files of the image models already installed, for spotting the image rung on disk. */
  imageFiles: string[];
  modelsDir: string;
}

const EXTRA_KINDS = ["voice", "library", "image"] as const;
const EXTRA_LABELS = { voice: "onbExtraVoice", library: "onbExtraLibrary", image: "onbExtraImage" } as const;

/** The extra each kind downloads on this machine, as its own feature would size it on first use. */
function extraTiers(specs: SystemSpecs | null | undefined) {
  const vram = specs?.vram ?? 0;
  const image = getRecommendedImageModel(vram, { platform: specs?.platform, arch: specs?.arch, ram: specs?.ram, cpuModel: specs?.cpu });
  return {
    voice: tierFor(vram),
    library: tierForEmbed(vram),
    image: { model: image.filename, reference: image.reference, label: image.label, downloadGB: image.sizeGB },
  };
}

const CODES = languages.map((language) => language.code);

/** The first-run setup, in the main window. Nothing downloads until the Local model step's Continue,
 * and Skip, on every screen, runs the splash's own automatic setup instead. */
export default function Onboarding({ settings, onUpdateSettings, download, onFinish }: OnboardingProps) {
  const t = useTranslator(settings.language);
  const api = window.electronAPI;
  const [path, setPath] = useState<SetupPath>("local");
  const steps = useMemo(() => stepsFor(path), [path]);
  const providers = useProviders({ scanOnOpen: false });

  const [step, setStep] = useState<StepId>(steps[0]);
  const [surroundings, setSurroundings] = useState<Surroundings | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [providerModel, setProviderModel] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [mode, setMode] = useState<AppMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "code" ? "code" : "chat";
    } catch {
      return "chat";
    }
  });
  const [extrasChosen, setExtrasChosen] = useState<Record<ExtraKind, boolean>>({ voice: false, library: false, image: false });
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
    api?.onboarding?.start().catch(swallowed("onboarding", "the main process already logged this call"));
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
        const [plan, installed, status, listing, images] = await Promise.all([
          planFirstDownload(api ?? {}),
          api ? adoptInstalled(api, settings.modelName) : Promise.resolve(null),
          api?.gguf?.status().catch(swallowed("onboarding", "the main process already logged this call", null)),
          api?.gguf?.listModels().catch(() => []),
          api?.sd?.status().catch(swallowed("onboarding", "the main process already logged this call", null)),
        ]);
        const installedFiles = (listing ?? []).map((entry) => entry.filename);
        const imageFiles = (images?.models ?? [])
          .filter((entry) => entry.installed)
          .flatMap((entry) => entry.files.map((file) => file.filename));
        const loaded = { plan, installed, installedFiles, imageFiles, modelsDir: status?.modelsDir ?? "" };
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
    if (step !== "source" && step !== "local") return;
    void loadSurroundings();
    if (online === null) probeOnline();
    // Loopback only, and only as the step opens (providers spec rule 4, decision 4).
    if (step === "source") void providers.scan();
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
      path,
      online,
      choice,
      modelOnDisk: download.model.phase === "done",
      modelUnderWay: download.model.phase === "downloading" && Boolean(download.model.filename),
      engineReady: download.engine.phase === "done",
      engineUnderWay: download.engine.phase === "running",
      providerModel,
    }),
    [path, online, choice, download.model.phase, download.model.filename, download.engine.phase, providerModel],
  );
  const allowed = canContinue(step, flowState);
  const isFirst = step === steps[0];

  const goTo = useCallback((target: StepId) => setStep(target), []);

  const offers = useMemo((): Record<ExtraKind, ExtraOffer | null> => {
    if (!surroundings) return { voice: null, library: null, image: null };
    const tiers = extraTiers(surroundings.plan.specs);
    const offer = (tier: { model: string; reference: string; label: string; downloadGB: number }): ExtraOffer => ({
      label: tier.label,
      sizeBytes: tier.downloadGB * 1e9,
      // The chosen model can double as the voice one, and then there is nothing to fetch.
      installed: Boolean(installedMatch(tier.model, surroundings.installedFiles)) || tier.reference === choice?.reference,
    });
    return {
      voice: offer(tiers.voice),
      library: offer(tiers.library),
      image: { ...offer(tiers.image), installed: surroundings.imageFiles.includes(tiers.image.model) },
    };
  }, [surroundings, choice]);

  const chooseMode = useCallback((next: AppMode) => {
    setMode(next);
    writeLocalStorage(MODE_KEY, next);
  }, []);

  const next = useCallback(() => {
    if (!canContinue(step, flowState)) return;
    if (step === "local" && choice) download.chooseModel(choice.reference, choice.installed);
    // The engine still installs for the Library and voice; no model of Draggy's own is fetched.
    if (step === "provider" && path === "provider") download.withoutModel();
    if (step === "preferences" && surroundings) {
      const tiers = extraTiers(surroundings.plan.specs);
      for (const kind of EXTRA_KINDS) {
        const tier = tiers[kind];
        if (extrasChosen[kind] && !offers[kind]?.installed) {
          download.queueExtra(tier.reference, tier.label, kind === "image" ? "image" : "model");
        }
        else download.dropExtra(tier.reference);
      }
    }
    setStep(nextStep(steps, step));
  }, [step, flowState, choice, download, path, steps, surroundings, extrasChosen, offers]);

  const back = useCallback(() => setStep((current) => previousStep(steps, current)), [steps]);

  const finish = useCallback(
    async (path: OnboardingPath, model: string, prompt?: string) => {
      // A provider's model needs nothing on disk; the local and both paths are recorded once it lands.
      if (path === "skipped" || path === "provider") await api?.onboarding?.complete(path).catch(swallowed("onboarding", "the main process already logged this call"));
      onFinish(model, { path, prompt });
    },
    [api, onFinish],
  );

  const openSkip = useCallback(async () => {
    await loadSurroundings().catch(swallowed("onboarding", "the main process already logged this call"));
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
      <div className="flex h-screen w-screen overflow-hidden bg-surface-canvas text-text-primary">
        <StartupScreen
          modelName={settings.modelName}
          language={settings.language}
          onReady={(model) => void finish("skipped", model)}
        />
      </div>
    );
  }

  const gb = (bytes: number) => formatBytes(bytes, settings.language);
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
    { label: t("language"), value: languages.find((entry) => entry.code === settings.language)?.name ?? settings.language, step: "appearance" as const },
    { label: t("theme"), value: `${themeLabel} · ${sizeLabel}`, step: "appearance" as const },
    ...(path === "provider" ? [] : [{ label: t("model"), value: choice?.label ?? "", step: "local" as const }]),
    ...(path === "local" ? [] : [{ label: t("providers"), value: providerModel ? displayModelName(providerModel) : "", step: "provider" as const }]),
    {
      label: t("onbPrefsTitle"),
      value: [
        t(mode === "code" ? "codeMode" : "chatMode"),
        ...EXTRA_KINDS.filter((kind) => extrasChosen[kind] && !offers[kind]?.installed).map((kind) => t(EXTRA_LABELS[kind])),
      ].join(" · "),
      step: "preferences" as const,
    },
  ];

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-surface-canvas text-text-primary outline-none"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <header className="flex flex-shrink-0 justify-center pb-2 pt-10">
        <div aria-label={t("onbProgress")} role="group" className="flex items-center gap-1.5">
          {steps.map((id) => {
            const index = steps.indexOf(id);
            const current = steps.indexOf(step);
            return (
              <span
                key={id}
                aria-current={id === step ? "step" : undefined}
                className={`h-1 rounded-pill transition-[width,background-color] duration-200 ${
                  id === step ? "w-5 bg-text-primary" : index < current ? "w-1.5 bg-text-secondary" : "w-1.5 bg-rule-strong"
                }`}
              />
            );
          })}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div key={step} ref={stepRef} className="fade-in mx-auto w-full max-w-[560px] px-6 py-8">
          {step === "welcome" && <Welcome t={t} />}
          {step === "appearance" && (
            <Appearance
              theme={settings.theme}
              accent={settings.accent}
              fontSize={settings.fontSize}
              language={settings.language}
              onTheme={(theme) => onUpdateSettings({ theme })}
              onAccent={(accent) => onUpdateSettings({ accent })}
              onFontSize={(fontSize) => onUpdateSettings({ fontSize })}
              onLanguage={(language) => onUpdateSettings({ language })}
              t={t}
            />
          )}
          {step === "source" && (
            <AiSource
              path={path}
              onPath={setPath}
              plan={surroundings?.plan ?? null}
              installed={surroundings?.installed ?? null}
              online={online}
              onRetryOnline={() => {
                setOnline(null);
                probeOnline();
              }}
              servers={providers.servers}
              language={settings.language}
              t={t}
            />
          )}
          {step === "local" && (
            <LocalModel
              plan={surroundings?.plan ?? null}
              installed={surroundings?.installed ?? null}
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
          {step === "provider" && <Provider providers={providers} model={providerModel} onModel={setProviderModel} t={t} />}
          {step === "preferences" && (
            <Preferences
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              mode={mode}
              onMode={chooseMode}
              offers={offers}
              chosen={extrasChosen}
              onExtra={(kind, on) => setExtrasChosen((current) => ({ ...current, [kind]: on }))}
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
              moreProviders={path !== "local"}
              onStart={(prompt) => {
                if (path === "provider") {
                  if (providerModel) void finish("provider", providerModel, prompt);
                } else if (download.model.filename) void finish(path, download.model.filename, prompt);
              }}
              language={settings.language}
              t={t}
            />
          )}
        </div>
      </main>

      <footer className="flex-shrink-0">
        <div className="mx-auto flex w-full max-w-[560px] items-center gap-2 px-6 py-5">
          {!isFirst && (
            <Button variant="secondary" onClick={back} icon={<Icon name="arrow-left" size={14} />}>
              {t("onbBack")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => void openSkip()} className="me-auto">
            {t("onbSkip")}
          </Button>
          {step !== "ready" && (
            <Button onClick={next} disabled={!allowed} className="min-w-28">
              {t("onbContinue")}
            </Button>
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
