import { useState } from "react";

export interface MemoryTab {
  id: string;
  label: string;
  /** Where it will be written, relative to the project folder, or a scope name. */
  path: string;
  initial: string;
  /** Shown under the path: an off or empty state, or how to edit. */
  note?: string;
  placeholder?: string;
  /** Set when the tab cannot be used yet, such as project notes with no folder open. */
  disabledReason?: string;
  /** A switch under the path, such as trusting this folder for its notes. */
  toggle?: { label: string; checked: boolean; onChange: (checked: boolean) => boolean };
  /** Resolves to null when saved, or the message to show. */
  onSave: (text: string) => Promise<string | null>;
}

interface MemoryEditorProps {
  tabs: MemoryTab[];
  t: (key: string) => string;
  onClose: () => void;
}

/** Edits the project's instructions and the auto memory notes in place. Each tab is an ordinary
 * file or list, so any editor works just as well. */
export default function MemoryEditor({ tabs, t, onClose }: MemoryEditorProps) {
  const [active, setActive] = useState(0);
  const [texts, setTexts] = useState(() => tabs.map((tab) => tab.initial));
  const [saving, setSaving] = useState(false);
  const [checks, setChecks] = useState(() => tabs.map((tab) => tab.toggle?.checked ?? false));
  const [error, setError] = useState<string | null>(null);
  const tab = tabs[active];

  const select = (index: number) => {
    setActive(index);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    const failure = await tab.onSave(texts[active]);
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-title"
    >
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-rule bg-surface-raised p-5 shadow-xl">
        <h2 id="memory-title" className="text-base font-semibold">
          {t("projectMemory")}
        </h2>

        <div role="tablist" className="mt-3 flex flex-wrap gap-1">
          {tabs.map((item, index) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={index === active}
              disabled={Boolean(item.disabledReason)}
              onClick={() => select(index)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                index === active ? "bg-[var(--bg-inverted)] text-action-fg" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {tab.path} · {t("memoryHint")}
        </p>
        {tab.note && <p className="mt-1 text-xs text-[var(--text-muted)]">{tab.note}</p>}
        {tab.disabledReason && <p className="mt-1 text-xs text-[var(--text-muted)]">{tab.disabledReason}</p>}
        {tab.toggle && (
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={checks[active]}
              onChange={(event) => {
                const next = event.target.checked;
                if (tab.toggle?.onChange(next)) setChecks(checks.map((value, index) => (index === active ? next : value)));
                else setError(t("memorySaveFailed"));
              }}
            />
            {tab.toggle.label}
          </label>
        )}

        <textarea
          value={texts[active]}
          onChange={(event) => setTexts(texts.map((value, index) => (index === active ? event.target.value : value)))}
          placeholder={tab.placeholder}
          spellCheck={false}
          aria-label={tab.label}
          className="mt-4 h-80 w-full resize-none rounded-xl border border-rule bg-[var(--bg-base)] p-3 font-mono text-xs leading-5 outline-none"
        />

        {error && (
          <p role="alert" className="mt-2 text-xs text-[var(--text-danger,#b91c1c)]">
            {t("memorySaveFailed")} {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-rule px-4 py-2 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            {t("cancel")}
          </button>

          <button
            onClick={() => void save()}
            disabled={saving || Boolean(tab.disabledReason)}
            className="rounded-xl bg-[var(--bg-inverted)] px-4 py-2 text-xs font-medium text-action-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
