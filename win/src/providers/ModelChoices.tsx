import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { displayModelName, listInstalledModels } from "../llama";
import type { InstalledModel } from "../llama";
import { listAllModels } from "../ai/providers";
import type { ModelGroup } from "../ai/providers";
import { selectableModels } from "../modelKinds";
import { onProvidersChange } from "./useProviders";
import { ProviderIcon } from "./ProviderIcon";
import { swallowed } from "../logger";
import { CapabilityIcons } from "./CapabilityIcons";
import { formatBytes } from "../formatBytes";

type Translate = (key: string) => string;

/** The last listing, shown the moment the menu opens while a fresh one is asked for: an account's
 * listing starts its vendor's runtime, which takes a second or two. */
let remembered: ModelGroup[] = [];

interface Choice {
  name: string;
  label: string;
  detail?: string;
  capabilities?: string[];
}

/** The composer's model list: the engine's models, then each provider's ticked ones under its name.
 * With no provider on, it stays the flat list it always was. */
export default function ModelChoices({
  open,
  model,
  onPick,
  t,
}: {
  open: boolean;
  model: string;
  onPick: (name: string) => void;
  t: Translate;
}) {
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [groups, setGroups] = useState<ModelGroup[]>(remembered);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => {
      listInstalledModels()
        .then((models) => live && setInstalled(selectableModels(models)))
        .catch(swallowed("providers", "best effort, the screen works without it"));
      listAllModels()
        .then((found) => {
          remembered = found.filter((group) => group.models.length > 0);
          if (live) setGroups(remembered);
        })
        .catch(swallowed("providers", "best effort, the screen works without it"));
    };
    load();
    const stop = onProvidersChange(load);
    return () => {
      live = false;
      stop();
    };
  }, [open]);

  const sections: { title: string | null; type?: string; choices: Choice[] }[] = [
    {
      title: groups.length > 0 ? t("draggyEngine") : null,
      choices: installed.map((entry) => ({ name: entry.name, label: displayModelName(entry.name), detail: formatBytes(entry.size), capabilities: entry.capabilities })),
    },
    ...groups.map((group) => ({
      title: group.label,
      type: group.type,
      choices: group.models.map((entry) => ({ name: entry.ref, label: entry.name || entry.id })),
    })),
  ];
  const total = sections.reduce((sum, section) => sum + section.choices.length, 0);
  const needle = query.trim().toLowerCase();
  const shown = sections
    .map((section) => ({ ...section, choices: section.choices.filter((choice) => !needle || choice.label.toLowerCase().includes(needle)) }))
    .filter((section) => section.choices.length > 0);

  return (
    <>
      {total > 8 && (
        <label className="flex items-center gap-2 rounded-sm bg-surface-base px-2 py-1.5 text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus-within:ring-2 focus-within:ring-focus">
          <Icon name="magnifying-glass" size={12} className="text-text-secondary" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModelsPlaceholder")}
            aria-label={t("searchModelsPlaceholder")}
            className="flex-1 min-w-0 bg-transparent text-[11px] font-medium outline-none"
          />
        </label>
      )}
      <div className="max-h-56 overflow-y-auto space-y-1 pe-1">
        {shown.length === 0 ? (
          <p className="text-[11px] font-medium text-text-secondary px-1 py-1">{t("noModelsFound")}</p>
        ) : (
          shown.map((section) => (
            <div key={section.title ?? ""} role={section.title ? "group" : undefined} aria-label={section.title ?? undefined} className="space-y-1">
              {section.title && (
                <p className="flex items-center gap-1.5 px-2 pt-1 text-[12px] font-medium text-text-secondary">
                  {section.type && <ProviderIcon type={section.type} name={section.title} size="w-3 h-3" />}
                  <span className="truncate">{section.title}</span>
                </p>
              )}
              {section.choices.map((choice) => (
                <button
                  key={choice.name}
                  type="button"
                  onClick={() => onPick(choice.name)}
                  aria-current={choice.name === model ? "true" : undefined}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-start transition-colors hover:bg-surface-raised ${
                    choice.name === model ? "bg-surface-tint" : ""
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px] font-medium text-text-primary">{choice.label}</span>
                    {choice.detail && <span className="block truncate text-[11px] text-text-secondary tabular-nums">{choice.detail}</span>}
                  </span>
                  {choice.capabilities && <CapabilityIcons capabilities={choice.capabilities} t={t} size={13} />}
                  {choice.name === model && <Icon name="check" size={14} className="flex-shrink-0 text-text-primary" />}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}
