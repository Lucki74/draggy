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

/** When conversations fold: automatic, or the user's own ceiling as `/compact-limit` sets it.
 * Applied only once the text reads as a count. */
export default function CompactLimitField({ limit, onChange, t }: CompactLimitFieldProps) {
  const [draft, setDraft] = useState(limit === null ? "" : formatTokenCount(limit));
  const [prevLimit, setPrevLimit] = useState(limit);
  const [invalid, setInvalid] = useState(false);

  // Syncs the draft directly during render when the external limit changes.
  if (limit !== prevLimit) {
    setPrevLimit(limit);
    setDraft(limit === null ? "" : formatTokenCount(limit));
    setInvalid(false);
  }

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
        <span className="text-[14px] text-text-primary">{t("compactAutomatic")}</span>
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
          className="w-full rounded-sm bg-surface-base px-3 py-2 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
          spellCheck={false}
        />
      )}

      {invalid && <p role="alert" className="text-[12px] text-danger">{t("compactLimitInvalid")}</p>}
    </div>
  );
}
