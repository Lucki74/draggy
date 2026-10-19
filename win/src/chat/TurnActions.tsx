import { Fragment } from "react";
import { useLiveTurn } from "../agent/liveTurn";
import { IconButton } from "../ui";
import type { TurnMetrics } from "../types";

const formatTokens = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

const METRICS_ROW = "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-text-secondary tabular-nums";

function Cells({ cells }: { cells: string[] }) {
  return cells.map((cell, index) => (
    <Fragment key={`${index}-${cell}`}>
      {index > 0 && (
        <span aria-hidden="true" className="text-text-tertiary">
          ·
        </span>
      )}
      <span className="whitespace-nowrap">{cell}</span>
    </Fragment>
  ));
}

export function MetricsFooter({
  metrics,
  t,
}: {
  metrics: TurnMetrics;
  t: (key: string) => string;
}) {
  const contextUsed = metrics.promptTokens + metrics.responseTokens;
  const contextPercent =
    metrics.contextWindow > 0
      ? Math.min(100, Math.round((contextUsed / metrics.contextWindow) * 100))
      : 0;

  const cells: string[] = [
    `${metrics.tokensPerSecond.toFixed(1)} ${t("tokensPerSecond")}`,
    `${formatTokens(metrics.responseTokens)} ${t("tokensOut")}`,
  ];

  if (metrics.timeToFirstTokenMs !== null) {
    cells.push(`${(metrics.timeToFirstTokenMs / 1000).toFixed(2)}s ${t("toFirstToken")}`);
  }

  cells.push(
    `${formatTokens(contextUsed)} / ${formatTokens(metrics.contextWindow)} ${t("context")} (${contextPercent}%)`,
  );

  if (metrics.gpuPercent !== null) {
    cells.push(
      metrics.gpuPercent >= 100
        ? `100% ${t("onGpu")}`
        : `${metrics.gpuPercent}% ${t("onGpu")} / ${100 - metrics.gpuPercent}% ${t("onCpu")}`,
    );
  }

  if (metrics.loadMs > 250) {
    cells.push(`${(metrics.loadMs / 1000).toFixed(1)}s ${t("modelLoad")}`);
  }

  return (
    <div className={METRICS_ROW} title={`${metrics.model} · ${t("promptTokens")} ${metrics.promptTokens}`}>
      <Cells cells={cells} />
    </div>
  );
}

// Measured token rate while streaming, superseded by the engine's exact tally on completion.
export function LiveSpeed({ chatId, t }: { chatId: string; t: (key: string) => string }) {
  const live = useLiveTurn(chatId);
  if (!live || live.responseTokens === 0) return null;

  return (
    <div role="status" className={METRICS_ROW}>
      <Cells
        cells={[
          `${live.tokensPerSecond.toFixed(1)} ${t("tokensPerSecond")}`,
          `${formatTokens(live.responseTokens)} ${t("tokensOut")}`,
        ]}
      />
    </div>
  );
}

export interface TurnActionsProps {
  idx: number;
  text: string;
  isGenerating: boolean;
  isLast: boolean;
  copiedIndex: number | null;
  copyToClipboard: (text: string, idx: number) => void;
  onRegenerate: (index: number) => void;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  totalVersions: number;
  currentVersionIndex: number;
  currentVersionNum: number;
  metrics?: TurnMetrics | null;
  showMetrics: boolean;
  chatId?: string;
  isFailed?: boolean;
  t: (key: string) => string;
}

// One row under a finished reply: version switch, copy, retry, then the metrics. Quiet until hovered,
// except on the latest turn, where the actions are the next thing anyone reaches for.
export function TurnActions({
  idx,
  text,
  isGenerating,
  isLast,
  copiedIndex,
  copyToClipboard,
  onRegenerate,
  onSwitchVersion,
  totalVersions,
  currentVersionIndex,
  currentVersionNum,
  metrics,
  showMetrics,
  chatId,
  isFailed,
  t,
}: TurnActionsProps) {
  if (isGenerating) {
    return isLast && showMetrics && chatId ? (
      <div className="mt-2">
        <LiveSpeed chatId={chatId} t={t} />
      </div>
    ) : null;
  }

  return (
    <div
      className={`mt-1.5 -ms-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 transition-opacity ${
        isLast ? "" : "opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
      }`}
    >
      {totalVersions > 1 && (
        <div className="flex items-center text-[12px] text-text-secondary tabular-nums">
          <IconButton
            name="caret-left"
            size="sm"
            label={t("previousVersion")}
            disabled={currentVersionIndex <= 0}
            onClick={() => onSwitchVersion(idx, currentVersionIndex - 1)}
          />
          <span>
            {currentVersionNum} / {totalVersions}
          </span>
          <IconButton
            name="caret-right"
            size="sm"
            label={t("nextVersion")}
            disabled={currentVersionNum >= totalVersions}
            onClick={() => onSwitchVersion(idx, currentVersionIndex + 1)}
          />
        </div>
      )}
      <IconButton
        name={copiedIndex === idx ? "check" : "copy"}
        size="sm"
        label={t("copyMessage")}
        onClick={() => copyToClipboard(text, idx)}
      />
      {isLast && !isFailed && (
        <IconButton name="arrow-clockwise" size="sm" label={t("regenerateResponse")} onClick={() => onRegenerate(idx)} />
      )}
      {showMetrics && metrics && (
        <div className="ms-2">
          <MetricsFooter metrics={metrics} t={t} />
        </div>
      )}
    </div>
  );
}
export default TurnActions;
