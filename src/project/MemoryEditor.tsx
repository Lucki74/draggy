import { useState } from "react";

interface MemoryEditorProps {
  /** Where it will be written, relative to the project folder. */
  path: string;
  initial: string;
  t: (key: string) => string;
  onSave: (text: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * The project's instruction file, edited in place. It is an ordinary file in
 * the folder, so this is a convenience rather than the only way in: anybody can
 * open AGENTS.md in their own editor and Draggy will read it the same.
 */
export default function MemoryEditor({
  path,
  initial,
  t,
  onSave,
  onClose,
}: MemoryEditorProps) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const saved = await onSave(text);
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-title"
    >
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-5 shadow-xl">
        <h2 id="memory-title" className="text-base font-bold tracking-wide">
          {t("projectMemory")}
        </h2>

        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {path} · {t("memoryHint")}
        </p>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          aria-label={t("projectMemory")}
          className="mt-4 h-80 w-full resize-none rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-base)] p-3 font-mono text-xs leading-5 outline-none"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border-[3px] border-[var(--border-light)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            {t("cancel")}
          </button>

          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-[var(--bg-inverted)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-inverted)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
