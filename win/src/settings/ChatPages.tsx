import { useEffect, useRef, useState } from "react";
import { Block, Button, Group, Page, Row, Segmented, Select, Toggle } from "./Controls";
import { Icon } from "../ui/icons/Icon";
import { SegmentedControl } from "../ui/SegmentedControl";
import InstructionsEditor from "./InstructionsEditor";
import LibraryPanel from "./LibraryPanel";
import { selectableModels } from "../modelKinds";
import { useProviderGroups, withProviderModels } from "../providers/modelOptions";
import { effortOptions, newChatStartOptions, webOptions } from "./pages";
import { allowedEfforts } from "../ai/effort";
import { NEURAL_VOICES, isNeuralVoiceAvailable, resolveNeuralVoice } from "../voice/neuralVoice";
import { previewVoice } from "../voice/preview";
import { isSystemVoiceSupported, listVoices } from "../voice/systemVoice";
import { DEFAULT_WORKSPACE_ID } from "../workspaces";
import type { ModelManager } from "./useModelManager";
import type { AppSettings } from "../types";

type Translate = (key: string) => string;

/** Sites the user chose "always allow" for, listed so they can be taken back. */
function TrustedSites({ t }: { t: Translate }) {
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    void window.electronAPI?.browserAgent?.trustedSites().then(setSites);
  }, []);
  if (!sites.length) return null;
  return (
    <Row label={t("browserTrustedSites")} description={t("browserTrustedSitesHint")}>
      <div className="flex flex-col items-end gap-1">
        {sites.map((origin) => (
          <div key={origin} className="flex items-center gap-2 text-[12px]">
            <span className="truncate">{origin}</span>
            <Button
              onClick={() => {
                void window.electronAPI?.browserAgent.revokeSite(origin);
                setSites((list) => list.filter((o) => o !== origin));
              }}
            >
              {t("browserTrustedRemove")}
            </Button>
          </div>
        ))}
      </div>
    </Row>
  );
}

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
  const providerGroups = useProviderGroups();
  return (
    <Page title={t("preferences")}>
      <Group>
        <Row label={t("model")}>
          <Select
            label={t("model")}
            value={chatModel}
            options={withProviderModels(
              selectableModels(manager.installed).map((entry) => ({
                id: entry.name,
                label: entry.name,
                hint: entry.parameterSize,
              })),
              providerGroups,
              t("draggyEngine"),
            )}
            onChange={onSelectChatModel}
          />
        </Row>
        <Row label={t("thinking")}>
          <Segmented
            label={t("thinking")}
            value={settings.defaultEffort}
            options={effortOptions(t, allowedEfforts("chat", settings.allowMaxInChat))}
            onChange={(defaultEffort) => onUpdate({ defaultEffort, effort: defaultEffort })}
          />
        </Row>
        <Row label={t("newChatStart")} description={t("newChatStartHint")}>
          <Segmented
            label={t("newChatStart")}
            value={settings.newChatStart}
            options={newChatStartOptions(t)}
            onChange={(newChatStart) => onUpdate({ newChatStart })}
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
        <Row label={t("browserActions")} description={t("browserActionsHint")}>
          <Toggle label={t("browserActions")} checked={settings.browserActions !== false} onChange={(browserActions) => onUpdate({ browserActions })} />
        </Row>
        <TrustedSites t={t} />
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

      <Group title={t("interactiveQuestions")}>
        <Row label={t("enableAiQuestions")} description={t("enableAiQuestionsHint")}>
          <Toggle
            checked={settings.aiQuestionsEnabled ?? true}
            onChange={(aiQuestionsEnabled) => onUpdate({ aiQuestionsEnabled })}
            label={t("enableAiQuestions")}
          />
        </Row>
        <Row label={t("requireAnswerBeforeContinuing")}>
          <Toggle
            checked={settings.aiQuestionsRequireAnswer ?? true}
            onChange={(aiQuestionsRequireAnswer) => onUpdate({ aiQuestionsRequireAnswer })}
            label={t("requireAnswerBeforeContinuing")}
          />
        </Row>
        <Row label={t("autoSkipAfterTimeout")}>
          <Toggle
            checked={settings.aiQuestionsAutoSkip ?? false}
            onChange={(aiQuestionsAutoSkip) => onUpdate({ aiQuestionsAutoSkip })}
            label={t("autoSkipAfterTimeout")}
          />
        </Row>
        <Row label={t("maxQuestionsPerSession")}>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.aiQuestionsMaxPerSession ?? 5}
            onChange={(e) =>
              onUpdate({ aiQuestionsMaxPerSession: Math.max(1, parseInt(e.target.value, 10) || 5) })
            }
            className="h-8 w-20 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </Row>
        <Row label={t("questionTimeoutMinutes")}>
          <input
            type="number"
            min={0}
            max={60}
            value={settings.aiQuestionsTimeoutMinutes ?? 0}
            onChange={(e) =>
              onUpdate({ aiQuestionsTimeoutMinutes: Math.max(0, parseInt(e.target.value, 10) || 0) })
            }
            className="h-8 w-20 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </Row>
      </Group>
    </Page>
  );
}

const VOICE_SPEEDS = [0.9, 1, 1.1, 1.25];

interface CloudState {
  providers: { id: string; name: string; configured: boolean }[];
  consent: Record<string, string[]>;
  refresh: () => void;
}

/** The providers a cloud voice can use and whether the user has agreed to each. Only loaded while the
 * cloud tier is chosen. */
function useCloudProviders(active: boolean): CloudState {
  const [state, setState] = useState<Omit<CloudState, "refresh">>({ providers: [], consent: {} });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    window.electronAPI?.tts
      ?.providers()
      .then((answer) => live && setState(answer))
      .catch(() => live && setState({ providers: [], consent: {} }));
    return () => {
      live = false;
    };
  }, [active, tick]);
  return { ...state, refresh: () => setTick((value) => value + 1) };
}

function CloudVoiceRows({
  settings,
  onUpdate,
  state,
  t,
}: Pick<ChatPageProps, "settings" | "onUpdate" | "t"> & { state: CloudState }) {
  const usable = state.providers.filter((provider) => provider.configured);
  const chosen = usable.find((entry) => entry.id === settings.cloudProvider) ?? usable[0];
  useEffect(() => {
    if (chosen && chosen.id !== settings.cloudProvider) onUpdate({ cloudProvider: chosen.id });
  }, [chosen, settings.cloudProvider, onUpdate]);
  if (usable.length === 0) {
    return (
      <Row label={t("cloudProvider")}>
        <span className="text-[12px] text-text-tertiary">{t("cloudNoProviders")}</span>
      </Row>
    );
  }
  const provider = chosen;
  const allowed = state.consent[provider.id]?.includes("text") ?? false;
  const setConsent = (grant: boolean) => {
    const call = grant
      ? window.electronAPI?.tts?.grantConsent(provider.id)
      : window.electronAPI?.tts?.revokeConsent(provider.id);
    void call?.then(state.refresh);
  };

  return (
    <>
      <Row label={t("cloudProvider")}>
        <Select
          label={t("cloudProvider")}
          value={provider.id}
          options={usable.map((entry) => ({ id: entry.id, label: entry.name }))}
          onChange={(cloudProvider) => onUpdate({ cloudProvider, cloudVoice: "", cloudModel: "" })}
        />
      </Row>
      <Row label={t("cloudVoiceName")}>
        <input
          type="text"
          aria-label={t("cloudVoiceName")}
          title={t("cloudVoiceNameHint")}
          placeholder={t("automatic")}
          value={settings.cloudVoice}
          onChange={(event) => onUpdate({ cloudProvider: provider.id, cloudVoice: event.target.value })}
          className="h-8 w-44 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </Row>
      <Block>
        <p className="text-[12px] leading-5 text-text-secondary">{t("cloudConsentText")}</p>
        <div className="mt-2 flex items-center gap-3">
          {allowed ? (
            <>
              <span className="text-[12px] text-text-tertiary">{t("cloudConsentAllowed")}</span>
              <Button onClick={() => setConsent(false)}>{t("cloudConsentRevoke")}</Button>
            </>
          ) : (
            <Button onClick={() => setConsent(true)}>{t("cloudConsentGrant")}</Button>
          )}
        </div>
      </Block>
    </>
  );
}

export function TalkPage({ settings, onUpdate, manager, t }: ChatPageProps) {
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const stopPreview = useRef<(() => void) | null>(null);

  useEffect(() => () => stopPreview.current?.(), []);

  const togglePreview = () => {
    if (previewing) {
      stopPreview.current?.();
      return;
    }
    setPreviewing(true);
    stopPreview.current = previewVoice({
      voice: resolveNeuralVoice(settings.neuralVoice),
      language: settings.language,
      rate: settings.voiceRate || 1,
      text: t("voiceSample"),
      onDone: () => {
        stopPreview.current = null;
        setPreviewing(false);
      },
    });
  };

  useEffect(() => {
    if (!isSystemVoiceSupported()) return;
    const refresh = () => setSystemVoices(listVoices(settings.language));
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [settings.language]);

  const neuralPossible = isNeuralVoiceAvailable(settings.language);
  const cloud = settings.voiceEngine === "cloud";
  const neural = settings.voiceEngine === "neural" && neuralPossible;
  const cloudProviders = useCloudProviders(cloud);
  const rate = settings.voiceRate || 1;

  const voices = neural
    ? NEURAL_VOICES.map((voice) => ({
        id: voice.id,
        label: voice.name,
        hint: voice.gender,
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
          <SegmentedControl
            ariaLabel={t("voiceEngine")}
            value={cloud ? "cloud" : neural ? "neural" : "system"}
            options={[
              { value: "system", label: t("systemVoice") },
              {
                value: "neural",
                label: t("naturalVoice"),
                icon: <Icon name="sparkle" size={12} />,
                disabled: !neuralPossible,
                title: neuralPossible ? undefined : t("naturalVoiceUnavailable"),
              },
              ...(window.electronAPI?.tts ? [{ value: "cloud", label: t("voiceCloud"), icon: <Icon name="cloud" size={12} /> }] : []),
            ]}
            onChange={(voiceEngine) => onUpdate({ voiceEngine: voiceEngine as AppSettings["voiceEngine"] })}
          />
        </Row>
        {cloud && <CloudVoiceRows settings={settings} onUpdate={onUpdate} state={cloudProviders} t={t} />}
        {!cloud && (
        <Row label={t("voiceLabel")}>
          <Select
            label={t("voiceLabel")}
            value={neural ? resolveNeuralVoice(settings.neuralVoice) : settings.voiceName}
            options={voices}
            placeholder={t("automatic")}
            onChange={(id) => onUpdate(neural ? { neuralVoice: id } : { voiceName: id })}
          />
        </Row>
        )}
        {neural && (
          <Row label={t("voicePreview")}>
            <Button onClick={togglePreview}>{previewing ? t("voicePreviewStop") : t("voicePreviewPlay")}</Button>
          </Row>
        )}
        <Row label={t("voiceSounds")}>
          <Toggle
            label={t("voiceSounds")}
            checked={settings.voiceSounds !== false}
            onChange={(voiceSounds) => onUpdate({ voiceSounds })}
          />
        </Row>
        <Row label={t("interfaceSounds")}>
          <Toggle
            label={t("interfaceSounds")}
            checked={settings.interfaceSounds === true}
            onChange={(interfaceSounds) => onUpdate({ interfaceSounds })}
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
