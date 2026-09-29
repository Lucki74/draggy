import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { displayModelName, listInstalledModels } from "../llama";
import type { InstalledModel } from "../llama";
import { listAllModels } from "../ai/providers";
import type { ModelGroup } from "../ai/providers";
import { selectableModels } from "../modelKinds";
import { onProvidersChange } from "./useProviders";

type Translate = (key: string) => string;

interface Choice {
  name: string;
  label: string;
  detail?: string;
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
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => {
      listInstalledModels()
        .then((models) => live && setInstalled(selectableModels(models)))
        .catch(() => undefined);
      listAllModels()
        .then((found) => live && setGroups(found.filter((group) => group.models.length > 0)))
        .catch(() => undefined);
    };
    load();
    const stop = onProvidersChange(load);
    return () => {
      live = false;
      stop();
    };
  }, [open]);

  const sections: { title: string | null; choices: Choice[] }[] = [
    {
      title: groups.length > 0 ? t("draggyEngine") : null,
      choices: installed.map((entry) => ({ name: entry.name, label: displayModelName(entry.name), detail: entry.parameterSize })),
    },
    ...groups.map((group) => ({
      title: group.label,
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
        <label className="flex items-center gap-2 px-2 py-1.5 ui-input">
          <Search className="w-3 h-3 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModelsPlaceholder")}
            aria-label={t("searchModelsPlaceholder")}
            className="flex-1 min-w-0 bg-transparent text-[11px] font-bold outline-none"
          />
        </label>
      )}
      <div className="max-h-56 overflow-y-auto space-y-1 pe-1">
        {shown.length === 0 ? (
          <p className="text-[11px] font-bold text-[var(--text-muted)] px-1 py-1">{t("noModelsFound")}</p>
        ) : (
          shown.map((section) => (
            <div key={section.title ?? ""} role={section.title ? "group" : undefined} aria-label={section.title ?? undefined} className="space-y-1">
              {section.title && (
                <p className="px-2 pt-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] truncate">{section.title}</p>
              )}
              {section.choices.map((choice) => (
                <button
                  key={choice.name}
                  type="button"
                  onClick={() => onPick(choice.name)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-start transition-colors ${
                    choice.name === model ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]" : "hover:bg-[var(--hover-bg)]"
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate text-[11px] font-bold">{choice.label}</span>
                  {choice.detail && <span className="text-[9px] font-bold opacity-60 flex-shrink-0">{choice.detail}</span>}
                  {choice.name === model && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}
