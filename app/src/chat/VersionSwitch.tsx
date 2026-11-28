import { IconButton } from "../ui";

export interface VersionSwitchProps {
  /** Message index in the chat. */
  idx: number;
  /** Zero-based index of the version on screen. */
  slot: number;
  /** Number of versions including the newest. */
  total: number;
  onSwitchVersion: (messageIndex: number, versionIndex: number) => void;
  t: (key: string) => string;
}

/** The `‹ 2/3 ›` control on a message with other versions; nothing when it has none. */
export function VersionSwitch({ idx, slot, total, onSwitchVersion, t }: VersionSwitchProps) {
  if (total < 2) return null;
  return (
    <div className="flex items-center text-[12px] text-text-secondary tabular-nums">
      <IconButton name="caret-left" size="sm" label={t("previousVersion")} disabled={slot <= 0} onClick={() => onSwitchVersion(idx, slot - 1)} />
      <span>
        {slot + 1} / {total}
      </span>
      <IconButton name="caret-right" size="sm" label={t("nextVersion")} disabled={slot + 1 >= total} onClick={() => onSwitchVersion(idx, slot + 1)} />
    </div>
  );
}
export default VersionSwitch;
