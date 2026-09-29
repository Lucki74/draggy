import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button, Group, Select } from "../../settings/Controls";
import { AccountRow, AddProvider, DiscoveredRow, InstanceRow } from "../../providers/ProviderRows";
import { VENDOR_NAMES } from "../../providers/vendors";
import { useProviderGroups } from "../../providers/modelOptions";
import type { Providers } from "../../providers/useProviders";
import { fill } from "../text";
import StepHeader from "./StepHeader";

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

/** The Providers page's own rows, in its order, plus the one model the app opens on. */
export default function Provider({
  providers,
  model,
  onModel,
  t,
}: {
  providers: Providers;
  model: string | null;
  onModel: (model: string | null) => void;
  t: (key: string) => string;
}) {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const plans = useRef(new Map<string, () => void>());
  const register = (id: string, begin: (() => void) | null) => (begin ? plans.current.set(id, begin) : plans.current.delete(id));
  const { instances, catalog, servers, scanning } = providers;
  const entryOf = (type: string) => catalog.find((entry) => entry.id === type);
  const local = instances.filter((instance) => instance.kind === "local");
  const keyed = instances.filter((instance) => instance.kind === "cloud");
  const accounts = catalog.filter((entry) => entry.kind === "account");
  const addedHosts = new Set(local.map((instance) => hostOf(instance.baseUrl)));
  const runningHosts = new Set(servers.map((server) => hostOf(server.baseUrl)));
  const found = servers.filter((server) => !addedHosts.has(hostOf(server.baseUrl)));

  const groups = useProviderGroups();
  const options = useMemo(
    () => groups.flatMap((group) => group.models.map((entry) => ({ id: entry.ref, label: entry.id, group: group.label }))),
    [groups],
  );
  // The first ticked model until the user picks one; none once nothing is ticked.
  useEffect(() => {
    if (options.some((option) => option.id === model)) return;
    onModel(options[0]?.id ?? null);
  }, [options, model, onModel]);

  return (
    <div className="space-y-6">
      <StepHeader title={t("onbProviderTitle")} body={t("onbProviderBody")} />

      <Group title={t("onThisComputer")}>
        {local.map((instance) => (
          <InstanceRow
            key={instance.id}
            instance={instance}
            entry={entryOf(instance.type)}
            running={scanning ? undefined : runningHosts.has(hostOf(instance.baseUrl))}
            providers={providers}
            initiallyOpen={instance.id === justAdded}
            t={t}
          />
        ))}
        {found.map((server) => (
          <DiscoveredRow key={server.baseUrl} server={server} providers={providers} />
        ))}
        <div className="px-4 py-3">
          <Button onClick={() => void providers.scan()} disabled={scanning}>
            <span className="inline-flex items-center gap-1.5">
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {t("scanServers")}
            </span>
          </Button>
        </div>
      </Group>

      {accounts.length > 0 && (
        <Group title={t("accountsGroup")}>
          {accounts.map((entry) => (
            <AccountRow
              key={entry.id}
              entry={entry}
              instance={instances.find((instance) => instance.type === entry.id)}
              providers={providers}
              register={register}
              note={entry.vendor ? fill(t("onbAccountData"), { vendor: VENDOR_NAMES[entry.vendor] }) : undefined}
              t={t}
            />
          ))}
        </Group>
      )}

      <Group
        title={t("apiKeysGroup")}
        description={catalog.some((entry) => entry.available === false) ? t("noKeystoreProviders") : undefined}
      >
        {keyed.map((instance) => (
          <InstanceRow
            key={instance.id}
            instance={instance}
            entry={entryOf(instance.type)}
            providers={providers}
            initiallyOpen={instance.id === justAdded}
            t={t}
          />
        ))}
        <AddProvider
          catalog={catalog}
          providers={providers}
          onAdded={setJustAdded}
          onPlan={(id) => plans.current.get(id)?.()}
          t={t}
        />
      </Group>

      <div className="space-y-2">
        <p className="text-xs font-bold text-[var(--text-muted)]">{t("onbProviderStart")}</p>
        {options.length > 0 ? (
          <Select value={model ?? ""} options={options} onChange={onModel} label={t("onbProviderStart")} />
        ) : (
          <p className="text-sm font-medium text-[var(--text-muted)]">{t("onbProviderPick")}</p>
        )}
      </div>
    </div>
  );
}
