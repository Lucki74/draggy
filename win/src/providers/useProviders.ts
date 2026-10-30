import { useCallback, useEffect, useState } from "react";
import { forgetRemoteModelInfo } from "../llama";
import { providerOf } from "../ai/providers";
import type { DiscoveredServer, ProviderCatalogEntry, ProviderFailure, ProviderInstance } from "../types";
import { logRendererEvent, swallowed } from "../logger";

const listeners = new Set<() => void>();
let bridge: (() => void) | null = null;

/** Runs when a provider is added, changed or removed, so menus list the models it now offers. */
export function onProvidersChange(listener: () => void): () => void {
  listeners.add(listener);
  // The main process also reports models it found on its own, so menus follow without a click.
  if (!bridge) bridge = api()?.onModelsChanged?.(() => providersChanged()) ?? null;
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      bridge?.();
      bridge = null;
    }
  };
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
    const list = await api()?.list().catch(swallowed("providers", "the main process already logged this call", null));
    if (list) setInstances(list);
  }, []);

  const scan = useCallback(async () => {
    const providers = api();
    if (!providers) return;
    setScanning(true);
    const answer = await providers.scan().catch(swallowed("providers", "the main process already logged this call", null));
    if (answer?.success) setServers(answer.servers);
    setScanning(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch populates instances on mount
    void reload();
    void api()
      ?.catalog()
      .then(setCatalog)
      .catch(swallowed("providers", "the main process already logged this call"));
    if (scanOnOpen) void scan();
    return onProvidersChange(() => void reload());
  }, [reload, scan, scanOnOpen]);

  /** Runs one change, then lists again, so the page shows what main kept rather than what was asked. */
  const change = useCallback(
    async (run: (providers: Api) => Promise<{ success: boolean; error?: ProviderFailure; instance?: ProviderInstance }>): Promise<ChangeResult> => {
      const providers = api();
      if (!providers) return { ok: false, error: { kind: "provider-unknown-error" } };
      const answer: { success: boolean; error?: ProviderFailure; instance?: ProviderInstance } = await run(providers).catch(
        (error: unknown) => {
          logRendererEvent("renderer.providers", "ERROR", "provider change threw", {
            error: error instanceof Error ? error.name : "Error",
          });
          return { success: false, error: { kind: "provider-unknown-error", message: String(error) } };
        },
      );
      logRendererEvent("renderer.providers", "INFO", "provider change", { ok: answer.success, kind: answer.error?.kind ?? null });
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

/** The provider a model belongs to, kept current as providers change; null for the engine's own. */
export function useProviderOf(model: string): ProviderInstance | null {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const remote = providerOf(model);
  useEffect(() => {
    if (!remote) return;
    let live = true;
    const load = () => void api()?.list().then((list) => live && setInstances(list)).catch(swallowed("providers", "the main process already logged this call"));
    load();
    const stop = onProvidersChange(load);
    return () => {
      live = false;
      stop();
    };
  }, [remote]);
  return remote ? (instances.find((instance) => instance.id === remote) ?? null) : null;
}
