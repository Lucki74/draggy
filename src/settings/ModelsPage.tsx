import { useState } from "react";
import { Button as UiButton } from "../ui/Button";
import { Icon } from "../ui/icons/Icon";
import { fill } from "../onboarding/text";
import { formatBytes } from "../formatBytes";
import { Badge, Block, ConfirmDialog, Group, Page, Row, Select } from "./Controls";
import ModelSearch from "./ModelSearch";
import CompactLimitField from "./CompactLimitField";
import DownloadsMenu from "./DownloadsMenu";
import { ImageModelRow } from "./ImageModelsSection";
import { useImageEngine } from "../images/useImageEngine";
import { cannotGenerate, isEmbeddingModel, isImageModel } from "../modelKinds";
import { CONTEXT_BUCKETS, displayModelName, formatContextCeiling, installedModelDisplayNames, quantizationOf, type InstalledModel } from "../llama";
import { isActivePull, type ModelManager } from "./useModelManager";
import type { AppSettings } from "../types";
import type { SettingsTab } from "./pages";
import { swallowed } from "../logger";

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

const formatSize = (bytes: number) => formatBytes(bytes);

const ABILITY_LABELS: Record<string, string> = {
  tools: "capabilityTools",
  vision: "capabilityVision",
  thinking: "capabilityThinking",
  embedding: "capabilityEmbedding",
};

/** What is installed, what can be downloaded, and the two models that serve everything else: the
 * one that indexes documents, and when a conversation gets folded. */
export default function ModelsPage({ manager, settings, chatModel, onUpdate, onNavigate, t }: ModelsPageProps) {
  const codeModel = settings.codeModel || chatModel;
  const displayNames = installedModelDisplayNames(manager.installed);
  const imageEngine = useImageEngine();
  const imageModels = imageEngine.models.filter((entry) => entry.installed);

  const removeImageModel = async (id: string) => {
    await window.electronAPI?.sd?.deleteModel(id).catch(swallowed("settings", "the main process already logged this call"));
    if (settings.imageModel === id) onUpdate({ imageModel: "" });
    imageEngine.refresh();
  };

  const pull = (reference: string, image: boolean) =>
    void manager.startPull(reference, { image }).then((installed) => installed && image && imageEngine.refresh());

  const contextSizeOptions = [
    { id: "", label: t("automatic") },
    { id: "max", label: t("maxContext") },
    ...CONTEXT_BUCKETS.map((n) => ({ id: String(n), label: `${(n / 1024).toFixed(0)}k` })),
  ];

  return (
    <Page title={t("models")}>
      <Group title={t("installed")}>
        {/* The model each mode runs is picked on its own page, so these jump straight there. */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="text-[13px] text-text-secondary">{t("chooseModel")}</span>
          <div className="flex items-center gap-2">
            {(["chat", "code"] as const).map((tab) => (
              <UiButton
                key={tab}
                variant="secondary"
                size="dense"
                onClick={() => onNavigate(tab)}
                iconEnd={<Icon name="caret-right" size={12} />}
              >
                {t(tab === "chat" ? "chatMode" : "codeMode")}
              </UiButton>
            ))}
          </div>
        </div>

        {manager.installed.length === 0 && imageModels.length === 0 ? (
          <Row label={t("noModelsFound")} />
        ) : (
          manager.installed.map((entry) => {
            const usedBy = [
              entry.name === chatModel ? t("chatMode") : null,
              entry.name === codeModel ? t("codeMode") : null,
            ].filter((label): label is string => Boolean(label));

            const loaded =
              manager.loaded.includes(entry.name) ||
              manager.loaded.some((n) => n.split(":")[0] === entry.name.split(":")[0]);

            return (
              <InstalledRow
                key={entry.name}
                entry={entry}
                displayName={displayNames.get(entry.name) || displayModelName(entry.name)}
                usedBy={usedBy}
                loaded={loaded}
                onUnload={() => manager.unload(entry.name)}
                onRemove={() => void manager.remove(entry.name)}
                t={t}
              />
            );
          })
        )}

        {imageModels.map((entry) => (
          <ImageModelRow
            key={entry.id}
            entry={entry}
            active={entry.id === imageEngine.model}
            onRemove={() => void removeImageModel(entry.id)}
            t={t}
          />
        ))}
      </Group>

      <Group title={t("downloadModel")}>
        <Block>
          <ModelSearch
            vram={manager.vram}
            ram={manager.ram}
            unifiedMemory={manager.unifiedMemory}
            phaseFor={(reference) => manager.pulls.find((pull) => pull.name === reference && isActivePull(pull))?.phase}
            onPick={(reference, _bytes, capabilities) => pull(reference, isImageModel(capabilities))}
            trailing={
              <DownloadsMenu
                pulls={manager.pulls}
                onCancel={manager.cancelPull}
                onRetry={(name) => pull(name, Boolean(manager.pulls.find((entry) => entry.name === name)?.image))}
                t={t}
              />
            }
            t={t}
          />

          {manager.error && <p role="alert" className="mt-3 text-[13px] text-danger">{manager.error}</p>}
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
                .map((entry) => ({ id: entry.name, label: displayNames.get(entry.name) || displayModelName(entry.name) })),
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
          <p className="mb-3 text-[14px] text-text-primary">{t("compactLimitSetting")}</p>
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

/** One installed model: name and size up front, how it fits this computer, and the file behind it
 * once opened. */
function InstalledRow({
  entry,
  displayName,
  usedBy,
  loaded,
  onUnload,
  onRemove,
  t,
}: {
  entry: InstalledModel;
  displayName?: string;
  usedBy: string[];
  loaded: boolean;
  onUnload: () => Promise<void>;
  onRemove: () => void;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const name = displayName || displayModelName(entry.name);
  const quantization = quantizationOf(entry.name);
  const abilities = entry.capabilities.filter((ability) => ABILITY_LABELS[ability]);
  const detailsId = `model-details-${entry.name.replace(/[^\w-]/g, "-")}`;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={fill(t("showModelDetails"), { model: name })}
          className="-mx-1 min-w-0 flex-1 rounded-sm px-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="flex items-center gap-2 text-[14px] leading-5 text-text-primary">
            <span className="truncate">{name}</span>
            {entry.parameterSize && (
              <span className="flex-shrink-0 text-[13px] text-text-secondary">{entry.parameterSize}</span>
            )}
            {quantization && (
              <span className="flex-shrink-0 font-mono text-[12px] text-text-tertiary">{quantization}</span>
            )}
            <Icon
              name="caret-down"
              size={12}
              className={`flex-shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-text-secondary">
            <span className="tabular-nums">{formatSize(entry.size)}</span>
            {cannotGenerate(entry.capabilities) && <Badge title={t("embeddingOnlyHint")}>{t("embeddingOnly")}</Badge>}
            {usedBy.map((label) => (
              <Badge key={label} strong>
                {label}
              </Badge>
            ))}
          </span>
        </button>

        {loaded && (
          <UiButton
            variant="secondary"
            size="dense"
            disabled={switching}
            icon={switching ? <Icon name="circle-notch" size={12} className="animate-spin" /> : undefined}
            onClick={() => {
              setSwitching(true);
              onUnload().finally(() => setSwitching(false));
            }}
            aria-label={`${t("unloadModelShort")} ${name}`}
          >
            {switching ? t("unloadingModel") : t("unloadModelShort")}
          </UiButton>
        )}
        <button
          type="button"
          onClick={() => setConfirmingRemove(true)}
          disabled={usedBy.length > 0}
          aria-label={`${t("remove")} ${name}`}
          title={usedBy.length > 0 ? t("inUse") : t("remove")}
          className="rounded-sm p-2 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-danger focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
      {confirmingRemove && (
        <ConfirmDialog
          title={fill(t("removeModelTitle"), { name })}
          body={t("removeModelBody")}
          confirmLabel={t("remove")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false);
            onRemove();
          }}
        />
      )}

      {open && (
        <dl
          id={detailsId}
          className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm bg-surface-raised px-3 py-2.5 text-[12px] leading-4"
        >
          <dt className="text-text-secondary">{t("modelFile")}</dt>
          <dd className="min-w-0 break-all font-mono text-text-primary">{entry.name}</dd>
          {entry.family && (
            <>
              <dt className="text-text-secondary">{t("modelFamily")}</dt>
              <dd className="text-text-primary">{entry.family}</dd>
            </>
          )}
          {Boolean(entry.contextLength) && (
            <>
              <dt className="text-text-secondary">{t("contextCeiling")}</dt>
              <dd className="text-text-primary">{formatContextCeiling(entry.contextLength!)}</dd>
            </>
          )}
          {abilities.length > 0 && (
            <>
              <dt className="text-text-secondary">{t("modelAbilities")}</dt>
              <dd className="text-text-primary">{abilities.map((ability) => t(ABILITY_LABELS[ability])).join(", ")}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
