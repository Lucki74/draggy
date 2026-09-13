import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

interface InstructionsEditorProps {
  instructions: string[];
  onChange: (instructions: string[]) => void;
  t: (key: string) => string;
}

// A list of standing instructions, each its own line so one can go without retyping the rest.
export default function InstructionsEditor({ instructions, onChange, t }: InstructionsEditorProps) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...instructions, trimmed]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      {instructions.map((instruction, index) => (
        <div
          key={`${index}-${instruction}`}
          className="flex items-start gap-2 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2"
        >
          <p className="flex-1 min-w-0 text-sm font-medium break-words">{instruction}</p>
          <button
            type="button"
            onClick={() => onChange(instructions.filter((_, i) => i !== index))}
            aria-label={t("remove")}
            title={t("remove")}
            className="p-1 rounded text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          placeholder={t("addNewInstruction")}
          aria-label={t("addNewInstruction")}
          className="flex-1 px-3 py-2 ui-input text-sm font-medium"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          aria-label={t("addInstruction")}
          title={t("addInstruction")}
          className="p-2.5 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90 disabled:opacity-30 transition-opacity"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
