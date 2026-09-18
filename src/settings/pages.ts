import {
  AudioLines,
  BarChart3,
  Blocks,
  CodeXml,
  Cpu,
  Database,
  DownloadCloud,
  Folder,
  Globe,
  Library,
  MessageSquare,
  Palette,
  Plug,
} from "lucide-react";

/** Every settings page, in three groups: the app as a whole, Chat, and Code. Nothing on a Chat page
 * changes Code, and the reverse. Labels are translation keys. */

export type SettingsTab =
  | "general"
  | "models"
  | "web"
  | "usage"
  | "data"
  | "api"
  | "updates"
  | "chat"
  | "talk"
  | "library"
  | "extensions"
  | "code"
  | "projects";

export interface SettingsPageEntry {
  id: SettingsTab;
  label: string;
  icon: typeof Palette;
}

export interface SettingsGroupEntry {
  id: "app" | "chat" | "code";
  label: string;
  pages: SettingsPageEntry[];
}

export const SETTINGS_GROUPS: SettingsGroupEntry[] = [
  {
    id: "app",
    label: "settingsApp",
    pages: [
      { id: "general", label: "settingsGeneral", icon: Palette },
      { id: "models", label: "models", icon: Cpu },
      { id: "web", label: "webSearchPage", icon: Globe },
      { id: "usage", label: "statistics", icon: BarChart3 },
      { id: "data", label: "data", icon: Database },
      { id: "extensions", label: "extensions", icon: Blocks },
      { id: "api", label: "apiServer", icon: Plug },
      { id: "updates", label: "updates", icon: DownloadCloud },
    ],
  },
  {
    id: "chat",
    label: "chatMode",
    pages: [
      { id: "chat", label: "preferences", icon: MessageSquare },
      { id: "talk", label: "talk", icon: AudioLines },
      { id: "library", label: "library", icon: Library },
    ],
  },
  {
    id: "code",
    label: "codeMode",
    pages: [
      { id: "code", label: "preferences", icon: CodeXml },
      { id: "projects", label: "projects", icon: Folder },
    ],
  },
];

type Translate = (key: string) => string;

/** The thinking choices, shared by Chat's and Code's preferences. */
export const thinkingOptions = (t: Translate) =>
  (["low", "medium", "high"] as const).map((id) => ({ id, label: t(id) }));

export const webOptions = (t: Translate) => [
  { id: "auto" as const, label: t("webAuto") },
  { id: "on" as const, label: t("webOn") },
  { id: "off" as const, label: t("webOff") },
];

export function groupOf(tab: SettingsTab): SettingsGroupEntry {
  return SETTINGS_GROUPS.find((group) => group.pages.some((page) => page.id === tab)) ?? SETTINGS_GROUPS[0];
}
