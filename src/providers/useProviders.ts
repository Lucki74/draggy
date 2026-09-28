import { useCallback, useEffect, useState } from "react";
import { forgetRemoteModelInfo } from "../llama";
import type { DiscoveredServer, ProviderCatalogEntry, ProviderFailure, ProviderInstance } from "../types";

const listeners = new Set<() => void>();

/** Runs when a provider is added, changed or removed, so menus list the models it now offers. */
export function onProvidersChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function providersChanged() {
  forgetRemoteModelInfo();
  for (const listener of listeners) listener();
}

type Api = NonNullable<NonNullable<Window["electronAPI"]>["providers"]>;
const api = (): Api | undefined => (typeof window === "undefined" ? undefined : window.electronAPI?.providers);

export type ChangeResult = { ok: true; instance?: ProviderInstance } | { ok: false; error: ProviderFailure };

/** The providers the user set up, the catalog to add from, and the servers found on this computer.
 * `scanOnOpen` probes loopback once, when the page opens: never in the background. */
export function useProviders({ scanOnOpen = true }: { scanOnOpen?: boolean } = {}) {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [scanning, setScanning] = useState(false);

  const reload = useCallback(async () => {
    const list = await api()?.list().catch(() => null);
    if (list) setInstances(list);
  }, []);

  const scan = useCallback(async () => {
    const providers = api();
    if (!providers) return;
    setScanning(true);
    const answer = await providers.scan().catch(() => null);
    if (answer?.success) setServers(answer.servers);
    setScanning(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch populates instances on mount
    void reload();
    void api()
      ?.catalog()
      .then(setCatalog)
      .catch(() => undefined);
    if (scanOnOpen) void scan();
  }, [reload, scan, scanOnOpen]);

  /** Runs one change, then lists again, so the page shows what main kept rather than what was asked. */
  const change = useCallback(
    async (run: (providers: Api) => Promise<{ success: boolean; error?: ProviderFailure; instance?: ProviderInstance }>): Promise<ChangeResult> => {
      const providers = api();
      if (!providers) return { ok: false, error: { kind: "provider-unknown-error" } };
      const answer: { success: boolean; error?: ProviderFailure; instance?: ProviderInstance } = await run(providers).catch(
        (error: unknown) => ({ success: false, error: { kind: "provider-unknown-error", message: String(error) } }),
      );
      await reload();
      providersChanged();
      return answer.success ? { ok: true, instance: answer.instance } : { ok: false, error: answer.error ?? { kind: "provider-unknown-error" } };
    },
    [reload],
  );

  return {
    instances,
    catalog,
    servers,
    scanning,
    scan,
    add: (input: Parameters<Api["add"]>[0]) => change((p) => p.add(input)),
    update: (id: string, patch: Parameters<Api["update"]>[1]) => change((p) => p.update(id, patch)),
    remove: (id: string) => change((p) => p.remove(id)),
    setKey: (id: string, key: string) => change((p) => p.setKey(id, key)),
  };
}

export type Providers = ReturnType<typeof useProviders>;
