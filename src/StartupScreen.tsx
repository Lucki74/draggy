import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HardDrive, AlertCircle } from "lucide-react";
import { translations } from "./translations";
import { autoSetup, BootError, bootErrorText } from "./boot/bootSequence";
import Logo from "./Logo";

interface StartupScreenProps {
  modelName: string;
  language: string;
  onReady: (model: string) => void;
}

interface DownloadProgress {
  percent: number;
  completed: number;
  total: number;
  label: string;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function transferred(completed: number, total: number): string {
  const inGigabytes = total >= GB;
  const scale = inGigabytes ? GB : MB;
  const digits = inGigabytes ? 2 : 0;
  return `${(completed / scale).toFixed(digits)} / ${(total / scale).toFixed(digits)} ${inGigabytes ? "GB" : "MB"}`;
}

export default function StartupScreen({
  modelName,
  language,
  onReady,
}: StartupScreenProps) {
  const t = useCallback(
    (key: string) => {
      return translations[language]?.[key] || translations["en"][key] || key;
    },
    [language],
  );

  const [status, setStatus] = useState(() => t("initializing"));
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [error, setError] = useState<{
    message: string;
    icon: React.ReactNode;
  } | null>(null);

  const hasBootedRef = useRef(false);
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const updateProgress = (p: {
      percent: number;
      completed: number;
      total: number;
      label?: string;
    }) => {
      setDownloadProgress((prev) => ({
        percent: Number(p.percent) || 0,
        completed: Number(p.completed) || 0,
        total: Number(p.total) || prev?.total || 0,
        label: p.label || prev?.label || "GGUF",
      }));
    };

    const stopWatchingGguf = window.electronAPI?.gguf?.onProgress?.(updateProgress);
    const stopWatchingDl = window.electronAPI?.onDownloadProgress?.(updateProgress);

    return () => {
      stopWatchingGguf?.();
      stopWatchingDl?.();
    };
  }, []);

  useEffect(() => {
    if (hasBootedRef.current) return;
    hasBootedRef.current = true;

    const tr = (key: string) => tRef.current(key);

    if (!window.electronAPI) {
      setError({
        message: tr("outsideElectron"),
        icon: <AlertCircle className="w-10 h-10 text-red-400" />,
      });
      return;
    }

    autoSetup(
      window.electronAPI,
      modelName,
      (key) => setStatus(tr(key)),
      setDownloadProgress,
    )
      .then(onReady)
      .catch((err: unknown) => {
        const disk = err instanceof BootError && err.disk;
        setError({
          message: bootErrorText(err, tr),
          icon: disk ? (
            <HardDrive className="w-10 h-10 text-red-400" />
          ) : (
            <AlertCircle className="w-10 h-10 text-red-400" />
          ),
        });
      });
  }, [modelName, onReady]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-between select-none overflow-hidden bg-[var(--bg-base)] text-[var(--text-main)]">
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.div
              key="error-icon"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              className="flex items-center justify-center text-red-500"
            >
              {error.icon}
            </motion.div>
          ) : (
            <motion.div
              key="spinner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative w-24 h-24"
            >
              <Logo className="absolute inset-0 m-auto w-11 h-11 text-[var(--text-main)]" />
              <svg className="w-full h-full" viewBox="0 0 80 80" fill="none">
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  stroke="var(--border-light)"
                  strokeWidth="7"
                />
                <motion.circle
                  cx="40"
                  cy="40"
                  r="34"
                  stroke="var(--text-main)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray="60 153"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  style={{ transformOrigin: "40px 40px" }}
                />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div
            key={error ? "error-state" : status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-2 text-center"
          >
            {error ? (
              <>
                <p className="font-semibold text-base">{t("startupFailed")}</p>
                <p className="text-red-500 text-sm max-w-xs leading-relaxed">
                  {error.message}
                </p>
                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-panel)] text-xs font-bold uppercase tracking-wider hover:bg-[var(--hover-bg)] transition-colors"
                  >
                    {t("retry")}
                  </button>
                  <button
                    onClick={() => window.electronAPI?.quitApp()}
                    className="px-4 py-2 rounded-lg border-2 border-[var(--border-dark)] bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                  >
                    {t("quit")}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[var(--text-main)] text-sm font-bold tracking-wide uppercase">
                {status}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {downloadProgress && !error && (
          <motion.div
            key="dl-bar"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="w-full flex flex-col items-center pb-10 px-10 gap-2"
          >
            <div className="w-full flex justify-between text-xs text-[var(--text-muted)] mb-1 font-mono font-bold tracking-wider">
              <span className="uppercase">{downloadProgress.label}</span>
              <span>
                {downloadProgress.total > 0
                  ? transferred(
                      downloadProgress.completed,
                      downloadProgress.total,
                    )
                  : ""}
              </span>
            </div>

            <div className="w-full h-2 rounded-full overflow-hidden bg-[var(--hover-bg)] shadow-[inset_0px_1px_3px_rgba(0,0,0,0.2)]">
              {downloadProgress.total > 0 ? (
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "var(--text-main)" }}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.min(100, Math.max(0, downloadProgress.percent))}%`,
                  }}
                  transition={{ ease: "linear", duration: 0.25 }}
                />
              ) : (
                <motion.div
                  className="h-full w-1/3 rounded-full"
                  style={{ background: "var(--text-main)" }}
                  animate={{ x: ["0%", "300%"] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
            </div>

            {downloadProgress.total > 0 && (
              <p className="text-[var(--text-main)] text-xs font-bold mt-0.5 tracking-wider">
                {Math.min(100, Math.max(0, downloadProgress.percent)).toFixed(1)}%
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
