import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { StatusDot } from "../ui/StatusDot";
import ApiLog from "./ApiLog";
import { Block, Group, Row, Select, Toggle } from "./Controls";
import type { ApiSampling, ApiServerConfig, ApiServerStatus } from "../types";
import { copyText } from "../utils";
import { swallowed } from "../logger";

interface ApiServerFieldProps {
  t: (key: string) => string;
  /** Installed model names, for the default model and the aliases. */
  models?: string[];
}

const INPUT =
  "h-8 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus";
const AREA =
  "w-full resize-y rounded-sm bg-surface-base px-3 py-2 text-[13px] leading-5 text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus";
const ICON_BUTTON =
  "rounded-sm p-2 text-text-secondary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus";
const CODE =
  "min-w-0 flex-1 truncate rounded-sm bg-surface-base px-3 py-1.5 font-mono text-[12px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule)]";

type Apply = (work: () => Promise<ApiServerStatus>) => Promise<void>;

/** A number typed in and saved on blur or Enter. `strict` ignores a value out of range instead of
 * clamping it, and `optional` lets an empty box clear the value. */
function NumberInput({
  label,
  value,
  min,
  max,
  integer = true,
  strict,
  optional,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  integer?: boolean;
  strict?: boolean;
  optional?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === "") {
      if (optional && value !== undefined) onCommit(null);
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) return;
    if (strict && (parsed < min || parsed > max)) return;
    const next = Math.min(max, Math.max(min, parsed));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={label}
      value={draft ?? (value === undefined ? "" : String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className={`${INPUT} w-32`}
    />
  );
}

/** Text saved on blur. */
function TextArea({
  label,
  value,
  mono,
  rows,
  onCommit,
}: {
  label: string;
  value: string;
  mono?: boolean;
  rows: number;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block">
      <span className="text-[14px] leading-5 text-text-primary">{label}</span>
      <textarea
        value={draft ?? value}
        rows={rows}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        className={`${AREA} mt-2 ${mono ? "font-mono text-[12px]" : ""}`}
      />
    </label>
  );
}

/** The client-name to model rows. A row is saved once both sides are filled. */
function Aliases({
  aliases,
  models,
  t,
  apply,
  api,
}: {
  aliases: Record<string, string>;
  models: string[];
  t: (key: string) => string;
  apply: Apply;
  api: NonNullable<Window["draggy"]>["apiServer"];
}) {
  const [rows, setRows] = useState<{ name: string; model: string }[]>(
    Object.entries(aliases).map(([name, model]) => ({ name, model })),
  );

  const save = (next: { name: string; model: string }[]) => {
    setRows(next);
    const map: Record<string, string> = {};
    for (const row of next) {
      const name = row.name.trim();
      const model = row.model.trim();
      if (name && model) map[name] = model;
    }
    void apply(() => api.configure({ aliases: map }));
  };

  const edit = (index: number, change: Partial<{ name: string; model: string }>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <Block>
      <div className="space-y-2">
        <span className="block text-[14px] leading-5 text-text-primary">{t("apiAliases")}</span>
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              aria-label={t("apiAliasClient")}
              placeholder={t("apiAliasClient")}
              value={row.name}
              onChange={(event) => edit(index, { name: event.target.value })}
              onBlur={() => save(rows)}
              className={`${INPUT} min-w-0 flex-1`}
            />
            <input
              type="text"
              list="api-alias-models"
              aria-label={t("apiAliasModel")}
              placeholder={t("apiAliasModel")}
              value={row.model}
              onChange={(event) => edit(index, { model: event.target.value })}
              onBlur={() => save(rows)}
              className={`${INPUT} min-w-0 flex-1`}
            />
            <button
              type="button"
              aria-label={t("apiAliasRemove")}
              title={t("apiAliasRemove")}
              onClick={() => save(rows.filter((_, i) => i !== index))}
              className={ICON_BUTTON}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <datalist id="api-alias-models">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => setRows([...rows, { name: "", model: "" }])}
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-[13px] text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus"
        >
          <Icon name="plus" size={14} />
          {t("apiAliasAdd")}
        </button>
      </div>
    </Block>
  );
}

const SAMPLING_FIELDS: {
  key: Exclude<keyof ApiSampling, "overrideClient">;
  label: string;
  min: number;
  max: number;
  integer?: boolean;
}[] = [
  { key: "temperature", label: "apiTemperature", min: 0, max: 2, integer: false },
  { key: "top_p", label: "apiTopP", min: 0, max: 1, integer: false },
  { key: "top_k", label: "apiTopK", min: 0, max: 1000 },
  { key: "min_p", label: "apiMinP", min: 0, max: 1, integer: false },
  { key: "repeat_penalty", label: "apiRepeatPenalty", min: 0, max: 2, integer: false },
  { key: "max_tokens", label: "apiMaxTokens", min: 1, max: 1_000_000 },
  { key: "seed", label: "apiSeed", min: -2_147_483_648, max: 2_147_483_647 },
];

/** The API page's sections: Server, Answering, Defaults and Engine. Every control saves as it is
 * changed, and the main process checks each value. */
export default function ApiServerField({ t, models = [] }: ApiServerFieldProps) {
  const [status, setStatus] = useState<ApiServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const api = window.draggy?.apiServer;

  useEffect(() => {
    if (!api) return;
    let current = true;
    api
      .status()
      .then((next) => {
        if (current) setStatus(next);
      })
      .catch(swallowed("settings", "the main process already logged this call"));
    return () => {
      current = false;
    };
  }, [api]);

  if (!api) return null;
  if (!status) return <Icon name="circle-notch" size={16} className="animate-spin text-text-tertiary" />;

  const settings = status.settings;
  const apply: Apply = async (work) => {
    setBusy(true);
    try {
      setStatus(await work());
    } finally {
      setBusy(false);
    }
  };
  const configure = (config: ApiServerConfig) => void apply(() => api.configure(config));

  const copy = async (label: string, text: string) => {
    if (!(await copyText(text))) return;
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const number = (
    label: string,
    key: "maxParallel" | "queueWaitSecs" | "requestTimeoutSecs" | "maxBodyMb",
    min: number,
    max: number,
  ) => (
    <Row label={t(label)}>
      <NumberInput
        label={t(label)}
        value={settings[key]}
        min={min}
        max={max}
        onCommit={(value) => value !== null && configure({ [key]: value })}
      />
    </Row>
  );

  const models_ = settings.defaultModel && !models.includes(settings.defaultModel)
    ? [settings.defaultModel, ...models]
    : models;

  return (
    <div className="space-y-8">
      <Group title={t("apiSectionServer")}>
        <Row label={t("apiServerEnable")}>
          <div className="flex items-center gap-2">
            {busy && <Icon name="circle-notch" size={16} className="animate-spin text-text-tertiary" />}
            <Toggle checked={status.enabled} onChange={(enabled) => configure({ enabled })} />
          </div>
        </Row>

        {status.enabled && (
          <>
            <Row label={t("apiServerStatus")}>
              <p role="status" className="flex items-center gap-2 text-[13px] text-text-primary">
                <StatusDot status={status.running ? "ok" : "danger"} />
                {status.running
                  ? t("apiServerListening")
                  : `${t("apiServerStopped")}${status.error ? `: ${status.error}` : ""}`}
              </p>
            </Row>

            <Row label={t("apiServerAddress")}>
              <div className="flex items-center gap-2">
                <code className={CODE}>{status.baseUrl}</code>
                <button
                  onClick={() => copy("url", status.baseUrl)}
                  aria-label={t("apiServerCopyAddress")}
                  title={t("apiServerCopyAddress")}
                  type="button"
                  className={ICON_BUTTON}
                >
                  {copied === "url" ? <Icon name="check" size={16} /> : <Icon name="copy" size={16} />}
                </button>
              </div>
            </Row>
          </>
        )}

        <Row label={t("apiServerPort")}>
          <NumberInput
            label={t("apiServerPort")}
            value={status.port}
            min={1024}
            max={65535}
            strict
            onCommit={(port) => port !== null && configure({ port })}
          />
        </Row>

        {status.enabled && status.key && (
          <Row label={t("apiServerKey")}>
            <div className="flex items-center gap-2">
              <code className={CODE}>{revealed ? status.key : "•".repeat(24)}</code>
              <button
                onClick={() => setRevealed((value) => !value)}
                aria-label={revealed ? t("apiServerHideKey") : t("apiServerShowKey")}
                title={revealed ? t("apiServerHideKey") : t("apiServerShowKey")}
                type="button"
                className={ICON_BUTTON}
              >
                {revealed ? <Icon name="eye-slash" size={16} /> : <Icon name="eye" size={16} />}
              </button>
              <button
                onClick={() => copy("key", status.key as string)}
                aria-label={t("apiServerCopyKey")}
                title={t("apiServerCopyKey")}
                type="button"
                className={ICON_BUTTON}
              >
                {copied === "key" ? <Icon name="check" size={16} /> : <Icon name="copy" size={16} />}
              </button>
              <button
                onClick={() => void apply(() => api.regenerateKey())}
                aria-label={t("apiServerNewKey")}
                title={t("apiServerNewKey")}
                type="button"
                className={ICON_BUTTON}
              >
                <Icon name="arrow-clockwise" size={16} />
              </button>
            </div>
          </Row>
        )}

        {number("apiMaxParallel", "maxParallel", 1, 16)}
        {number("apiQueueWait", "queueWaitSecs", 0, 600)}
        {number("apiRequestTimeout", "requestTimeoutSecs", 10, 3600)}
        {number("apiMaxBody", "maxBodyMb", 1, 64)}
      </Group>

      <Group title={t("apiSectionAnswering")}>
        <Row label={t("apiServerMode")}>
          <Select
            label={t("apiServerMode")}
            value={status.mode}
            onChange={(mode) => configure({ mode: mode === "model" ? "model" : "agent" })}
            options={[
              { id: "agent", label: t("apiServerModeAgent") },
              { id: "model", label: t("apiServerModeModel") },
            ]}
          />
        </Row>
        <Row label={t("apiDefaultModel")}>
          <Select
            label={t("apiDefaultModel")}
            value={settings.defaultModel}
            onChange={(defaultModel) => configure({ defaultModel })}
            options={[
              { id: "", label: t("apiModelInUse") },
              ...models_.map((model) => ({ id: model, label: model })),
            ]}
          />
        </Row>
        <Row label={t("apiListCloud")}>
          <Toggle
            label={t("apiListCloud")}
            checked={settings.listCloudModels}
            onChange={(listCloudModels) => configure({ listCloudModels })}
          />
        </Row>
        <Row label={t("apiAgentWebTools")}>
          <Toggle
            label={t("apiAgentWebTools")}
            checked={settings.agentWebTools}
            onChange={(agentWebTools) => configure({ agentWebTools })}
          />
        </Row>
        <Row label={t("apiSendReasoning")}>
          <Toggle
            label={t("apiSendReasoning")}
            checked={settings.sendReasoning}
            onChange={(sendReasoning) => configure({ sendReasoning })}
          />
        </Row>
        <Aliases
          key={JSON.stringify(settings.aliases)}
          aliases={settings.aliases}
          models={models}
          t={t}
          apply={apply}
          api={api}
        />
        <Block>
          <TextArea
            label={t("apiSystemPrompt")}
            value={settings.systemPrompt}
            rows={4}
            onCommit={(systemPrompt) => configure({ systemPrompt })}
          />
        </Block>
      </Group>

      <Group title={t("apiSectionDefaults")}>
        {SAMPLING_FIELDS.map((field) => (
          <Row key={field.key} label={t(field.label)}>
            <NumberInput
              label={t(field.label)}
              value={settings.sampling[field.key]}
              min={field.min}
              max={field.max}
              integer={field.integer ?? true}
              optional
              onCommit={(value) => configure({ sampling: { [field.key]: value } })}
            />
          </Row>
        ))}
        <Row label={t("apiOverrideClient")}>
          <Toggle
            label={t("apiOverrideClient")}
            checked={settings.sampling.overrideClient === true}
            onChange={(overrideClient) => configure({ sampling: { overrideClient } })}
          />
        </Row>
      </Group>

      <Group title={t("apiSectionAccess")}>
        <Block>
          <TextArea
            label={t("apiAllowedOrigins")}
            value={settings.allowedOrigins.join("\n")}
            mono
            rows={3}
            onCommit={(text) =>
              configure({
                allowedOrigins: text
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </Block>
        <Row label={t("apiOllamaNoKey")}>
          <Toggle
            label={t("apiOllamaNoKey")}
            checked={settings.ollamaNoKey}
            onChange={(ollamaNoKey) => configure({ ollamaNoKey })}
          />
        </Row>
      </Group>

      <Group title={t("apiSectionEngine")}>
        <Block>
          <TextArea
            label={t("apiExtraArgs")}
            value={settings.extraEngineArgs}
            mono
            rows={3}
            onCommit={(extraEngineArgs) => configure({ extraEngineArgs })}
          />
        </Block>
      </Group>

      <Group title={t("apiSectionLog")}>
        <Row label={t("apiLogEnable")}>
          <Toggle
            label={t("apiLogEnable")}
            checked={settings.logRequests}
            onChange={(logRequests) => configure({ logRequests })}
          />
        </Row>
        {settings.logRequests && (
          <>
            <Row label={t("apiLogSize")}>
              <NumberInput
                label={t("apiLogSize")}
                value={settings.logSize}
                min={10}
                max={500}
                onCommit={(value) => value !== null && configure({ logSize: value })}
              />
            </Row>
            <Block>
              <ApiLog t={t} baseUrl={status.baseUrl} enabled />
            </Block>
          </>
        )}
      </Group>
    </div>
  );
}
