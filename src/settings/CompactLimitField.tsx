import { useState } from "react";
import { Toggle } from "./Controls";
import {
  MIN_COMPACT_LIMIT,
  formatTokenCount,
  parseTokenCount,
} from "../agent/contextBreakdown";

interface CompactLimitFieldProps {
  /** Null is automatic. */
  limit: number | null;
  onChange: (limit: number | null) => void;
  t: (key: string) => string;
}

/** What a limit starts at when the user first turns automatic off. */
const STARTING_LIMIT = 32_000;

/**
 * When the conversation gets folded into notes. Automatic is a share of the
 * window the model is loaded at; a number is the user's own ceiling, the same
 * one `/compact-limit` sets. The text is only applied once it reads as a count,
 * so typing "2" on the way to "20k" does not fold everything straight away.
 */
export default function CompactLimitField({ limit, onChange, t }: CompactLimitFieldProps) {
  const [draft, setDraft] = useState(limit === null ? "" : formatTokenCount(limit));
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const parsed = parseTokenCount(draft);

    if (parsed === undefined || (parsed !== null && parsed < MIN_COMPACT_LIMIT)) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    if (parsed !== limit) onChange(parsed);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Toggle
          checked={limit === null}
          onChange={(automatic) => onChange(automatic ? null : STARTING_LIMIT)}
        />
        <span className="text-sm font-bold">{t("compactAutomatic")}</span>
      </div>

      {limit !== null && (
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          aria-label={t("compactLimitSetting")}
          aria-invalid={invalid}
          placeholder="32k"
          className="w-full p-3 ui-input text-sm font-bold"
          spellCheck={false}
        />
      )}

      <p
        className={`text-xs font-medium ${invalid ? "text-red-500" : "text-[var(--text-muted)]"}`}
      >
        {invalid ? t("compactLimitInvalid") : t("compactLimitHint")}
      </p>
    </div>
  );
}
