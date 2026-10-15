import { useCallback, useEffect, useRef, useState } from "react";
import { formatTransferred } from "./formatBytes";
import { translations } from "./translations";
import { autoSetup, BootError, bootErrorText, type BootProgress } from "./boot/bootSequence";
import { displayModelName } from "./llama";
import { Button } from "./ui/Button";
import { Icon } from "./ui/icons/Icon";
import { ProgressLine } from "./ui/ProgressLine";
import { EmberMark } from "./ui/signature/EmberMark";
import { Fuse } from "./ui/signature/Fuse";
import { swallowed } from "./logger";

/** The last lines of app.log, since a failed start may never reach the Diagnostics page. */
function RecentLog({ label }: { label: string }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    Promise.resolve(window.electronAPI?.readLogs?.("app", 16 * 1024) ?? "")
      .then((text) => setLines(text.split("\n").filter(Boolean).slice(-30)))
      .catch(swallowed("boot", "the log tail is optional on the failure screen"));
  }, []);
  if (!lines.length) return null;
  return (
    <pre aria-label={label} className="max-h-40 w-full select-text overflow-auto rounded-sm bg-surface-raised p-2 text-start font-mono text-[11px] leading-4 text-text-secondary">
      {lines.join("\n")}
    </pre>
  );
}

interface StartupScreenProps {
  modelName: string;
  language: string;
  onReady: (model: string) => void;
  /** Leaves the setup for Settings, Providers. Returning users only: a new install has its own step. */
  onUseProvider?: () => void;
}

/** Steps that move bytes over the network rather than work on this machine. */
const NETWORK_STEPS = new Set(["preparingDownload", "downloadingModel"]);

/** The splash: the dragon in ink with embers coming off it while the engine loads, one line saying
 * what is happening, and a line under it that only fills when the work reports how far it is. */
export default function StartupScreen({ modelName, language, onReady, onUseProvider }: StartupScreenProps) {
  const t = useCallback(
    (key: string) => translations[language]?.[key] || translations["en"][key] || key,
    [language],
  );

  const [step, setStep] = useState("initializing");
  const [progress, setProgress] = useState<BootProgress | null>(null);
  const [error, setError] = useState<{ message: string; disk: boolean } | null>(null);

  const bootedRef = useRef(false);
  const tRef = useRef(t);
  const stateRef = useRef({ step, failed: false });
  useEffect(() => {
    tRef.current = t;
    stateRef.current = { step, failed: Boolean(error) };
  });

  useEffect(() => {
    const update = (p: Partial<BootProgress>) => {
      setProgress((prev) => ({
        percent: Number(p.percent) || 0,
        completed: Number(p.completed) || 0,
        total: Number(p.total) || prev?.total || 0,
        label: p.label || prev?.label || "GGUF",
      }));
    };
    const stopGguf = window.electronAPI?.gguf?.onProgress?.(update);
    const stopDownload = window.electronAPI?.onDownloadProgress?.(update);
    return () => {
      stopGguf?.();
      stopDownload?.();
    };
  }, []);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    if (!window.electronAPI) {
      setError({ message: tRef.current("outsideElectron"), disk: false });
      return;
    }

    autoSetup(window.electronAPI, modelName, setStep, setProgress)
      .then(onReady)
      .catch((err: unknown) => {
        setError({
          message: bootErrorText(err, (key) => tRef.current(key)),
          disk: err instanceof BootError && Boolean(err.disk),
        });
      });
  }, [modelName, onReady]);

  /** Engine work burns brightest; a download is waiting on the network, so the dragon idles. */
  const heat = useCallback(() => {
    const { step: current, failed } = stateRef.current;
    if (failed) return 0;
    return NETWORK_STEPS.has(current) ? 0.22 : 0.5;
  }, []);

  const network = NETWORK_STEPS.has(step);
  const measured = progress !== null && progress.total > 0;
  const fraction = measured ? progress.percent / 100 : undefined;
  const name = modelName ? displayModelName(modelName) : "";
  const status =
    (step === "startingService" || step === "systemCheckComplete") && name
      ? t("loadingNamedModel").replace("{model}", name)
      : t(step);

  return (
    <div className="flex h-full w-full select-none flex-col items-center overflow-hidden bg-surface-canvas text-text-primary">
      <main className="flex min-h-0 w-full flex-1 flex-col items-center justify-center px-8">
        {error ? (
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <Icon name={error.disk ? "hard-drive" : "warning-circle"} size={32} className="text-danger" />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[15px] font-semibold leading-6">{t("startupFailed")}</h1>
              <p role="alert" className="text-[13px] leading-5 text-text-secondary">
                {error.message}
              </p>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="primary" onClick={() => window.location.reload()}>
                {t("retry")}
              </Button>
              <Button variant="secondary" onClick={() => window.electronAPI?.quitApp()}>
                {t("quit")}
              </Button>
            </div>
            {window.electronAPI && (
              <Button variant="ghost" size="dense" onClick={() => void window.electronAPI?.openLogs()}>
                {t("openLogFolder")}
              </Button>
            )}
            <RecentLog label={t("diagnostics")} />
          </div>
        ) : (
          <>
            <EmberMark heat={heat} />
            <p role="status" className="mt-2 min-h-5 text-center text-[14px] leading-5 text-text-secondary">
              {status}
            </p>
            <div className="mt-4 w-full max-w-[220px]">
              {network ? (
                <>
                  <ProgressLine progress={fraction} label={status} />
                  {measured && (
                    <p className="mt-2 flex justify-between gap-3 text-[12px] leading-4 text-text-tertiary">
                      <span className="min-w-0 truncate">{progress.label}</span>
                      <span className="flex-shrink-0 tabular-nums">
                        {formatTransferred(progress.completed, progress.total)}
                      </span>
                    </p>
                  )}
                </>
              ) : (
                <Fuse progress={fraction} label={status} />
              )}
            </div>
          </>
        )}
      </main>

      {onUseProvider && (
        <footer className="pb-6">
          <Button variant="ghost" size="dense" onClick={onUseProvider}>
            {t("useProviderInstead")}
          </Button>
        </footer>
      )}
    </div>
  );
}
