import { useCallback, useEffect, useState } from "react";
import McpPanel from "../settings/McpPanel";
import RemoteServers from "./RemoteServers";
import SkillsTab from "./SkillsTab";
import type { McpServerConfig } from "../types";

interface ExtensionsPanelProps {
  workspaceId: string;
  t: (key: string) => string;
}

type Tab = "servers" | "remote" | "skills";

/**
 * One screen for everything that extends Draggy: the servers it can connect to,
 * the ones somewhere else that the user pasted in, and the skills they wrote.
 * They are three lists rather than three settings pages because the question
 * behind all of them is the same: what else can this thing do.
 */
export default function ExtensionsPanel({ workspaceId, t }: ExtensionsPanelProps) {
  const [tab, setTab] = useState<Tab>("servers");
  const [config, setConfig] = useState<Record<string, McpServerConfig>>({});
  const [enabled, setEnabled] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);

  const api = window.electronAPI?.mcp;

  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    Promise.all([api.config(), api.enabled(workspaceId)])
      .then(([saved, on]) => {
        if (cancelled) return;
        setConfig(saved?.config ?? {});
        setEnabled(on?.ids ?? []);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, revision]);

  const refresh = useCallback(() => setRevision((count) => count + 1), []);

  const TABS: { id: Tab; label: string }[] = [
    { id: "servers", label: t("extensionServers") },
    { id: "remote", label: t("extensionRemote") },
    { id: "skills", label: t("extensionSkills") },
  ];

  return (
    <div className="space-y-4">
      <div
        className="flex w-fit overflow-hidden rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]"
        role="tablist"
      >
        {TABS.map((one) => (
          <button
            key={one.id}
            role="tab"
            aria-selected={tab === one.id}
            onClick={() => setTab(one.id)}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
              tab === one.id
                ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
            }`}
          >
            {one.label}
          </button>
        ))}
      </div>

      {tab === "servers" && <McpPanel t={t} workspaceId={workspaceId} />}

      {tab === "remote" && (
        <RemoteServers
          config={config}
          enabled={enabled}
          workspaceId={workspaceId}
          t={t}
          onChanged={refresh}
        />
      )}

      {tab === "skills" && <SkillsTab workspaceId={workspaceId} t={t} />}
    </div>
  );
}
