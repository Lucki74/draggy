import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Group, Row, Select, Toggle } from "./Controls";
import { DISPLAY_CURRENCIES } from "../stats/displayMoney";
import { logRendererError, swallowed } from "../logger";
import type { AppSettings, PricingStatus } from "../types";

interface PricesGroupProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  t: (key: string) => string;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "–");

/** Where the rate card comes from and how it stays current, the currency costs are shown in, and the model
 * "saved" is measured against. The refresh is the one thing in costs that reaches the network. */
export default function PricesGroup({ settings, onUpdate, t }: PricesGroupProps) {
  const pricing = window.draggy?.pricing;
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
    } catch (error) {
      logRendererError("settings", "price refresh failed", error);
      setFailed(t("priceUpdateFailed"));
    } finally {
      setBusy(false);
    }
  };

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
    </Group>
  );
}
