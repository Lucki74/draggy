import React from "react";
import { Dialog } from "./Dialog";
import { Kbd } from "./Kbd";

export interface ShortcutsSheetProps {
  open: boolean;
  onClose: () => void;
  t: (key: string) => string;
}

interface ShortcutItem {
  label: string;
  keys: string[];
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** Shows the full keyboard map grouped by task, opened with Ctrl+/.
 * Uses standard modifier keys and platform conventions. */
export function ShortcutsSheet({ open, onClose, t }: ShortcutsSheetProps) {
  const mod = "Ctrl";

  const groups: ShortcutGroup[] = [
    {
      title: t("shortcutsSectionGeneral"),
      items: [
        { label: t("commandPalette"), keys: [`${mod}+K`, `${mod}+Shift+P`] },
        { label: t("keyboardShortcuts"), keys: [`${mod}+/`] },
        { label: t("settings"), keys: [`${mod}+,`] },
        { label: t("toggleSidebar"), keys: [`${mod}+B`] },
        { label: t("stopGenerating"), keys: ["Esc"] },
      ],
    },
    {
      title: t("shortcutsSectionNavigation"),
      items: [
        { label: t("newDiscussion"), keys: [`${mod}+N`] },
        { label: `${t("chatMode")} / ${t("codeMode")}`, keys: [`${mod}+Shift+X`] },
        { label: t("nextSession"), keys: [`${mod}+Tab`] },
        { label: t("previousSession"), keys: [`${mod}+Shift+Tab`] },
        { label: t("viewMode"), keys: [`${mod}+O`] },
      ],
    },
    {
      title: t("shortcutsSectionPanes"),
      items: [
        { label: t("files"), keys: [`${mod}+Shift+F`] },
        { label: t("diffPane"), keys: [`${mod}+Shift+D`] },
        { label: t("browser"), keys: [`${mod}+Shift+B`] },
        { label: t("plan"), keys: [`${mod}+Shift+L`] },
        { label: t("terminal"), keys: [`${mod}+Shift+T`] },
        { label: t("sendToBackground"), keys: [`${mod}+Alt+B`] },
        { label: t("closePane"), keys: [`${mod}+\\`] },
        { label: t("talk"), keys: [`${mod}+Shift+Space`] },
      ],
    },
    {
      title: t("shortcutsSectionComposer"),
      items: [
        { label: t("permissionMode"), keys: [`${mod}+Shift+M`] },
        { label: t("model"), keys: [`${mod}+Shift+I`] },
        { label: t("effort"), keys: [`${mod}+Shift+E`] },
        { label: t("mentionFiles"), keys: ["@"] },
      ],
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} title={t("keyboardShortcuts")} closeLabel={t("closeDialog")} width={560}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-h-[60vh] overflow-y-auto pe-1">
        {groups.map((group) => (
          <div key={group.title} className="space-y-2">
            <h3 className="text-[12px] font-medium text-text-tertiary">{group.title}</h3>
            <div className="divide-y divide-rule/60">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between py-1.5 text-[13px]">
                  <span className="text-text-secondary truncate pe-2">{item.label}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {item.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
