import { useState } from "react";
import { Cloud, LogIn, LogOut, Plus, Trash2 } from "lucide-react";
import type { McpServerConfig } from "../types";

interface RemoteServersProps {
  /** Every saved server, of which the ones with a url are shown here. */
  config: Record<string, McpServerConfig>;
  enabled: string[];
  workspaceId: string;
  t: (key: string) => string;
  onChanged: () => void;
}

const idFrom = (name: string, url: string) => {
  const source = name.trim() || url.replace(/^https?:\/\//, "");
  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "remote"
  );
};

/**
 * Servers that are somewhere else. Kept apart from the catalogue on purpose:
 * these are the only extensions that send anything off this machine, and the
 * screen says so rather than leaving it to be discovered.
 */
export default function RemoteServers({
  config,
  enabled,
  workspaceId,
  t,
  onChanged,
}: RemoteServersProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = window.electronAPI?.mcp;

  const remotes = Object.entries(config).filter(([, entry]) => Boolean(entry.url));

  const add = async () => {
    if (!api || !url.trim()) return;

    const id = idFrom(name, url);
    const saved = await api.save(id, {
      enabled: false,
      env: {},
      arguments: {},
      url: url.trim(),
      name: name.trim() || id,
    });

    if (!saved?.success) {
      setProblem(saved?.error ?? null);
      return;
    }

    setProblem(null);
    setName("");
    setUrl("");
    onChanged();
  };

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await work();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (!api) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-3">
        <Cloud className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
        <p className="text-xs text-[var(--text-muted)]">{t("remoteHint")}</p>
      </div>

      {remotes.map(([id, entry]) => (
        <div
          key={id}
          className="flex items-center gap-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight">
              {entry.name || id}
            </p>
            <p className="truncate text-xs text-[var(--text-muted)]">{entry.url}</p>
          </div>

          <button
            onClick={() => void act(id, () => api.signIn(id))}
            disabled={busy === id}
            className="flex items-center gap-1.5 rounded-xl border-[3px] border-[var(--border-light)] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-50"
          >
            <LogIn className="h-3.5 w-3.5" />
            {t("signIn")}
          </button>

          <button
            onClick={() => void act(id, () => api.signOut(id))}
            aria-label={t("signOut")}
            title={t("signOut")}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            <LogOut className="h-4 w-4" />
          </button>

          <label className="flex flex-shrink-0 items-center gap-2">
            <input
              type="checkbox"
              checked={enabled.includes(id)}
              onChange={(event) =>
                void act(id, () =>
                  api.setEnabled(workspaceId, id, event.target.checked),
                )
              }
              aria-label={entry.name || id}
            />
          </label>

          <button
            onClick={() => void act(id, () => api.forget(id))}
            aria-label={t("delete")}
            title={t("delete")}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("serverName")}
          aria-label={t("serverName")}
          className="w-40 flex-shrink-0 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] px-3 py-2 text-sm outline-none"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://tools.example/mcp"
          aria-label={t("serverAddress")}
          className="min-w-0 flex-1 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={() => void add()}
          aria-label={t("addServer")}
          title={t("addServer")}
          className="flex-shrink-0 rounded-xl bg-[var(--bg-inverted)] px-3 py-2 text-[var(--text-inverted)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {problem && <p className="text-xs text-red-500">{problem}</p>}
    </div>
  );
}
