import { useState } from "react";
import { ChevronRight, WifiOff } from "lucide-react";
import { Badge, Button } from "../../settings/Controls";
import ModelSearch from "../../settings/ModelSearch";
import { describeSplit, FIT_COLOURS } from "../../vram";
import { ggufLadder } from "../../modelRecommendations";
import { displayModelName } from "../../llama";
import { fitsOnDisk, type DownloadOption, type FirstDownloadPlan } from "../../boot/bootSequence";
import { fill } from "../text";
import StepHeader from "./StepHeader";

export interface ModelChoice {
  reference: string;
  label: string;
  fitsOnDisk: boolean;
  sizeBytes?: number;
  /** The file, when the model is already on disk and nothing needs downloading. */
  installed?: string;
}

function choiceFrom(option: DownloadOption): ModelChoice {
  return { reference: option.reference, label: option.label, fitsOnDisk: option.fitsOnDisk, sizeBytes: option.sizeBytes };
}

export default function LocalModel({
  plan,
  installed,
  modelsDir,
  online,
  onRetryOnline,
  choice,
  onChoose,
  language,
  t,
}: {
  plan: FirstDownloadPlan | null;
  installed: string | null;
  modelsDir: string;
  online: boolean | null;
  onRetryOnline: () => void;
  choice: ModelChoice | null;
  onChoose: (choice: ModelChoice) => void;
  language: string;
  t: (key: string) => string;
}) {
  const [searching, setSearching] = useState(false);
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const gb = (bytes: number) => `${number.format(bytes / 1e9)} GB`;

  if (!plan) {
    return (
      <div className="space-y-8">
        <StepHeader title={t("onbModelTitle")} body={t("onbModelBody")} />
        <div aria-busy="true" className="space-y-2">
          <p className="text-center text-xs font-bold text-[var(--text-muted)]">{t("onbLoadingHardware")}</p>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-16 rounded-xl bg-[var(--hover-bg)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { specs } = plan;
  const memory = (gigabytes: number) => `${number.format(gigabytes)} GB`;
  const hardware = [
    specs?.gpu || (specs?.vram ? "" : t("onbNoGpu")),
    specs?.unifiedMemory
      ? fill(t("onbUnified"), { size: memory(specs.ram) })
      : [specs?.vram ? fill(t("onbVram"), { size: memory(specs.vram) }) : "", specs ? fill(t("onbRam"), { size: memory(specs.ram) }) : ""]
          .filter(Boolean)
          .join(" · "),
  ]
    .filter(Boolean)
    .join(" · ");

  const offline = online === false;
  const options: { option: DownloadOption; badge: string }[] = [
    { option: plan.recommended, badge: t("onbRecommended") },
    ...(plan.lighter ? [{ option: plan.lighter, badge: t("onbLighter") }] : []),
    ...(plan.stronger ? [{ option: plan.stronger, badge: t("onbStronger") }] : []),
  ];
  const noneFits = options.every(({ option }) => !option.fitsOnDisk);
  const smallest = Math.min(...ggufLadder.map((rung) => rung.sizeGB * 1e9)) * 1.5;

  const row = (key: string, selected: boolean, disabled: boolean, onSelect: () => void, body: React.ReactNode) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] bg-[var(--bg-panel)] text-start transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        selected ? "border-[var(--text-main)]" : "border-[var(--border-light)] enabled:hover:border-[var(--text-muted)]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-4 h-4 flex-shrink-0 rounded-full border-[3px] ${
          selected ? "border-[var(--text-main)] bg-[var(--text-main)]" : "border-[var(--border-light)]"
        }`}
      />
      {body}
    </button>
  );

  return (
    <div className="space-y-6">
      <StepHeader title={t("onbModelTitle")} body={t("onbModelBody")} />
      {hardware && <p className="text-center text-xs font-bold text-[var(--text-muted)]">{hardware}</p>}

      {offline && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]">
          <WifiOff className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
          <p className="flex-1 min-w-0 text-xs font-bold">{t("onbOffline")}</p>
          <Button onClick={onRetryOnline}>{t("retry")}</Button>
        </div>
      )}

      <div role="radiogroup" aria-label={t("onbModelTitle")} className="space-y-2">
        {installed &&
          row(
            `installed:${installed}`,
            choice?.installed === installed,
            false,
            () => onChoose({ reference: installed, label: displayModelName(installed), fitsOnDisk: true, installed }),
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-bold">
                <span className="truncate">{displayModelName(installed)}</span>
                <Badge strong>{t("onbInstalled")}</Badge>
              </span>
            </span>,
          )}
        {options.map(({ option, badge }) => {
          const colour = option.fit.tone === "unknown" ? "var(--text-muted)" : FIT_COLOURS[option.fit.tone];
          const split = describeSplit(option.fit);
          return row(
            option.reference,
            !choice?.installed && choice?.reference === option.reference,
            offline || !option.fitsOnDisk,
            () => onChoose(choiceFrom(option)),
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-bold">
                <span className="truncate">{option.label}</span>
                <Badge strong={option === plan.recommended}>{badge}</Badge>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted)]">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
                {option.params} · {gb(option.sizeBytes)}
                {split ? ` · ${split}` : ""}
                {!option.fitsOnDisk && (
                  <span className="text-red-500">{fill(t("onbNotEnoughDisk"), { size: gb(option.sizeBytes * 1.5) })}</span>
                )}
              </span>
            </span>,
          );
        })}
      </div>

      {noneFits && (
        <p className="text-xs font-bold text-red-500">{fill(t("onbNoOptionFits"), { size: gb(smallest) })}</p>
      )}

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setSearching((open) => !open)}
          aria-expanded={searching}
          disabled={offline}
          className="inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-50"
        >
          {t("onbSearchOther")}
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${searching ? "rotate-90" : ""}`} />
        </button>
        {searching && !offline && (
          <ModelSearch
            vram={specs?.vram || 0}
            unifiedMemory={Boolean(specs?.unifiedMemory)}
            phaseFor={() => undefined}
            picked={choice && !choice.installed ? choice.reference : undefined}
            pickLabel={t("onbChoose")}
            onPick={(reference, bytes) =>
              onChoose({ reference, label: reference, fitsOnDisk: fitsOnDisk(plan.freeBytes, bytes ?? 0), sizeBytes: bytes })
            }
            t={t}
          />
        )}
      </div>

      <p className="text-center text-[11px] font-bold text-[var(--text-muted)]">
        {fill(t("onbDiskFooter"), {
          free: plan.freeBytes > 0 ? gb(plan.freeBytes) : "?",
          folder: modelsDir,
        })}
      </p>
    </div>
  );
}
