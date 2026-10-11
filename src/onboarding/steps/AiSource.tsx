import { Icon } from "../../ui/icons/Icon";
import type { FirstDownloadPlan } from "../../boot/bootSequence";
import type { DiscoveredServer } from "../../types";
import { smallModelsOnly, type SetupPath } from "../flow";
import { fill } from "../text";
import { formatBytes } from "../../formatBytes";
import { Choice, OfflineNotice } from "./Choice";
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
  const weak = plan ? smallModelsOnly(plan.recommended.reference) : false;
  const needsNetwork = !installed && online === false;

  const hint = "mt-1.5 block text-[12px] leading-4 text-text-tertiary";
  return (
    <div className="space-y-8">
      <StepHeader title={t("onbSourceTitle")} />
      <div role="radiogroup" aria-label={t("onbSourceTitle")} className="space-y-3">
        <Choice
          large
          selected={path === "local"}
          onSelect={() => onPath("local")}
          title={t("onbSourceLocal")}
          marker={t("onbRecommended")}
          icon={<Icon name="cpu" size={20} />}
        >
          {t("onbSourceLocalBody")}
          {plan && !installed && (
            <span className={hint}>{fill(t("onbSourceDownload"), { size: formatBytes(plan.recommended.sizeBytes, language) })}</span>
          )}
          {weak && <span className={hint}>{t("onbSourceWeak")}</span>}
        </Choice>
        <Choice
          large
          selected={path === "provider"}
          onSelect={() => onPath("provider")}
          title={t("onbSourceProvider")}
          icon={<Icon name="cloud" size={20} />}
        >
          {t("onbSourceProviderBody")}
          {servers.length > 0 ? (
            servers.map((server) => (
              <span key={server.baseUrl} className={`${hint} flex items-center gap-1.5 text-text-secondary`}>
                <Icon name="hard-drives" size={12} />
                {fill(t("onbSourceFound"), { name: server.name })}
              </span>
            ))
          ) : (
            <span className={hint}>{t("onbSourceProviderData")}</span>
          )}
        </Choice>
        <Choice selected={path === "both"} onSelect={() => onPath("both")} title={t("onbSourceBoth")}>
          {t("onbSourceBothBody")}
        </Choice>
      </div>

      {needsNetwork && path !== "provider" && <OfflineNotice onRetry={onRetryOnline} t={t} />}
    </div>
  );
}
