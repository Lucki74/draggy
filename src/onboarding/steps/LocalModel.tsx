import { useState } from "react";
import ModelSearch from "../../settings/ModelSearch";
import { describeSplit } from "../../vram";
import { Icon } from "../../ui/icons/Icon";
import { StatusDot, type StatusKind } from "../../ui/StatusDot";
import { ggufLadder } from "../../modelRecommendations";
import { displayModelName } from "../../llama";
import { fitsOnDisk, type DownloadOption, type FirstDownloadPlan } from "../../boot/bootSequence";
import { fill } from "../text";
import { formatBytes } from "../../formatBytes";
import { Choice, OfflineNotice } from "./Choice";
import StepHeader from "./StepHeader";

export interface ModelChoice {
  reference: string;
  label: string;
  fitsOnDisk: boolean;
  sizeBytes?: number;
  /** The file, when the model is already on disk and nothing needs downloading. */
  installed?: string;
}

const FIT_STATUS: Record<string, StatusKind> = { green: "ok", amber: "warn", red: "danger" };

function choiceFrom(option: DownloadOption): ModelChoice {
  return { reference: option.reference, label: option.label, fitsOnDisk: option.fitsOnDisk, sizeBytes: option.sizeBytes };
}

export default function LocalModel({
  plan,
  installed,
  online,
  onRetryOnline,
  choice,
  onChoose,
  language,
  t,
}: {
  plan: FirstDownloadPlan | null;
  installed: string | null;
  online: boolean | null;
  onRetryOnline: () => void;
  choice: ModelChoice | null;
  onChoose: (choice: ModelChoice) => void;
  language: string;
  t: (key: string) => string;
}) {
  const [searching, setSearching] = useState(false);
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const gb = (bytes: number) => formatBytes(bytes, language);

  if (!plan) {
    return (
      <div className="space-y-8">
        <StepHeader title={t("onbModelTitle")} />
        <div aria-busy="true" className="space-y-3">
          <p className="text-[13px] leading-5 text-text-tertiary">{t("onbLoadingHardware")}</p>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-[68px] rounded-md bg-surface-raised motion-safe:animate-pulse" />
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

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <StepHeader title={t("onbModelTitle")} />
        {hardware && (
          <p className="flex items-center gap-2 text-[13px] leading-5 text-text-tertiary">
            <Icon name="cpu" size={14} className="flex-shrink-0" />
            {hardware}
          </p>
        )}
      </div>

      {offline && <OfflineNotice onRetry={onRetryOnline} t={t} />}

      <div role="radiogroup" aria-label={t("onbModelTitle")} className="space-y-3">
        {installed && (
          <Choice
            selected={choice?.installed === installed}
            onSelect={() => onChoose({ reference: installed, label: displayModelName(installed), fitsOnDisk: true, installed })}
            title={displayModelName(installed)}
            marker={t("onbInstalled")}
          />
        )}
        {options.map(({ option, badge }) => {
          const split = describeSplit(option.fit);
          return (
            <Choice
              key={option.reference}
              selected={!choice?.installed && choice?.reference === option.reference}
              disabled={offline || !option.fitsOnDisk}
              onSelect={() => onChoose(choiceFrom(option))}
              title={option.label}
              marker={badge}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                <StatusDot status={FIT_STATUS[option.fit.tone] ?? "idle"} />
                {option.params} · {gb(option.sizeBytes)}
                {split ? ` · ${split}` : ""}
              </span>
              {!option.fitsOnDisk && (
                <span className="mt-1 block text-danger">{fill(t("onbNotEnoughDisk"), { size: gb(option.sizeBytes * 1.5) })}</span>
              )}
            </Choice>
          );
        })}
      </div>

      {noneFits && (
        <p role="alert" className="text-[13px] leading-5 text-danger">
          {fill(t("onbNoOptionFits"), { size: gb(smallest) })}
        </p>
      )}

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setSearching((open) => !open)}
          aria-expanded={searching}
          disabled={offline}
          className="-mx-1 inline-flex items-center gap-1 rounded-xs px-1 text-[13px] text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
        >
          {t("onbSearchOther")}
          <Icon name="caret-right" size={14} className={`transition-transform ${searching ? "rotate-90" : ""}`} />
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
    </div>
  );
}
