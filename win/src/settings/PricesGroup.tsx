import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Group, Row, Select, Toggle } from "./Controls";
import { DISPLAY_CURRENCIES } from "../stats/displayMoney";
import { DEFAULT_REFERENCE, formatReference } from "../stats/pricing";
import { swallowed } from "../logger";
import type { AppSettings, PricingStatus } from "../types";

interface PricesGroupProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  t: (key: string) => string;
}

/** Models a local reply can be priced against to show what it would have cost. All are in the bundled snapshot. */
const REFERENCE_MODELS = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-opus-4-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "gemini/gemini-2.5-pro",
  "gemini/gemini-2.5-flash",
];

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "–");

/** Where the rate card comes from and how it stays current, the currency costs are shown in, and the model
 * "saved" is measured against. The refresh is the one thing in costs that reaches the network. */
export default function PricesGroup({ settings, onUpdate, t }: PricesGroupProps) {
  const pricing = window.electronAPI?.pricing;
  const [status, setStatus] = useState<PricingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!pricing) return;
    let current = true;
    void pricing
      .status()
      .then((answer) => current && answer?.success && setStatus(answer.status ?? null))
      .catch(swallowed("settings", "the line under the button stays empty"));
    const stop = pricing.onUpdated?.((next) => current && setStatus(next));
    return () => {
      current = false;
      if (typeof stop === "function") stop();
    };
  }, [pricing]);

  const update = async () => {
    if (!pricing || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const answer = await pricing.refresh();
      if (answer.status) setStatus(answer.status);
      const error = answer.prices?.error ?? answer.rates?.error;
      setFailed(answer.success && !error ? null : (error ?? t("priceUpdateFailed")));
    } catch {
      setFailed(t("priceUpdateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const reference = settings.referenceModel ?? formatReference(DEFAULT_REFERENCE);
  const summary = status
    ? [
        `${t(status.origin === "live" ? "priceOriginLive" : "priceOriginBundled")} ${day(status.pricesGeneratedAt)}`,
        `${t("priceRatesDate")} ${day(status.ratesDate)}`,
      ].join(" · ")
    : "";

  return (
    <Group title={t("priceTitle")}>
      <Row label={t("priceAuto")}>
        <Toggle checked={settings.priceRefresh !== false} onChange={(priceRefresh) => onUpdate({ priceRefresh })} label={t("priceAuto")} />
      </Row>
      <Row
        label={t("priceUpdateNow")}
        description={
          <>
            {summary}
            {failed && (
              <span role="alert" className="block text-danger">
                {failed}
              </span>
            )}
          </>
        }
      >
        <Button variant="secondary" size="dense" loading={busy} disabled={busy || !pricing} onClick={() => void update()}>
          {t(busy ? "priceUpdating" : "priceUpdateNow")}
        </Button>
      </Row>
      <Row label={t("priceCurrency")}>
        <Select
          label={t("priceCurrency")}
          value={settings.displayCurrency ?? "USD"}
          options={DISPLAY_CURRENCIES.map((code) => ({ id: code, label: code }))}
          onChange={(displayCurrency) => onUpdate({ displayCurrency })}
        />
      </Row>
      <Row label={t("priceReference")}>
        <Select
          label={t("priceReference")}
          value={reference}
          options={REFERENCE_MODELS.map((id) => ({ id, label: id.split("/")[1] }))}
          onChange={(referenceModel) => onUpdate({ referenceModel })}
        />
      </Row>
    </Group>
  );
}
