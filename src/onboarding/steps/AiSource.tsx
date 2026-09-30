import { Server, WifiOff } from "lucide-react";
import { Badge, Button } from "../../settings/Controls";
import type { FirstDownloadPlan } from "../../boot/bootSequence";
import type { DiscoveredServer } from "../../types";
import { smallModelsOnly, type SetupPath } from "../flow";
import { fill } from "../text";
import StepHeader from "./StepHeader";

export default function AiSource({
  path,
  onPath,
  plan,
  installed,
  online,
  onRetryOnline,
  servers,
  language,
  t,
}: {
  path: SetupPath;
  onPath: (path: SetupPath) => void;
  plan: FirstDownloadPlan | null;
  installed: string | null;
  online: boolean | null;
  onRetryOnline: () => void;
  servers: DiscoveredServer[];
  language: string;
  t: (key: string) => string;
}) {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const weak = plan ? smallModelsOnly(plan.recommended.reference) : false;
  const needsNetwork = !installed && online === false;

  const card = (id: SetupPath, title: string, body: React.ReactNode, badge?: string, highlight = false) => {
    const selected = path === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onPath(id)}
        className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border-[3px] bg-[var(--bg-panel)] text-start transition-colors ${
          selected
            ? "border-[var(--text-main)]"
            : highlight
              ? "border-[var(--text-muted)] hover:border-[var(--text-main)]"
              : "border-[var(--border-light)] hover:border-[var(--text-muted)]"
        }`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded-full border-[3px] ${
            selected ? "border-[var(--text-main)] bg-[var(--text-main)]" : "border-[var(--border-light)]"
          }`}
        />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-2 text-sm font-bold">
            {title}
            {badge && <Badge strong>{badge}</Badge>}
          </span>
          <span className="block text-xs font-medium leading-relaxed text-[var(--text-muted)]">{body}</span>
        </span>
      </button>
    );
  };

  const hint = "block mt-1 text-[11px] font-bold";
  return (
    <div className="space-y-6">
      <StepHeader title={t("onbSourceTitle")} />
      <div role="radiogroup" aria-label={t("onbSourceTitle")} className="space-y-2">
        {card(
          "local",
          t("onbSourceLocal"),
          <>
            {t("onbSourceLocalBody")}
            {plan && !installed && (
              <span className={hint}>{fill(t("onbSourceDownload"), { size: `${number.format(plan.recommended.sizeBytes / 1e9)} GB` })}</span>
            )}
            {weak && <span className={hint}>{t("onbSourceWeak")}</span>}
          </>,
          t("onbRecommended"),
        )}
        {card(
          "provider",
          t("onbSourceProvider"),
          <>
            {t("onbSourceProviderBody")}
            {servers.length > 0 ? (
              servers.map((server) => (
                <span key={server.baseUrl} className={`${hint} flex items-center gap-1.5 text-[var(--text-main)]`}>
                  <Server className="w-3 h-3" />
                  {fill(t("onbSourceFound"), { name: server.name })}
                </span>
              ))
            ) : (
              <span className={hint}>{t("onbSourceProviderData")}</span>
            )}
          </>,
          undefined,
          weak,
        )}
        {card("both", t("onbSourceBoth"), t("onbSourceBothBody"))}
      </div>

      {needsNetwork && path !== "provider" && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]">
          <WifiOff className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
          <p className="flex-1 min-w-0 text-xs font-bold">{t("onbOffline")}</p>
          <Button onClick={onRetryOnline}>{t("retry")}</Button>
        </div>
      )}
    </div>
  );
}
