import { PERMISSION_MODES } from "../app/modes";
import { Chip, Icon, Menu, type MenuEntry } from "../ui";
import type { PermissionMode } from "../types";

interface PermissionPickerProps {
  mode: PermissionMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (mode: PermissionMode) => void;
  /** The model cannot use tools, so only Plan only means anything: the rest are shown but not offered. */
  toolsUnavailable?: boolean;
  t: (key: string) => string;
}

// The Code composer's permission chip: how much the model may do in this project without asking.
export default function PermissionPicker({
  mode,
  open,
  onOpenChange,
  onPick,
  toolsUnavailable = false,
  t,
}: PermissionPickerProps) {
  const current = PERMISSION_MODES.find((one) => one.id === mode) ?? PERMISSION_MODES[1];

  const items: MenuEntry[] = PERMISSION_MODES.map((option) => {
    const disabled = toolsUnavailable && option.id !== "plan";
    return {
      id: option.id,
      label: t(option.label),
      description: t(option.hint),
      checked: option.id === mode,
      disabled,
      title: disabled ? t("needsToolModel") : undefined,
      onSelect: () => onPick(option.id),
    };
  });

  return (
    <Menu
      label={t("permissionMode")}
      side="top"
      className="w-72"
      open={open}
      onOpenChange={onOpenChange}
      items={items}
      trigger={(props) => (
        <Chip
          {...props}
          dropdown
          label={t(current.label)}
          title={`${t("permissionMode")}: ${t(current.label)}${toolsUnavailable ? `. ${t("needsToolModel")}` : ""}`}
          className={`max-w-[220px] ${mode === "auto" ? "!text-warn" : ""}`}
          icon={
            toolsUnavailable ? (
              <span data-testid="no-tools-warning" role="img" aria-label={t("needsToolModel")} className="flex text-warn">
                <Icon name="warning" size={16} />
              </span>
            ) : undefined
          }
        />
      )}
    />
  );
}
