import type { IconName } from "../ui/icons/Icon";

/** Every settings page, in three groups: the app as a whole, Chat, and Code. Nothing on a Chat page
 * changes Code, and the reverse. Labels are translation keys. */

export type SettingsTab =
  | "general"
  | "models"
  | "providers"
  | "web"
  | "usage"
  | "data"
  | "diagnostics"
  | "api"
  | "updates"
  | "chat"
  | "talk"
  | "library"
  | "extensions"
  | "code"
  | "projects"
  | "permissions";

export interface SettingsPageEntry {
  id: SettingsTab;
  label: string;
  icon: IconName;
  /** Translation keys of the rows on the page, so search finds a setting by its own name. */
  keywords?: string[];
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
      { id: "general", label: "settingsGeneral", icon: "palette", keywords: ["appearance", "theme", "language", "textSize", "showMetrics", "onbRunAgain"] },
      { id: "models", label: "models", icon: "cpu", keywords: ["installed", "downloadModel", "embeddingModel", "contextGroup", "fixedContextSize", "library"] },
      { id: "providers", label: "providers", icon: "cloud", keywords: ["onThisComputer", "apiKeysGroup", "accountsGroup"] },
      { id: "web", label: "webSearchPage", icon: "globe-simple", keywords: ["searchProvider", "searxngUrl", "braveApiKey"] },
      { id: "usage", label: "statistics", icon: "chart-bar" },
      { id: "data", label: "data", icon: "database", keywords: ["conversations", "messages", "attachments", "attachmentSize", "clearChats", "clearSessions", "eraseData"] },
      { id: "diagnostics", label: "diagnostics", icon: "terminal-window", keywords: ["openLogFolder", "diagVerbose", "diagViewer", "diagExport"] },
      { id: "extensions", label: "extensions", icon: "puzzle-piece" },
      { id: "api", label: "apiServer", icon: "plug" },
      { id: "updates", label: "updates", icon: "cloud-arrow-down", keywords: ["currentVersion", "updateStatus", "automaticUpdates"] },
    ],
  },
  {
    id: "chat",
    label: "chatMode",
    pages: [
      { id: "chat", label: "preferences", icon: "chat-circle", keywords: ["model", "thinking", "webAccess", "customInstructions"] },
      { id: "talk", label: "talk", icon: "waveform", keywords: ["voiceEngine", "naturalVoice", "systemVoice", "talkModel", "speed", "voiceSounds"] },
      { id: "library", label: "library", icon: "books", keywords: ["enableLibrary", "indexedFolders"] },
    ],
  },
  {
    id: "code",
    label: "codeMode",
    pages: [
      { id: "code", label: "preferences", icon: "code", keywords: ["model", "thinking", "webAccess", "defaultPermission", "customInstructions"] },
      { id: "projects", label: "projects", icon: "folder-simple", keywords: ["projectName", "projectFolder", "permissionMode", "alwaysAllowed", "projectMemory"] },
      { id: "permissions", label: "permissions", icon: "shield-check", keywords: ["alwaysAllowed"] },
    ],
  },
];

type Translate = (key: string) => string;

/** The thinking choices, shared by Chat's and Code's preferences. */
/** Translation keys for each effort level's name. */
export const EFFORT_LABELS = {
  off: "effortOff",
  low: "effortLow",
  medium: "effortMedium",
  high: "effortHigh",
  max: "effortMax",
} as const;

/** The effort levels as segmented options, in the order given. Chat passes its allowed levels. */
export const effortOptions = (
  t: Translate,
  levels: readonly (keyof typeof EFFORT_LABELS)[] = ["off", "low", "medium", "high", "max"],
) => levels.map((id) => ({ id, label: t(EFFORT_LABELS[id]) }));

/** The web search providers, for the Web search page and the setup's Preferences step alike. */
export const searchProviderOptions = (t: Translate) =>
  (["auto", "brave-html", "duckduckgo", "startpage", "brave", "searxng"] as const).map((id) => ({
    id,
    label: t(`provider_${id.replace(/-/g, "_")}`),
  }));

export const newChatStartOptions = (t: Translate) => [
  { id: "defaults" as const, label: t("newChatStartDefaults") },
  { id: "last" as const, label: t("newChatStartLast") },
];

export const webOptions = (t: Translate) => [
  { id: "auto" as const, label: t("webAuto") },
  { id: "on" as const, label: t("webOn") },
  { id: "off" as const, label: t("webOff") },
];

export function groupOf(tab: SettingsTab): SettingsGroupEntry {
  return SETTINGS_GROUPS.find((group) => group.pages.some((page) => page.id === tab)) ?? SETTINGS_GROUPS[0];
}

/** The pages whose name or one of whose settings matches `query`, with the setting that matched
 * when it was not the page name itself. Case and accents are ignored. */
export function searchSettings(query: string, t: Translate): { page: SettingsPageEntry; match?: string }[] {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return [];
  const results: { page: SettingsPageEntry; match?: string }[] = [];
  for (const group of SETTINGS_GROUPS) {
    for (const page of group.pages) {
      if (fold(t(page.label)).includes(needle)) {
        results.push({ page });
        continue;
      }
      const hit = page.keywords?.map(t).find((label) => fold(label).includes(needle));
      if (hit) results.push({ page, match: hit });
    }
  }
  return results;
}
