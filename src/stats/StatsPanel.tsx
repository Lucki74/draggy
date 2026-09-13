import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Field, Stat } from "../settings/Controls";
import { formatTokenCount } from "../agent/contextBreakdown";
import { formatDuration, sinceFor, summarize } from "./summary";
import type { StatsRange } from "./summary";
import type { MetricRow } from "../types";

interface StatsPanelProps {
  t: (key: string) => string;
}

const RANGES: { id: StatsRange; label: string }[] = [
  { id: "7d", label: "statsLast7Days" },
  { id: "30d", label: "statsLast30Days" },
  { id: "all", label: "statsAllTime" },
];

/** How many tools the usage list shows before it stops. */
const TOP_TOOLS = 12;

/** How the user's models have done: speed by model, tool use, time per task. From turns kept
 * locally, shown nowhere else, and clearable. */
export default function StatsPanel({ t }: StatsPanelProps) {
  const [range, setRange] = useState<StatsRange>("30d");
  const [loaded, setLoaded] = useState<{ range: StatsRange; rows: MetricRow[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revision, setRevision] = useState(0);

  const api = window.electronAPI?.metrics;

  useEffect(() => {
    if (!api) return;

    let current = true;

    api
      .list(sinceFor(range))
      .then((result) => {
        if (current) setLoaded({ range, rows: result?.rows ?? [] });
      })
      .catch(() => {
        if (current) setLoaded({ range, rows: [] });
      });

    return () => {
      current = false;
    };
  }, [api, range, revision]);

  const rows = loaded && loaded.range === range ? loaded.rows : null;
  const summary = useMemo(() => (rows ? summarize(rows) : null), [rows]);

  const clear = async () => {
    setConfirming(false);
    await api?.clear();
    setRevision((count) => count + 1);
  };

  if (!api) return null;

  const busiestBucket = summary ? Math.max(1, ...summary.tasks.buckets.map((bucket) => bucket.count)) : 1;
  const busiestTool = summary?.tools[0]?.calls ?? 1;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={t("statsRange")}
          className="flex w-fit overflow-hidden rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]"
        >
          {RANGES.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={range === option.id}
              onClick={() => setRange(option.id)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                range === option.id
                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
              }`}
            >
              {t(option.label)}
            </button>
          ))}
        </div>

      </div>

      {!summary ? (
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
      ) : summary.turns === 0 ? (
        <p className="text-sm font-bold text-[var(--text-muted)]">{t("statsEmpty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("statsTurns")} value={String(summary.turns)} />
            <Stat label={t("statsTokensWritten")} value={formatTokenCount(summary.responseTokens)} />
            <Stat
              label={t("statsAverageSpeed")}
              value={`${summary.tokensPerSecond.toFixed(1)} ${t("tokensPerSecondShort")}`}
            />
            <Stat label={t("statsMedianTask")} value={formatDuration(summary.tasks.medianMs)} />
          </div>

          <Field label={t("statsByModel")}>
            <div className="overflow-x-auto rounded-xl border-[3px] border-[var(--border-light)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-panel)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">{t("statsModel")}</th>
                    <th className="px-3 py-2 text-right">{t("statsTurns")}</th>
                    <th className="px-3 py-2 text-right">{t("statsSpeed")}</th>
                    <th className="px-3 py-2 text-right">{t("statsFirstToken")}</th>
                    <th className="px-3 py-2 text-right">{t("statsTokensWritten")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.models.map((model) => (
                    <tr key={model.model} className="border-t-2 border-[var(--border-light)]">
                      <td className="px-3 py-2 font-bold">{model.model}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{model.turns}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {model.tokensPerSecond.toFixed(1)} {t("tokensPerSecondShort")}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {model.firstTokenMs === null ? "–" : formatDuration(model.firstTokenMs)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatTokenCount(model.responseTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Field>

          <Field label={t("statsToolUsage")}>
            {summary.tools.length === 0 ? (
              <p className="text-sm font-bold text-[var(--text-muted)]">{t("statsNoTools")}</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.tools.slice(0, TOP_TOOLS).map((tool) => (
                  <li key={tool.name} className="flex items-center gap-3 text-xs">
                    <span className="w-40 flex-shrink-0 truncate font-mono" title={tool.name}>
                      {tool.name}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--hover-bg)]">
                      <div
                        className="h-full rounded-full bg-[var(--bg-inverted)]"
                        style={{ width: `${(tool.calls / busiestTool) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-bold tabular-nums">{tool.calls}</span>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field label={t("statsTaskTime")}>
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t("statsAverage")} value={formatDuration(summary.tasks.averageMs)} />
              <Stat label={t("statsP90")} value={formatDuration(summary.tasks.p90Ms)} />
              <Stat label={t("statsLongest")} value={formatDuration(summary.tasks.longestMs)} />
            </div>

            <ul className="space-y-1.5 pt-2">
              {summary.tasks.buckets.map((bucket) => (
                <li key={bucket.id} className="flex items-center gap-3 text-xs">
                  <span className="w-28 flex-shrink-0 font-bold text-[var(--text-muted)]">
                    {t(`statsBucket_${bucket.id}`)}
                  </span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--hover-bg)]">
                    <div
                      className="h-full rounded-full bg-[var(--bg-inverted)]"
                      style={{ width: `${(bucket.count / busiestBucket) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-bold tabular-nums">{bucket.count}</span>
                </li>
              ))}
            </ul>
          </Field>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm font-bold">{t("statsConfirmClear")}</span>
            <button
              onClick={() => void clear()}
              className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-red-600"
            >
              {t("confirm")}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-[var(--hover-bg)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]"
            >
              {t("cancel")}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 rounded-xl border-2 border-red-500 bg-red-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-500 transition-all hover:bg-red-500 hover:text-white"
          >
            <Trash2 className="w-4 h-4" />
            {t("statsClear")}
          </button>
        )}
      </div>
    </div>
  );
}
