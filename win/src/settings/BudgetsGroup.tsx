import { useEffect, useState } from "react";
import { Group, Row, Toggle } from "./Controls";
import { DEFAULT_BUDGETS, NO_LIMITS } from "../stats/budget";
import { swallowed } from "../logger";
import type { AppSettings, BudgetLimits, ProviderInstance } from "../types";

interface BudgetsGroupProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  t: (key: string) => string;
}

const MICROS_PER_DOLLAR = 1_000_000;

/** A dollar amount typed in, kept as micro-dollars. Empty means no limit. */
function MoneyInput({
  micros,
  label,
  onChange,
}: {
  micros: number | null;
  label: string;
  onChange: (micros: number | null) => void;
}) {
  const [text, setText] = useState(micros === null ? "" : String(micros / MICROS_PER_DOLLAR));
  const commit = (value: string) => {
    const amount = Number(value);
    onChange(value.trim() !== "" && Number.isFinite(amount) && amount > 0 ? Math.round(amount * MICROS_PER_DOLLAR) : null);
  };
  return (
    <label className="flex h-8 w-32 items-center gap-1.5 rounded-sm bg-surface-base px-2.5 shadow-[inset_0_0_0_1px_var(--rule-control)] focus-within:ring-2 focus-within:ring-focus">
      <span aria-hidden="true" className="text-[13px] text-text-tertiary">
        $
      </span>
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={text}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(event) => event.key === "Enter" && commit(text)}
        className="min-w-0 flex-1 bg-transparent text-[13px] tabular-nums text-text-primary outline-none"
      />
    </label>
  );
}

function LimitRows({
  limits,
  title,
  t,
  onChange,
}: {
  limits: BudgetLimits;
  title: string;
  t: (key: string) => string;
  onChange: (limits: BudgetLimits) => void;
}) {
  return (
    <>
      <Row label={`${title}: ${t("budgetDaily")}`}>
        <MoneyInput micros={limits.dailyMicros} label={`${title}: ${t("budgetDaily")}`} onChange={(dailyMicros) => onChange({ ...limits, dailyMicros })} />
      </Row>
      <Row label={`${title}: ${t("budgetMonthly")}`}>
        <MoneyInput micros={limits.monthlyMicros} label={`${title}: ${t("budgetMonthly")}`} onChange={(monthlyMicros) => onChange({ ...limits, monthlyMicros })} />
      </Row>
    </>
  );
}

/** Spending limits: one for everything, and optionally one per paid provider. Reaching one stops new cloud
 * sends until the user presses Retry on the stopped reply. */
export default function BudgetsGroup({ settings, onUpdate, t }: BudgetsGroupProps) {
  const budgets = settings.budgets ?? DEFAULT_BUDGETS;
  const [instances, setInstances] = useState<ProviderInstance[]>([]);

  useEffect(() => {
    let current = true;
    void window.electronAPI?.providers
      ?.list?.()
      .then((list) => current && setInstances(list.filter((item) => item.kind === "cloud" && item.enabled)))
      .catch(swallowed("settings", "no per-provider limits are offered"));
    return () => {
      current = false;
    };
  }, []);

  const save = (patch: Partial<typeof budgets>) => onUpdate({ budgets: { ...budgets, ...patch } });

  return (
    <Group title={t("budgetTitle")}>
      <Row label={t("budgetEnable")}>
        <Toggle checked={budgets.enabled} onChange={(enabled) => save({ enabled })} label={t("budgetEnable")} />
      </Row>
      {budgets.enabled && (
        <>
          <LimitRows title={t("budgetAll")} limits={budgets.global} t={t} onChange={(global) => save({ global })} />
          {instances.map((instance) => (
            <LimitRows
              key={instance.id}
              title={instance.label}
              limits={budgets.providers[instance.id] ?? NO_LIMITS}
              t={t}
              onChange={(limits) => save({ providers: { ...budgets.providers, [instance.id]: limits } })}
            />
          ))}
        </>
      )}
    </Group>
  );
}
