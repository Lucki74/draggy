import { useState } from "react";
import SettingsPage from "../../settings/SettingsPage";
import ModelsPage from "../../settings/ModelsPage";
import type { ModelManager } from "../../settings/useModelManager";
import { translations } from "../../translations";
import { defaultSettings } from "../../app/settings";
import type { AppSettings } from "../../types";

const noop = () => {};

/** Settings at a desktop size, on fake data, so the shell and rows can be checked outside Electron. */
export function SettingsPreview() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  return (
    <div className="flex h-[640px] w-[1040px] overflow-hidden rounded-md border border-rule">
      <SettingsPage
        settings={settings}
        chatModel=""
        request={{ tab: "general", id: 0 }}
        onUpdate={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        onSelectChatModel={noop}
        projects={[]}
        activeProjectId={null}
        onAddProject={async () => null}
        onRenameProject={noop}
        onSetPermissionMode={noop}
        onRevokeGrant={noop}
        onRemoveProject={noop}
        onEditProjectMemory={noop}
        onClearChats={noop}
        onClearSessions={noop}
      />
    </div>
  );
}

const GB = 1024 ** 3;

/** The models page on a fake manager: one model loaded, one too big for this GPU, and downloads
 * running, waiting and failed. */
const fakeManager: ModelManager = {
  installed: [
    { name: "Qwen3-8B-Q4_K_M.gguf", size: 5.0 * GB, parameterSize: "36L", family: "qwen3", capabilities: ["completion", "tools", "thinking"] },
    { name: "gemma-3-27b-it-Q5_K_M.gguf", size: 19.3 * GB, parameterSize: "62L", family: "gemma3", capabilities: ["completion", "vision"] },
    { name: "nomic-embed-text-v1.5-F16.gguf", size: 0.27 * GB, parameterSize: "12L", family: "nomic-bert", capabilities: ["embedding"] },
  ],
  loaded: ["Qwen3-8B-Q4_K_M.gguf"],
  refresh: noop,
  pulls: [
    {
      name: "hf.co/unsloth/Qwen3-14B-GGUF:Q4_K_M",
      percent: 42,
      phase: "downloading",
      remainingSeconds: 95,
      completed: 3.8 * GB,
      total: 9.0 * GB,
      bytesPerSecond: 56 * 1024 ** 2,
    },
    { name: "hf.co/bartowski/Phi-4-GGUF:Q4_K_M", percent: 0, phase: "queued" },
    { name: "hf.co/someone/Broken-GGUF:Q8_0", percent: 12, phase: "failed", error: "Server returned HTTP 404" },
  ],
  startPull: async () => true,
  cancelPull: noop,
  remove: async () => {},
  unload: async () => {},
  error: "",
  vram: 12,
  unifiedMemory: false,
};

export function ModelsPreview() {
  return (
    <div className="w-[720px] rounded-md border border-rule bg-surface-canvas p-8">
      <ModelsPage
        manager={fakeManager}
        settings={defaultSettings}
        chatModel="Qwen3-8B-Q4_K_M.gguf"
        onUpdate={noop}
        onSelectChatModel={noop}
        t={(key) => translations.en[key] || key}
      />
    </div>
  );
}
