import { useEffect, useRef } from "react";
import { listInstalledModels, warmModel } from "../llama";
import { answerApiRequest, pickModel } from "./answer";
import { budgetStop } from "../stats/budgetGuard";
import type { AppSettings } from "../types";
import { logRendererError, swallowed } from "../logger";

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
    const bridge = window.draggy?.apiServer;
    if (!bridge) return;

    const running = new Map<string, AbortController>();

    const stopRequests = bridge.onRequest(({ id, request, defaultModel, webTools }) => {
      const controller = new AbortController();
      running.set(id, controller);

      void (async () => {
        try {
          const installed = await listInstalledModels()
            .then((models) => models.map((model) => model.name))
            .catch(swallowed("api", "best effort, the screen works without it", null));

          const { model, settings, t } = latest.current;

          const result = await answerApiRequest(request, {
            model: defaultModel?.trim() || model,
            webTools: webTools !== false,
            installed,
            settings,
            t,
            signal: controller.signal,
            checkBudget: (name) => budgetStop(name, settings.budgets),
            onText: (text) => bridge.text(id, text),
            onModel: (name) => bridge.model(id, name),
          });

          bridge.done(id, result);
        } catch (error) {
          logRendererError("api", "request failed", error, { requestId: id });
          bridge.failed(id, error instanceof Error ? error.message : String(error));
        } finally {
          running.delete(id);
        }
      })();
    });

    // A model-mode request is forwarded by the main process, which only needs the model loaded.
    const stopPrepares = bridge.onPrepare(({ id, model: requested, defaultModel }) => {
      void (async () => {
        try {
          const installed = await listInstalledModels()
            .then((models) => models.map((model) => model.name))
            .catch(swallowed("api", "best effort, the screen works without it", null));
          const { model, settings } = latest.current;
          const chosen = pickModel(requested, defaultModel?.trim() || model, installed);
          if (!chosen) throw new Error("No model is selected in Draggy yet.");
          const overBudget = await budgetStop(chosen, settings.budgets);
          if (overBudget) throw new Error(overBudget);
          await warmModel(chosen, "", 0, settings.fixedContextSize ?? null);
          bridge.prepared(id, chosen);
        } catch (error) {
          logRendererError("api", "request preparation failed", error, { requestId: id });
          bridge.prepared(id, "", error instanceof Error ? error.message : String(error));
        }
      })();
    });

    const stopAborts = bridge.onAbort((id) => running.get(id)?.abort());

    bridge.ready();

    return () => {
      stopRequests();
      stopPrepares();
      stopAborts();
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, []);
}
