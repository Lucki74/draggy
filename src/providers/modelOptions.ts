import { useEffect, useState } from "react";
import { listAllModels } from "../ai/providers";
import type { ModelGroup } from "../ai/providers";
import type { SelectOption } from "../settings/Controls";
import { onProvidersChange } from "./useProviders";

/** The enabled providers' ticked models, listed again whenever a provider changes. */
export function useProviderGroups(): ModelGroup[] {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      void listAllModels()
        .then((found) => live && setGroups(found.filter((group) => group.models.length > 0)))
        .catch(() => undefined);
    load();
    const stop = onProvidersChange(load);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return groups;
}

/** The engine's options, then each provider's under its name; with no provider on, the engine's alone and unheaded. */
export function withProviderModels(engine: SelectOption[], groups: ModelGroup[], engineLabel: string): SelectOption[] {
  if (groups.length === 0) return engine;
  return [
    ...engine.map((option) => ({ ...option, group: engineLabel })),
    ...groups.flatMap((group) => group.models.map((model) => ({ id: model.ref, label: model.name || model.id, group: group.label }))),
  ];
}
