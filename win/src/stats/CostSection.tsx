import { useState } from "react";
import { Button } from "../ui/Button";
import { Field, Stat } from "../settings/Controls";
import CostChart from "./CostChart";
import { fillDays, type CostBucket, type CostSummary } from "./costSummary";
import { formatMoney } from "./cost";
import { useDisplayMoney } from "./displayMoney";

interface CostSectionProps {
  t: (key: string) => string;
  cost: CostSummary;
  /** The range's start and end, to give a quiet day its zero bar. */
  from: number;
  to: number;
  locale?: string;
}

function BucketTable({
  title,
  keyHeader,
  buckets,
  money,
  t,
}: {
  title: string;
  keyHeader: string;
  buckets: CostBucket[];
  money: (micros: number, estimated?: boolean) => string;
  t: (key: string) => string;
}) {
  if (buckets.length === 0) return null;
  return (
    <Field label={title}>
      <div className="overflow-x-auto rounded-md shadow-[0_0_0_1px_var(--rule-strong)]">
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-[12px] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{keyHeader}</th>
              <th className="px-3 py-2 text-end font-medium">{t("statsTurns")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("costSpent")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("costPlanValue")}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-t border-rule">
                <td className="px-3 py-2 font-mono text-[12px] text-text-primary">{bucket.key}</td>
                <td className="px-3 py-2 text-end">{bucket.turns}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end">{money(bucket.spentMicros, bucket.estimated)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end text-text-secondary">
                  {bucket.accountMicros > 0 ? money(bucket.accountMicros, true) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Field>
  );
}

/** What the replies cost: the headline figures, cost per day, and the split by provider, model and workspace. */
export default function CostSection({ t, cost, from, to, locale }: CostSectionProps) {
  const [asTable, setAsTable] = useState(false);
  const display = useDisplayMoney();
  const money = (micros: number, estimated = false) =>
    formatMoney(micros, display.currency, { estimated, locale, rate: display.rate });

  const hasMoney = cost.paidTurns > 0 || cost.savedMicros > 0;
  if (!hasMoney) {
    return <p className="max-w-[52ch] text-[13px] leading-5 text-text-secondary">{t("costNoBilled")}</p>;
  }

  const days = fillDays(cost.daily, from, to);
  const showChart = cost.paidTurns > 0 && days.length > 0;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("costSpent")} value={money(cost.spentMicros, cost.estimated)} />
        {cost.accountMicros > 0 && <Stat label={t("costPlanValue")} value={money(cost.accountMicros, true)} />}
        {cost.savedMicros > 0 && <Stat label={t("costSaved")} value={money(cost.savedMicros, true)} />}
        {cost.unpricedTurns > 0 && <Stat label={t("costUnpriced")} value={String(cost.unpricedTurns)} />}
      </div>

      {showChart && (
        <Field label={t("costOverTime")}>
          {asTable ? (
            <div className="overflow-x-auto rounded-md shadow-[0_0_0_1px_var(--rule-strong)]">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-[12px] text-text-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t("costChartLabel")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("costSpent")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("costPlanValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((entry) => (
                    <tr key={entry.day} className="border-t border-rule">
                      <td className="px-3 py-2 text-text-primary">{entry.day}</td>
                      <td className="px-3 py-2 text-end">{money(entry.spentMicros)}</td>
                      <td className="px-3 py-2 text-end text-text-secondary">
                        {entry.accountMicros > 0 ? money(entry.accountMicros, true) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CostChart
              days={days}
              format={(micros) => money(micros)}
              ariaLabel={t("costChartLabel")}
              spentLabel={t("costSpent")}
              accountLabel={t("costPlanValue")}
            />
          )}
          <Button variant="secondary" size="dense" onClick={() => setAsTable((value) => !value)}>
            {t(asTable ? "costShowChart" : "costShowTable")}
          </Button>
        </Field>
      )}

      <BucketTable title={t("costByProvider")} keyHeader={t("costProvider")} buckets={cost.byProvider} money={money} t={t} />
      <BucketTable title={t("statsByModel")} keyHeader={t("statsModel")} buckets={cost.byModel} money={money} t={t} />
      <BucketTable
        title={t("costByWorkspace")}
        keyHeader={t("costWorkspace")}
        buckets={cost.byWorkspace}
        money={money}
        t={t}
      />

      {(cost.estimated || cost.accountMicros > 0 || cost.savedMicros > 0) && (
        <p className="max-w-[60ch] text-[12px] leading-5 text-text-tertiary">{t("costEstimateNote")}</p>
      )}
    </div>
  );
}
