import { Button } from "../ui/Button";
import { Icon } from "../ui/icons/Icon";
import { ProgressLine } from "../ui/ProgressLine";
import { formatTransferred } from "../formatBytes";
import { formatRemainingTime } from "../settings/PullProgress";
import type { FirstDownload } from "./useFirstDownload";

/** The model's download while the user carries on: pinned to the bottom of each screen, and grown
 * into the page on Ready. Only the model and the engine it needs; extras never show here. */
export default function DownloadBar({
  download,
  large,
  placement = "bottom",
  language,
  t,
}: {
  download: FirstDownload;
  large?: boolean;
  /** Pinned under the setup's steps, or above the app's own content while it waits. */
  placement?: "top" | "bottom";
  language: string;
  t: (key: string) => string;
}) {
  const { engine, model } = download;
  const gb = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let label = "";
  let detail = "";
  let percent: number | undefined = 0;
  let error = "";

  if (model.phase === "error") {
    error = `${t("downloadFailed")}: ${model.error ?? ""}`;
  } else if (engine.phase === "error") {
    error = engine.error && engine.error !== "missingGgufEngine" ? engine.error : t("missingGgufEngine");
  } else if (model.phase === "queued" || model.phase === "downloading") {
    label = model.filename ?? model.reference ?? "";
    percent = model.percent;
    if (model.total > 0) {
      detail = formatTransferred(model.completed, model.total, language);
      if (model.bytesPerSecond > 0) detail += ` · ${gb.format(model.bytesPerSecond / 1e6)} MB/s`;
      const remaining = formatRemainingTime(model.remainingSeconds);
      if (remaining) detail += ` · ${remaining}`;
    } else {
      detail = t("preparingDownload");
      percent = undefined;
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
      className={`w-full ${
        large
          ? "space-y-3 rounded-md bg-surface-base px-5 py-4 shadow-[0_0_0_1px_var(--rule-strong)]"
          : `${placement === "top" ? "border-b" : "border-t"} space-y-2 border-rule bg-surface-base px-6 py-3`
      }`}
    >
      {error ? (
        <div className="flex items-center gap-3">
          <Icon name="warning-circle" size={16} className="flex-shrink-0 text-danger" />
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-danger">{error}</p>
          <Button variant="secondary" size="dense" onClick={download.retry}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-3 text-[13px] leading-5">
            <span className="min-w-0 flex-1 truncate text-text-primary">{label}</span>
            <span dir="ltr" className="flex-shrink-0 tabular-nums text-text-tertiary">
              {detail}
            </span>
          </div>
          <ProgressLine progress={percent === undefined ? undefined : percent / 100} label={label} />
        </>
      )}
    </div>
  );
}
