import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "../settings/Controls";
import { formatRemainingTime } from "../settings/PullProgress";
import type { FirstDownload } from "./useFirstDownload";

/** The model's download while the user carries on: pinned to the bottom of each screen, and grown
 * into the page on Ready. Only the model and the engine it needs; extras never show here. */
export default function DownloadBar({
  download,
  large,
  language,
  t,
}: {
  download: FirstDownload;
  large?: boolean;
  language: string;
  t: (key: string) => string;
}) {
  const { engine, model } = download;
  const gb = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let label = "";
  let detail = "";
  let percent = 0;
  let error = "";

  if (model.phase === "error") {
    error = `${t("downloadFailed")}: ${model.error ?? ""}`;
  } else if (engine.phase === "error") {
    error = engine.error && engine.error !== "missingGgufEngine" ? engine.error : t("missingGgufEngine");
  } else if (model.phase === "queued" || model.phase === "downloading") {
    label = model.filename ?? model.reference ?? "";
    percent = model.percent;
    if (model.total > 0) {
      detail = `${gb.format(model.completed / 1e9)} / ${gb.format(model.total / 1e9)} GB`;
      const remaining = formatRemainingTime(model.remainingSeconds);
      if (remaining) detail += ` · ${remaining}`;
    } else {
      detail = t("preparingDownload");
    }
  } else if (engine.phase === "running") {
    label = t("onbEngineSetup");
    percent = engine.percent;
  } else {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={`w-full ${large ? "ui-box p-5 space-y-3" : "border-t-2 border-[var(--border-light)] bg-[var(--bg-panel)] px-6 py-3 space-y-2"}`}
    >
      {error ? (
        <div className="flex items-center gap-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
          <p className="flex-1 min-w-0 text-xs font-bold text-red-500">{error}</p>
          <Button onClick={download.retry}>{t("retry")}</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs font-bold">
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
            <span className="flex-1 min-w-0 truncate">{label}</span>
            <span dir="ltr" className="flex-shrink-0 text-[var(--text-muted)]">{detail}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: "var(--text-main)" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
