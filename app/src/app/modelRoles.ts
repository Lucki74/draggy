import { useEffect, useState } from "react";
import { isRemote, listAllModels } from "../ai/providers";
import { listInstalledModels } from "../llama";
import { onProvidersChange } from "../providers/useProviders";
import { swallowed } from "../logger";
import type { AppSettings } from "../types";

/** A background job that can run on its own model. */
export type ModelRole = "plan" | "summary";

/** The model ids the renderer can run right now: installed local models and signed-in cloud refs. */
export interface KnownModels {
  local: Set<string>;
  cloud: Set<string>;
}

/** The model a role runs. Blank, missing or unavailable falls back to the active model. */
export function resolveRole(
  settings: Pick<AppSettings, "planModel" | "summaryModel">,
  role: ModelRole,
  active: string,
  known: KnownModels | null,
): string {
  const chosen = (role === "plan" ? settings.planModel : settings.summaryModel)?.trim() ?? "";
  if (!chosen) return active;
  // A local summary model would swap the loaded engine mid-conversation, so only cloud summaries differ.
  if (role === "summary" && !isRemote(chosen) && chosen !== active) return active;
  if (known && !known.local.has(chosen) && !known.cloud.has(chosen)) return active;
  return chosen;
}

/** Keeps the renderer's view of installed and signed-in models current, then resolves each role. */
export function useRoleResolver(
  settings: Pick<AppSettings, "planModel" | "summaryModel">,
  active: string,
): (role: ModelRole) => string {
  const [known, setKnown] = useState<KnownModels | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([listInstalledModels(), listAllModels()])
        .then(([installed, groups]) => {
          if (!live) return;
          setKnown({
            local: new Set(installed.map((model) => model.name)),
            cloud: new Set(groups.flatMap((group) => group.models.map((model) => model.ref))),
          });
        })
        .catch(swallowed("app", "best effort, saved roles stay as set"));
    load();
    const stop = onProvidersChange(load);
    return () => {
      live = false;
      stop();
    };
  }, [active]);
  return (role) => resolveRole(settings, role, active, known);
}
