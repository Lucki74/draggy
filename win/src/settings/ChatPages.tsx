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
import { modelKey, modelOptions, resolveChoice, splitModelKey, voiceOptions, type CloudProvider } from "./cloudChoice";
import type { ModelManager } from "./useModelManager";
import type { AppSettings } from "../types";
import { swallowed } from "../logger";

type Translate = (key: string) => string;

/** Sites the user chose "always allow" for, listed so they can be taken back. */
function TrustedSites({ t }: { t: Translate }) {
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    window.draggy?.browserAgent
      ?.trustedSites()
      .then(setSites)
      .catch(swallowed("settings", "the main process already logged this call"));
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
                // The row goes only once the site is really forgotten, so a failed revoke stays visible.
                window.draggy?.browserAgent
                  .revokeSite(origin)
                  .then(() => setSites((list) => list.filter((o) => o !== origin)))
                  .catch(swallowed("settings", "the main process already logged this call"));
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
        <Row label={t("newChatStart")}>
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

    </Page>
  );
}

const VOICE_SPEEDS = [0.9, 1, 1.1, 1.25];

interface CloudState {
  providers: CloudProvider[];
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
    window.draggy?.tts
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
  const choice = resolveChoice(state.providers, {
    provider: settings.cloudProvider,
    model: settings.cloudModel,
    voice: settings.cloudVoice,
  });
  // A saved choice that no longer resolves (a removed key, a legacy voice name) is rewritten to what is used.
  // Nothing is rewritten while no provider can speak, so a list still loading cannot wipe the saved choice.
  useEffect(() => {
    if (!choice.provider) return;
    if (
      choice.provider !== settings.cloudProvider ||
      choice.model !== settings.cloudModel ||
      choice.voice !== settings.cloudVoice
    ) {
      onUpdate({ cloudProvider: choice.provider, cloudModel: choice.model, cloudVoice: choice.voice });
    }
  }, [choice.provider, choice.model, choice.voice, settings.cloudProvider, settings.cloudModel, settings.cloudVoice, onUpdate]);

  if (!choice.provider) {
    return (
      <Row label={t("cloudVoiceModel")}>
        <span className="text-[12px] text-text-tertiary">{t("cloudNoProviders")}</span>
      </Row>
    );
  }
  const allowed = state.consent[choice.provider]?.includes("text") ?? false;
  const setConsent = (grant: boolean) => {
    const call = grant
      ? window.draggy?.tts?.grantConsent(choice.provider)
      : window.draggy?.tts?.revokeConsent(choice.provider);
    void call?.then(state.refresh);
  };

  return (
    <>
      <Row label={t("cloudVoiceModel")}>
        <Select
          label={t("cloudVoiceModel")}
          value={modelKey(choice.provider, choice.model)}
          options={modelOptions(state.providers)}
          onChange={(key) => {
            const next = splitModelKey(key);
            onUpdate({ cloudProvider: next.provider, cloudModel: next.model, cloudVoice: "" });
          }}
        />
      </Row>
      <Row label={t("cloudVoiceName")}>
        <Select
          label={t("cloudVoiceName")}
          value={choice.voice}
          options={voiceOptions(state.providers, choice, t("automatic"))}
          onChange={(cloudVoice) => onUpdate({ cloudVoice })}
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
              ...(window.draggy?.tts ? [{ value: "cloud", label: t("voiceCloud"), icon: <Icon name="cloud" size={12} /> }] : []),
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
