import { CodeXml, MessageSquare } from "lucide-react";
import type { AppMode } from "./modes";

interface ModeSwitchProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  t: (key: string) => string;
}

// One control with two halves, the way a switch reads: the selected half is filled. Labels show
// only while the sidebar is open; icons alone fit the collapsed rail.
export default function ModeSwitch({ mode, onChange, t }: ModeSwitchProps) {
  const options: { id: AppMode; label: string; Icon: typeof MessageSquare }[] = [
    { id: "chat", label: t("chatMode"), Icon: MessageSquare },
    { id: "code", label: t("codeMode"), Icon: CodeXml },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("modeSwitch")}
      className="flex w-full rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-base)] p-[3px]"
    >
      {options.map(({ id, label, Icon }) => {
        const selected = mode === id;

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => {
              if (!selected) onChange(id);
            }}
            className={`flex-1 min-w-0 flex items-center justify-center gap-2 rounded-lg py-1.5 transition-colors ${
              selected
                ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="hidden group-hover:inline text-xs font-bold tracking-wider whitespace-nowrap">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
