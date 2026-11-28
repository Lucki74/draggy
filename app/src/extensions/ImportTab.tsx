import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ExtensionList } from "./ExtensionRow";
import type { AppSettings, ImportItem, ImportResult } from "../types";
import { swallowed } from "../logger";

interface ImportTabProps {
  t: (key: string) => string;
  /** Without these, global instructions cannot be stored, so those rows are left out. */
  settings?: AppSettings;
  onUpdate?: (patch: Partial<AppSettings>) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  claude: "importSourceClaude",
  codex: "importSourceCodex",
};

const KIND_LABEL: Record<string, string> = {
  memory: "importKindMemory",
  skill: "importKindSkill",
  mcp: "importKindMcp",
  command: "importKindCommand",
  agent: "importKindAgent",
};

const KIND_ORDER = ["memory", "skill", "mcp", "command", "agent"];

/** What the main process says when it skips or cannot take an item. */
const NOTE_LABEL: Record<string, string> = {
  invalid: "importNoteInvalid",
  noCommandFolder: "importNoteNoCommands",
  unsupportedServer: "importNoteServer",
  unsupported: "importNoteServer",
  needsKey: "importNeedsKey",
  exists: "importReasonExists",
  badName: "importReasonBadName",
  copyFailed: "importReasonCopy",
  gone: "importReasonGone",
};

/** Lists what Claude Code and Codex left in the home folder, and copies what the user ticks. */
export default function ImportTab({ t, settings, onUpdate }: ImportTabProps) {
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ done: number; skipped: number; keys: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  const api = window.draggy?.import;
  const canStore = Boolean(onUpdate);

  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    api
      .scan()
      .then((result) => {
        if (cancelled) return;
        const found = (result?.items ?? []).filter((item) => item.kind !== "memory" || canStore);
        setItems(found);
        setChecked(new Set(found.filter((item) => item.supported && !item.clash).map((item) => item.key)));
        setRenames({});
      })
      .catch(swallowed("extensions", "the main process already logged this call"));

    return () => {
      cancelled = true;
    };
  }, [api, revision, canStore]);

  const wanted = useMemo(
    () => (items ?? []).filter((item) => checked.has(item.key) && item.supported),
    [items, checked],
  );

  const blocked = (item: ImportItem) => item.clash && !(renames[item.key] ?? "").trim();
  const ready = wanted.filter((item) => !blocked(item));

  const run = useCallback(async () => {
    if (!api || ready.length === 0) return;
    setBusy(true);
    setFailed(false);
    const reply = await api
      .apply({ items: ready.map((item) => ({ key: item.key, rename: renames[item.key]?.trim() || undefined })) })
      .catch(swallowed("extensions", "the main process already logged this call"));
    setBusy(false);
    if (!reply?.success) {
      setFailed(true);
      return;
    }
    const results: ImportResult[] = reply.results ?? [];
    const memory = reply.memory ?? [];
    if (memory.length > 0 && onUpdate) {
      const existing = settings?.customInstructions ?? [];
      const fresh = memory.filter((text) => !existing.includes(text));
      if (fresh.length > 0) onUpdate({ customInstructions: [...fresh, ...existing] });
    }
    setSummary({
      done: results.filter((one) => one.status === "imported").length,
      skipped: results.filter((one) => one.status === "skipped").length,
      keys: results.some((one) => one.status === "imported" && one.needsKey),
    });
    setRevision((count) => count + 1);
  }, [api, ready, renames, onUpdate, settings]);

  if (!api) {
    return <p className="text-[13px] text-text-secondary">{t("mcpUnavailable")}</p>;
  }

  const toggle = (key: string, on: boolean) =>
    setChecked((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const sections = (["claude", "codex"] as const).flatMap((source) =>
    KIND_ORDER.map((kind) => ({
      source,
      kind,
      members: (items ?? []).filter((item) => item.source === source && item.kind === kind),
    })).filter((section) => section.members.length > 0),
  );

  const noteFor = (item: ImportItem) => {
    const key = item.note ? NOTE_LABEL[item.note] : undefined;
    return key ? t(key) : undefined;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-[200px] flex-1 px-1 text-[13px] text-text-secondary">{t("importIntro")}</p>
        <IconButton name="arrow-clockwise" label={t("refresh")} size="dense" onClick={() => setRevision((count) => count + 1)} />
      </div>

      {items === null && <p className="px-1 text-[13px] text-text-secondary">{t("loading")}</p>}
      {items !== null && items.length === 0 && (
        <p className="px-1 text-[13px] text-text-secondary">{t("importNothing")}</p>
      )}

      {sections.map(({ source, kind, members }) => (
        <section key={`${source}-${kind}`} className="space-y-2 pt-2">
          <h3 className="px-1 text-[12px] font-medium text-text-secondary">
            {t(SOURCE_LABEL[source])} · {t(KIND_LABEL[kind])}
          </h3>
          <ExtensionList>
            {members.map((item) => {
              const note = noteFor(item);
              return (
                <div key={item.key} className="flex items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 flex-shrink-0 accent-[var(--accent)]"
                    checked={checked.has(item.key) && item.supported}
                    disabled={!item.supported}
                    onChange={(event) => toggle(item.key, event.target.checked)}
                    aria-label={item.name}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">{item.name}</span>
                      {item.needsKey && (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-surface-raised px-1.5 py-0.5 text-[11px] text-text-secondary">
                          <Icon name="warning" size={12} />
                          {t("importNeedsKey")}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="truncate text-[12px] text-text-secondary">{item.description}</p>
                    )}
                    {!item.supported && note && <p className="text-[12px] text-text-tertiary">{note}</p>}
                    {item.clash && item.supported && (
                      <label className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
                        <span>{t("importClash")}</span>
                        <span className="sr-only">{t("importRenameLabel")}</span>
                        <input
                          value={renames[item.key] ?? ""}
                          placeholder={item.suggested}
                          aria-label={`${t("importRenameLabel")}: ${item.name}`}
                          onChange={(event) => {
                            const value = event.target.value;
                            setRenames((previous) => ({ ...previous, [item.key]: value }));
                            if (value.trim()) toggle(item.key, true);
                          }}
                          className="h-7 w-48 rounded-sm bg-surface-base px-2 font-mono text-[12px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus:ring-2 focus:ring-focus"
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </ExtensionList>
        </section>
      ))}

      {items !== null && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button disabled={busy || ready.length === 0} onClick={() => void run()}>
            {t("importAction").replace("{count}", String(ready.length))}
          </Button>
          {summary && (
            <p role="status" className="text-[12px] text-text-secondary">
              {t("importResult")
                .replace("{done}", String(summary.done))
                .replace("{skipped}", String(summary.skipped))}
            </p>
          )}
          {failed && <p role="alert" className="text-[12px] text-text-secondary">{t("importFailed")}</p>}
        </div>
      )}
      {summary?.keys && <p className="px-1 text-[12px] text-text-secondary">{t("importKeysHint")}</p>}
    </div>
  );
}
