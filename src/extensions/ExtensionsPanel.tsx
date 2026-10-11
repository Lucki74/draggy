import { useCallback, useEffect, useId, useState } from "react";
import { Tabs } from "../ui/Tabs";
import McpPanel from "../settings/McpPanel";
import RemoteServers from "./RemoteServers";
import SkillsTab from "./SkillsTab";
import type { McpServerConfig } from "../types";
import { swallowed } from "../logger";

interface ExtensionsPanelProps {
  t: (key: string) => string;
}

type Tab = "servers" | "remote" | "skills";

/** One screen for extending Draggy: catalogue servers, remote servers, and skills. They are global,
 * so Chat and every project get the same ones. */
export default function ExtensionsPanel({ t }: ExtensionsPanelProps) {
  const [tab, setTab] = useState<Tab>("servers");
  const [config, setConfig] = useState<Record<string, McpServerConfig>>({});
  const [enabled, setEnabled] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const panelId = useId();

  const api = window.electronAPI?.mcp;

  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    Promise.all([api.config(), api.enabled()])
      .then(([saved, on]) => {
        if (cancelled) return;
        setConfig(saved?.config ?? {});
        setEnabled(on?.ids ?? []);
      })
      .catch(swallowed("extensions", "the main process already logged this call"));

    return () => {
      cancelled = true;
    };
  }, [api, revision]);

  const refresh = useCallback(() => setRevision((count) => count + 1), []);

  const TABS: { id: Tab; label: string }[] = [
    { id: "servers", label: t("extensionServers") },
    { id: "remote", label: t("extensionRemote") },
    { id: "skills", label: t("extensionSkills") },
  ];

  return (
    <div className="space-y-4">
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={setTab}
        label={t("extensions")}
        panelId={panelId}
      />

      <div
        id={panelId}
        role="tabpanel"
        aria-label={TABS.find((one) => one.id === tab)?.label}
      >
        {tab === "servers" && <McpPanel t={t} />}

        {tab === "remote" && (
          <RemoteServers
            config={config}
            enabled={enabled}
            t={t}
            onChanged={refresh}
          />
        )}

        {tab === "skills" && <SkillsTab t={t} />}
      </div>
    </div>
  );
}
