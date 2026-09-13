import { useEffect, useRef } from "react";
import { listInstalledModels } from "../ollama";
import { answerApiRequest } from "./answer";
import type { AppSettings } from "../types";

interface BridgeInput {
  model: string | null;
  settings: AppSettings;
  t: (key: string) => string;
}

/**
 * Where requests to the local API are answered. The server lives in the main
 * process, but the loop lives here, so the main process forwards each request
 * to this window and this hands the text back as it is written.
 *
 * Mounted once for the life of the window. The model and settings are read at
 * the moment a request arrives, not when the listener was set up.
 */
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
