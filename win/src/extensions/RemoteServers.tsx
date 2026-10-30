import { useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Toggle } from "../settings/Controls";
import { fill } from "../onboarding/text";
import { ExtensionList, ExtensionRow } from "./ExtensionRow";
import type { McpServerConfig } from "../types";

interface RemoteServersProps {
  /** Every saved server, of which the ones with a url are shown here. */
  config: Record<string, McpServerConfig>;
  enabled: string[];
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

/** Remote servers, kept apart from the catalogue because they are the only extensions that send
 * anything off this machine, and the screen says so. */
export default function RemoteServers({
  config,
  enabled,
  t,
  onChanged,
}: RemoteServersProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = window.electronAPI?.mcp;

  const remotes = Object.entries(config).filter(([, entry]) => Boolean(entry.url));

  const close = () => {
    setAdding(false);
    setProblem(null);
    setName("");
    setUrl("");
  };

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

    close();
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
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="dense" icon={<Icon name="plus" size={14} />} onClick={() => setAdding(true)}>
          {t("addRemoteServer")}
        </Button>
      </div>

      {remotes.length === 0 ? (
        <p className="px-1 text-[13px] text-text-secondary">{t("noRemoteServers")}</p>
      ) : (
        <ExtensionList>
          {remotes.map(([id, entry]) => {
            const label = entry.name || id;
            const on = enabled.includes(id);
            return (
              <ExtensionRow
                key={id}
                leading={<Icon name="globe-simple" size={18} className="text-text-tertiary" />}
                name={label}
                status={{ kind: on ? "ok" : "idle", text: t(on ? "mcpEnabled" : "mcpDisabled") }}
                meta={entry.url}
                control={
                  <Toggle
                    checked={on}
                    label={label}
                    disabled={busy === id}
                    onChange={(value) => void act(id, () => api.setEnabled(id, value))}
                  />
                }
                menu={[
                  { id: "sign-in", label: t("signIn"), icon: <Icon name="sign-in" size={16} />, onSelect: () => void act(id, () => api.signIn(id)) },
                  { id: "sign-out", label: t("signOut"), icon: <Icon name="sign-out" size={16} />, onSelect: () => void act(id, () => api.signOut(id)) },
                  { type: "separator", id: "sep" },
                  { id: "delete", label: t("delete"), icon: <Icon name="trash" size={16} />, danger: true, onSelect: () => void act(id, () => api.forget(id)) },
                ]}
                menuLabel={fill(t("extensionActions"), { name: label })}
              />
            );
          })}
        </ExtensionList>
      )}

      <Dialog
        open={adding}
        onClose={close}
        title={t("addRemoteServer")}
        description={t("remoteServerHint")}
        closeLabel={t("closeDialog")}
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="add-remote-server" disabled={!url.trim()}>
              {t("addServer")}
            </Button>
          </>
        }
      >
        <form
          id="add-remote-server"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label className="block">
            <span className="text-[12px] font-medium text-text-secondary">{t("serverName")}</span>
            <input
              data-autofocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 h-8 w-full rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-text-secondary">{t("serverAddress")}</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://tools.example/mcp"
              className="mt-1 h-8 w-full rounded-sm bg-surface-base px-3 font-mono text-[12px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
          {problem && (
            <p role="alert" className="text-[12px] text-danger">
              {problem}
            </p>
          )}
        </form>
      </Dialog>
    </div>
  );
}
