import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Field, Stat } from "../settings/Controls";
import { formatTokenCount } from "../agent/contextBreakdown";
import { formatDuration, sinceFor, summarize } from "./summary";
import type { StatsRange } from "./summary";
import CostSection from "./CostSection";
import { swallowed } from "../logger";
import { summarizeCost } from "./costSummary";
import { legacyPricer, parseReference, referencePricer } from "./pricing";
import type { PriceTable } from "./cost";
import type { MetricRow, ProviderInstance } from "../types";

interface StatsPanelProps {
  t: (key: string) => string;
  /** Narrows the figures to one chat, as the Usage pane does. `null` is a pane with no chat open.
   * Left out, the panel covers every chat and offers a range and a way to clear. */
  chatId?: string | null;
  /** The `provider/model` that local replies are priced against for "saved". */
  referenceModel?: string;
}

const RANGES: { id: StatsRange; label: string }[] = [
  { id: "7d", label: "statsLast7Days" },
  { id: "30d", label: "statsLast30Days" },
  { id: "all", label: "statsAllTime" },
];

/** How many tools the usage list shows before it stops. */
const TOP_TOOLS = 12;

/** A count against the largest in its list. The first row is drawn in ink, the rest in a quieter neutral. */
function Bar({ value, max, strong }: { value: number; max: number; strong: boolean }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-raised" data-bar>
      <div
        className={`h-full rounded-pill ${strong ? "bg-text-primary" : "bg-text-tertiary"}`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  );
}

/** How the user's models have done: speed by model, tool use, time per task. From turns kept
 * locally, shown nowhere else, and clearable. */
export default function StatsPanel({ t, chatId, referenceModel }: StatsPanelProps) {
  const scoped = chatId !== undefined;
  const [chosenRange, setRange] = useState<StatsRange>("30d");
  const range = scoped ? "all" : chosenRange;
  const [loaded, setLoaded] = useState<{ key: string; rows: MetricRow[]; since: number; at: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revision, setRevision] = useState(0);

  const api = window.electronAPI?.metrics;
  const key = `${range}:${chatId ?? ""}`;

  useEffect(() => {
    if (!api) return;

    let current = true;
    // The window is fixed when the rows are asked for, so the charts and the rows describe the same span.
    const at = Date.now();
    const since = sinceFor(range, at);

    api
      .list(since)
      .then((result) => {
        if (current) setLoaded({ key, rows: result?.rows ?? [], since, at });
      })
      .catch(() => {
        if (current) setLoaded({ key, rows: [], since, at });
      });

    return () => {
      current = false;
    };
  }, [api, range, key, revision]);

  const rows = useMemo(() => {
    if (!loaded || loaded.key !== key) return null;
    if (!scoped) return loaded.rows;
    return chatId ? loaded.rows.filter((row) => row.chatId === chatId) : [];
  }, [loaded, key, scoped, chatId]);
  const summary = useMemo(() => (rows ? summarize(rows) : null), [rows]);

  const [prices, setPrices] = useState<{ table: PriceTable | null; instances: ProviderInstance[] } | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      Promise.all([
        window.electronAPI?.pricing?.table().catch(swallowed("stats", "old rows show without an estimate", null)),
        window.electronAPI?.providers?.list?.().catch(() => []),
      ]).then(([answer, instances]) => {
        if (current) setPrices({ table: answer?.success ? (answer.table ?? null) : null, instances: instances ?? [] });
      });
    void load();
    // New prices re-price the old rows that were estimated from the model name.
    const stop = window.electronAPI?.pricing?.onUpdated?.(() => void load());
    return () => {
      current = false;
      if (typeof stop === "function") stop();
    };
  }, []);

  const cost = useMemo(
    () =>
      rows && prices
        ? summarizeCost(rows, {
            priceLegacy: legacyPricer(prices.table, prices.instances),
            priceReference: referencePricer(prices.table, parseReference(referenceModel)),
          })
        : null,
    [rows, prices, referenceModel],
  );

  const clear = async () => {
    setConfirming(false);
    await api?.clear();
    setRevision((count) => count + 1);
  };

  if (!api) return null;

  const busiestBucket = summary ? Math.max(1, ...summary.tasks.buckets.map((bucket) => bucket.count)) : 1;
  const busiestTool = summary?.tools[0]?.calls ?? 1;
  const windowStart = loaded?.since ?? 0;
  const windowEnd = loaded?.at ?? 0;

  return (
    <div className="space-y-8">
      {!scoped && (
        <SegmentedControl
          size="dense"
          ariaLabel={t("statsRange")}
          value={chosenRange}
          onChange={setRange}
          options={RANGES.map((option) => ({ value: option.id, label: t(option.label) }))}
        />
      )}

      {!summary ? (
        <Icon name="circle-notch" size={20} className="animate-spin text-text-secondary" />
      ) : summary.turns === 0 ? (
        <p className="max-w-[52ch] text-[13px] leading-5 text-text-secondary">
          {t(scoped ? "statsEmptyChat" : "statsEmpty")}
        </p>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-3 ${scoped ? "" : "md:grid-cols-4"}`}>
            <Stat label={t("statsTurns")} value={String(summary.turns)} />
            <Stat label={t("statsTokensWritten")} value={formatTokenCount(summary.responseTokens)} />
            <Stat
              label={t("statsAverageSpeed")}
              value={`${summary.tokensPerSecond.toFixed(1)} ${t("tokensPerSecondShort")}`}
            />
            <Stat label={t("statsMedianTask")} value={formatDuration(summary.tasks.medianMs)} />
          </div>

          {cost && (
            <CostSection
              t={t}
              cost={cost}
              from={range === "all" ? (summary.firstAt ?? windowEnd) : windowStart}
              to={windowEnd}
            />
          )}

          <Field label={t("statsByModel")}>
            <div className="overflow-x-auto rounded-md shadow-[0_0_0_1px_var(--rule-strong)]">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-[12px] text-text-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t("statsModel")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("statsTurns")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("statsSpeed")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("statsFirstToken")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("statsTokensWritten")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.models.map((model) => (
                    <tr key={model.model} className="border-t border-rule">
                      <td className="px-3 py-2 font-mono text-[12px] text-text-primary">{model.model}</td>
                      <td className="px-3 py-2 text-end">{model.turns}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-end">
                        {model.tokensPerSecond.toFixed(1)} {t("tokensPerSecondShort")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-end">
                        {model.firstTokenMs === null ? "–" : formatDuration(model.firstTokenMs)}
                      </td>
                      <td className="px-3 py-2 text-end">{formatTokenCount(model.responseTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Field>

          <Field label={t("statsToolUsage")}>
            {summary.tools.length === 0 ? (
              <p className="text-[13px] text-text-secondary">{t("statsNoTools")}</p>
            ) : (
              <ul className="space-y-2">
                {summary.tools.slice(0, TOP_TOOLS).map((tool, index) => (
                  <li key={tool.name} className="flex items-center gap-3 text-[12px]">
                    <span className="w-40 flex-shrink-0 truncate font-mono text-text-secondary" title={tool.name}>
                      {tool.name}
                    </span>
                    <Bar value={tool.calls} max={busiestTool} strong={index === 0} />
                    <span className="w-10 text-end tabular-nums text-text-primary">{tool.calls}</span>
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

            <ul className="space-y-2 pt-2">
              {summary.tasks.buckets.map((bucket) => (
                <li key={bucket.id} className="flex items-center gap-3 text-[12px]">
                  <span className="w-28 flex-shrink-0 text-text-secondary">{t(`statsBucket_${bucket.id}`)}</span>
                  <Bar value={bucket.count} max={busiestBucket} strong={bucket.count === busiestBucket} />
                  <span className="w-10 text-end tabular-nums text-text-primary">{bucket.count}</span>
                </li>
              ))}
            </ul>
          </Field>
        </>
      )}

      {!scoped && summary && summary.turns > 0 && (
        <Button variant="danger" size="dense" icon={<Icon name="trash" size={14} />} onClick={() => setConfirming(true)}>
          {t("statsClear")}
        </Button>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("statsConfirmClear")}
        description={t("statsClearHint")}
        closeLabel={t("closeDialog")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void clear()}>
              {t("statsClear")}
            </Button>
          </>
        }
      />
    </div>
  );
}
