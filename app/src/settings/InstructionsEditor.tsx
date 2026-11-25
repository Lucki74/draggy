import { useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons/Icon";

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
          className="flex items-start gap-2 rounded-sm bg-surface-base px-3 py-2 shadow-[0_0_0_1px_var(--rule-strong)]"
        >
          <p className="min-w-0 flex-1 break-words text-[13px] leading-5 text-text-primary">{instruction}</p>
          <button
            type="button"
            onClick={() => onChange(instructions.filter((_, i) => i !== index))}
            aria-label={t("remove")}
            title={t("remove")}
            className="flex-shrink-0 rounded-sm p-1 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-danger focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Icon name="trash" size={16} />
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
          className="h-8 flex-1 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <Button
          variant="primary"
          size="dense"
          onClick={add}
          disabled={!draft.trim()}
          aria-label={t("addInstruction")}
          title={t("addInstruction")}
          icon={<Icon name="plus" size={16} />}
        />
      </div>
    </div>
  );
}
