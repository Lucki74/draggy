import { useEffect, useRef } from "react";
import { listInstalledModels } from "../llama";
import { answerApiRequest } from "./answer";
import type { AppSettings } from "../types";

interface BridgeInput {
  model: string | null;
  settings: AppSettings;
  t: (key: string) => string;
}

/** Answers local API requests the main process forwards here, where the loop lives, streaming text
 * back. Model and settings are read when a request arrives. */
export function useApiBridge(input: BridgeInput): void {
  const latest = useRef(input);

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    const bridge = window.electronAPI?.apiServer;
    if (!bridge) return;

    const running = new Map<string, AbortController>();

    const stopRequests = bridge.onRequest(({ id, request }) => {
      const controller = new AbortController();
      running.set(id, controller);

      void (async () => {
        try {
          const installed = await listInstalledModels()
            .then((models) => models.map((model) => model.name))
            .catch(() => null);

          const { model, settings, t } = latest.current;

          const result = await answerApiRequest(request, {
            model,
            installed,
            settings,
            t,
            signal: controller.signal,
            onText: (text) => bridge.text(id, text),
            onModel: (name) => bridge.model(id, name),
          });

          bridge.done(id, result);
        } catch (error) {
          bridge.failed(id, error instanceof Error ? error.message : String(error));
        } finally {
          running.delete(id);
        }
      })();
    });

    const stopAborts = bridge.onAbort((id) => running.get(id)?.abort());

    bridge.ready();

    return () => {
      stopRequests();
      stopAborts();
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);
}
