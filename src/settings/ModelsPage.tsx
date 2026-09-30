import { ChevronRight, PowerOff, Trash2 } from "lucide-react";
import { Badge, Block, Group, Page, Row, Select } from "./Controls";
import ModelSearch from "./ModelSearch";
import CompactLimitField from "./CompactLimitField";
import DownloadsMenu from "./DownloadsMenu";
import { cannotGenerate, isEmbeddingModel } from "../modelKinds";
import { CONTEXT_BUCKETS, displayModelName } from "../llama";
import type { ModelManager } from "./useModelManager";
import type { AppSettings } from "../types";
import type { SettingsTab } from "./pages";

interface ModelsPageProps {
  manager: ModelManager;
  settings: AppSettings;
  /** The model Chat is running. */
  chatModel: string;
  onUpdate: (patch: Partial<AppSettings>) => void;
  /** Navigates to another settings tab, used for the chat/code preference shortcuts. */
  onNavigate: (tab: SettingsTab) => void;
  t: (key: string) => string;
}

const formatSize = (bytes: number) => (bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "");

/** What is installed, what can be downloaded, and the two models that serve everything else: the
 * one that indexes documents, and when a conversation gets folded. */
export default function ModelsPage({ manager, settings, chatModel, onUpdate, onNavigate, t }: ModelsPageProps) {
  const codeModel = settings.codeModel || chatModel;

  const contextSizeOptions = [
    { id: "", label: t("automatic") },
    { id: "max", label: t("maxContext") },
    ...CONTEXT_BUCKETS.map((n) => ({ id: String(n), label: `${(n / 1024).toFixed(0)}k` })),
  ];

  return (
    <Page title={t("models")}>
      <Group title={t("installed")}>
        {/* The model each mode runs is picked on its own page, so these jump straight there. */}
        <div className="px-4 py-2.5 flex items-center gap-3 bg-[var(--hover-bg)]/40">
          <span className="text-[11px] font-bold text-[var(--text-muted)]">{t("chooseModel")}</span>
          <div className="flex items-center gap-2">
            {(["chat", "code"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onNavigate(tab)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--text-main)] bg-[var(--bg-base)] border border-[var(--border-light)] hover:bg-[var(--hover-bg)] hover:border-[var(--text-muted)] transition-all shadow-xs"
              >
                {t(tab === "chat" ? "chatMode" : "codeMode")}
                <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
              </button>
            ))}
          </div>
        </div>

        {manager.installed.length === 0 ? (
          <Row label={t("noModelsFound")} />
        ) : (
          manager.installed.map((entry) => {
            const usedBy = [
              entry.name === chatModel ? t("chatMode") : null,
              entry.name === codeModel ? t("codeMode") : null,
            ].filter((label): label is string => Boolean(label));

            const isLoaded = manager.loaded.includes(entry.name) ||
              manager.loaded.some((n) => n.split(":")[0] === entry.name.split(":")[0]);

            return (
              <div key={entry.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="truncate">{displayModelName(entry.name)}</span>
                    {entry.parameterSize && (
                      <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] flex-shrink-0">
                        {entry.parameterSize}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted)]">
                    {formatSize(entry.size)}
                    {cannotGenerate(entry.capabilities) && (
                      <Badge title={t("embeddingOnlyHint")}>{t("embeddingOnly")}</Badge>
                    )}
                    {usedBy.map((label) => (
                      <Badge key={label} strong>
                        {label}
                      </Badge>
                    ))}
                  </p>
                </div>

                {isLoaded && (
                  <button
                    type="button"
                    onClick={() => void manager.unload(entry.name)}
                    aria-label={`${t("unloadModel")} ${displayModelName(entry.name)}`}
                    title={t("unloadModel")}
                    className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] transition-colors"
                  >
                    <PowerOff className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void manager.remove(entry.name)}
                  disabled={usedBy.length > 0}
                  aria-label={`${t("remove")} ${displayModelName(entry.name)}`}
                  title={usedBy.length > 0 ? t("inUse") : t("remove")}
                  className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </Group>

      <Group title={t("downloadModel")}>
        <Block>
          <ModelSearch
            vram={manager.vram}
            unifiedMemory={manager.unifiedMemory}
            phaseFor={(reference) => manager.pulls.find((pull) => pull.name === reference)?.phase}
            onPick={(reference) => void manager.startPull(reference)}
            trailing={<DownloadsMenu pulls={manager.pulls} onCancel={manager.cancelPull} t={t} />}
            t={t}
          />

          {manager.error && <p className="mt-3 text-xs font-bold text-red-500">{manager.error}</p>}
        </Block>
      </Group>

      <Group title={t("library")}>
        <Row label={t("embeddingModel")} description={t("embeddingModelHint")}>
          <Select
            label={t("embeddingModel")}
            value={settings.embedModel}
            options={[
              { id: "", label: t("automatic") },
              ...manager.installed
                .filter((entry) => isEmbeddingModel(entry.capabilities))
                .map((entry) => ({ id: entry.name, label: displayModelName(entry.name) })),
            ]}
            onChange={(embedModel) => onUpdate({ embedModel })}
          />
        </Row>
      </Group>

      <Group title={t("contextGroup")}>
        <Row label={t("fixedContextSize")} description={t("fixedContextSizeHint")}>
          <Select
            label={t("fixedContextSize")}
            value={settings.fixedContextSize ? String(settings.fixedContextSize) : ""}
            options={contextSizeOptions}
            onChange={(value) =>
              onUpdate({
                fixedContextSize: value === "max" ? "max" : value ? Number(value) : null,
              })
            }
          />
        </Row>
        <Block>
          <p className="mb-3 text-sm font-bold text-[var(--text-main)]">{t("compactLimitSetting")}</p>
          <CompactLimitField
            key={String(settings.compactLimit)}
            limit={settings.compactLimit ?? null}
            onChange={(compactLimit) => onUpdate({ compactLimit })}
            t={t}
          />
        </Block>
      </Group>
    </Page>
  );
}
