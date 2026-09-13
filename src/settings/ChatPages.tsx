import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Block, Group, Page, Row, Segmented, Select, Toggle } from "./Controls";
import InstructionsEditor from "./InstructionsEditor";
import LibraryPanel from "./LibraryPanel";
import { selectableModels } from "../modelKinds";
import { thinkingOptions, webOptions } from "./pages";
import { DEFAULT_NEURAL_VOICE, NEURAL_VOICES, isNeuralVoiceAvailable } from "../voice/neuralVoice";
import { isSystemVoiceSupported, listVoices } from "../voice/systemVoice";
import { DEFAULT_WORKSPACE_ID } from "../workspaces";
import type { ModelManager } from "./useModelManager";
import type { AppSettings } from "../types";

type Translate = (key: string) => string;

interface ChatPageProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  manager: ModelManager;
  t: Translate;
}

/** The Chat pages. Everything here reads and writes Chat's own settings and Chat's own workspace,
 * so nothing on them reaches a project. */

export function ChatPreferencesPage({
  settings,
  onUpdate,
  manager,
  chatModel,
  onSelectChatModel,
  t,
}: ChatPageProps & { chatModel: string; onSelectChatModel: (name: string) => void }) {
  return (
    <Page title={t("preferences")}>
      <Group>
        <Row label={t("model")}>
          <Select
            label={t("model")}
            value={chatModel}
            options={selectableModels(manager.installed).map((entry) => ({
              id: entry.name,
              label: entry.name,
              hint: entry.parameterSize,
            }))}
            onChange={onSelectChatModel}
          />
        </Row>
        <Row label={t("thinking")}>
          <Segmented
            label={t("thinking")}
            value={settings.thinkingMode}
            options={thinkingOptions(t)}
            onChange={(thinkingMode) => onUpdate({ thinkingMode })}
          />
        </Row>
        <Row label={t("webAccess")}>
          <Segmented
            label={t("webAccess")}
            value={settings.webMode}
            options={webOptions(t)}
            onChange={(webMode) => onUpdate({ webMode })}
          />
        </Row>
      </Group>

      <Group title={t("customInstructions")}>
        <Block>
          <InstructionsEditor
            instructions={settings.customInstructions}
            onChange={(customInstructions) => onUpdate({ customInstructions })}
            t={t}
          />
        </Block>
      </Group>
    </Page>
  );
}

const VOICE_SPEEDS = [0.9, 1, 1.1, 1.25];

export function TalkPage({ settings, onUpdate, manager, t }: ChatPageProps) {
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!isSystemVoiceSupported()) return;
    const refresh = () => setSystemVoices(listVoices(settings.language));
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [settings.language]);

  const neuralPossible = isNeuralVoiceAvailable(settings.language);
  const neural = settings.voiceEngine === "neural" && neuralPossible;
  const rate = settings.voiceRate || 1;

  const voices = neural
    ? NEURAL_VOICES.map((voice) => ({
        id: voice.id,
        label: voice.name,
        hint: `${voice.accent} · ${voice.gender}`,
      }))
    : systemVoices.map((voice) => ({ id: voice.name, label: voice.name, hint: voice.lang }));

  return (
    <Page title={t("talk")}>
      <Group>
        <Row label={t("talkModel")}>
          <Select
            label={t("talkModel")}
            value={settings.voiceModel}
            options={[
              { id: "", label: t("automatic") },
              ...selectableModels(manager.installed).map((entry) => ({
                id: entry.name,
                label: entry.name,
              })),
            ]}
            onChange={(voiceModel) => onUpdate({ voiceModel })}
          />
        </Row>
      </Group>

      <Group title={t("voiceLabel")}>
        <Row label={t("voiceEngine")}>
          <div role="radiogroup" aria-label={t("voiceEngine")} className="inline-flex rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-base)] p-[3px]">
            <EngineButton
              selected={!neural}
              onClick={() => onUpdate({ voiceEngine: "system" })}
              label={t("systemVoice")}
            />
            <EngineButton
              selected={neural}
              disabled={!neuralPossible}
              title={neuralPossible ? undefined : t("naturalVoiceEnglishOnly")}
              onClick={() => onUpdate({ voiceEngine: "neural" })}
              label={t("naturalVoice")}
              icon
            />
          </div>
        </Row>
        <Row label={t("voiceLabel")}>
          <Select
            label={t("voiceLabel")}
            value={neural ? settings.neuralVoice || DEFAULT_NEURAL_VOICE : settings.voiceName}
            options={voices}
            placeholder={t("automatic")}
            onChange={(id) => onUpdate(neural ? { neuralVoice: id } : { voiceName: id })}
          />
        </Row>
        <Row label={t("speed")}>
          <Segmented
            label={t("speed")}
            value={String(VOICE_SPEEDS.find((speed) => Math.abs(rate - speed) < 0.01) ?? 1)}
            options={VOICE_SPEEDS.map((speed) => ({ id: String(speed), label: `${speed}×` }))}
            onChange={(value) => onUpdate({ voiceRate: Number(value) })}
          />
        </Row>
      </Group>
    </Page>
  );
}

function EngineButton({
  selected,
  disabled,
  title,
  onClick,
  label,
  icon,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  label: string;
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        selected
          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
      }`}
    >
      {icon && <Sparkles className="w-3 h-3" />}
      {label}
    </button>
  );
}

export function LibraryPage({
  settings,
  onUpdate,
  manager,
  onLibraryChange,
  t,
}: ChatPageProps & { onLibraryChange?: () => void }) {
  return (
    <Page title={t("library")}>
      <Group>
        <Row label={t("enableLibrary")} description={t("enableLibraryHint")}>
          <Toggle
            label={t("enableLibrary")}
            checked={settings.libraryEnabled}
            onChange={(libraryEnabled) => onUpdate({ libraryEnabled })}
          />
        </Row>
      </Group>

      <Group title={t("indexedFolders")}>
        <Block>
          <LibraryPanel
            workspaceId={DEFAULT_WORKSPACE_ID}
            manager={manager}
            embedModel={settings.embedModel}
            onChange={onLibraryChange}
            t={t}
          />
        </Block>
      </Group>
    </Page>
  );
}
