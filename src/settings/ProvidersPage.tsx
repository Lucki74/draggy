import { useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button, Group, Page } from "./Controls";
import { AccountRow, AddProvider, DiscoveredRow, EngineRow, InstanceRow } from "../providers/ProviderRows";
import { useProviders } from "../providers/useProviders";

type Translate = (key: string) => string;

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

/** Servers on this computer first, the engine among them, then the providers reached with a key. */
export default function ProvidersPage({ engineModels, t }: { engineModels: number; t: Translate }) {
  const providers = useProviders();
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

  return (
    <Page title={t("providers")} description={t("providersHint")}>
      <Group title={t("onThisComputer")}>
        <EngineRow count={engineModels} t={t} />
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
    </Page>
  );
}
