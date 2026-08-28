import type { AppSettings, ChatSession } from "./types";
import { safeJsonParse, writeLocalStorage } from "./utils";

export const SETTINGS_KEY = "draggy_settings";
export const CHATS_KEY = "draggy_chats";

const MIGRATION_FLAG = "migrated_from_localstorage";

export interface ChatSearchHit {
  chatId: string;
  messageId: string;
  title: string;
  excerpt: string;
}

export interface SaveOutcome {
  ok: boolean;
  reason: string;
}

export interface StorageBackend {
  readonly kind: "sqlite" | "localStorage";
  loadSessions(): Promise<ChatSession[]>;
  saveSession(session: ChatSession): Promise<SaveOutcome>;
  deleteSession(id: string): Promise<void>;
  clearSessions(): Promise<void>;
  searchSessions(query: string): Promise<ChatSearchHit[]>;
  loadSettings(): Promise<Partial<AppSettings> | null>;
  saveSettings(settings: AppSettings): Promise<void>;
}

function stripRuntimeFields(session: ChatSession) {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    isOutOfContext: Boolean(session.isOutOfContext),
    messages: session.messages,
  };
}

const sqliteBackend: StorageBackend = {
  kind: "sqlite",

  async loadSessions() {
    const result = await window.electronAPI!.db.loadChats();
    if (!result?.success || !result.chats) return [];
    return result.chats.map((chat) => ({ ...chat, isGenerating: false }));
  },

  async saveSession(session) {
    const result = await window.electronAPI!.db.saveChat(stripRuntimeFields(session));
    return {
      ok: Boolean(result?.success),
      reason: result?.error ?? "the database reported no result",
    };
  },

  async deleteSession(id) {
    await window.electronAPI!.db.deleteChat(id);
  },

  async clearSessions() {
    await window.electronAPI!.db.clearChats();
  },

  async searchSessions(query) {
    const result = await window.electronAPI!.db.searchChats(query);
    return result?.success ? (result.results ?? []) : [];
  },

  async loadSettings() {
    const result = await window.electronAPI!.db.get(SETTINGS_KEY);
    return result?.value ? safeJsonParse<Partial<AppSettings>>(result.value) : null;
  },

  async saveSettings(settings) {
    await window.electronAPI!.db.set(SETTINGS_KEY, JSON.stringify(settings));
  },
};

function readLocalSessions(): ChatSession[] {
  const raw = localStorage.getItem(CHATS_KEY);
  if (!raw) return [];

  const parsed = safeJsonParse<ChatSession[]>(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed.map((session) => ({ ...session, isGenerating: false }));
}

function writeLocalSessions(sessions: ChatSession[]): boolean {
  return writeLocalStorage(
    CHATS_KEY,
    JSON.stringify(sessions.map(stripRuntimeFields)),
  );
}

const localStorageBackend: StorageBackend = {
  kind: "localStorage",

  async loadSessions() {
    return readLocalSessions();
  },

  async saveSession(session) {
    const sessions = readLocalSessions().filter((entry) => entry.id !== session.id);
    const ok = writeLocalSessions([session, ...sessions]);
    return {
      ok,
      reason: ok ? "" : "browser storage is full (no database available)",
    };
  },

  async deleteSession(id) {
    writeLocalSessions(readLocalSessions().filter((entry) => entry.id !== id));
  },

  async clearSessions() {
    localStorage.removeItem(CHATS_KEY);
  },

  async searchSessions(query) {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    const hits: ChatSearchHit[] = [];
    for (const session of readLocalSessions()) {
      for (const message of session.messages) {
        const body = (message.textContent ?? message.content ?? "").toLowerCase();
        const at = body.indexOf(term);
        if (at === -1) continue;

        hits.push({
          chatId: session.id,
          messageId: message.id,
          title: session.title,
          excerpt: (message.textContent ?? message.content ?? "").slice(
            Math.max(0, at - 40),
            at + 120,
          ),
        });
        break;
      }
    }

    return hits.slice(0, 50);
  },

  async loadSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? safeJsonParse<Partial<AppSettings>>(raw) : null;
  },

  async saveSettings(settings) {
    writeLocalStorage(SETTINGS_KEY, JSON.stringify(settings));
  },
};

let backend: StorageBackend = window.electronAPI?.db
  ? sqliteBackend
  : localStorageBackend;

export function storageBackend(): StorageBackend {
  return backend;
}

export interface MigrationReport {
  ran: boolean;
  imported: number;
  error?: string;
}

export async function migrateFromLocalStorage(): Promise<MigrationReport> {
  const api = window.electronAPI;
  if (!api?.db) return { ran: false, imported: 0 };

  try {
    const flag = await api.db.get(MIGRATION_FLAG);
    if (flag?.value === "done") return { ran: false, imported: 0 };

    const sessions = readLocalSessions();
    let imported = 0;

    if (sessions.length > 0) {
      const result = await api.db.importSessions(sessions.map(stripRuntimeFields));
      imported = result?.imported ?? 0;
    }

    const settings = localStorage.getItem(SETTINGS_KEY);
    if (settings) await api.db.set(SETTINGS_KEY, settings);

    await api.db.set(MIGRATION_FLAG, "done");

    localStorage.removeItem(CHATS_KEY);

    return { ran: true, imported };
  } catch (error) {
    return {
      ran: false,
      imported: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const SAVE_DEBOUNCE_MS = 700;

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<boolean>>();

export function queueSessionSave(
  session: ChatSession,
  onFailure?: (session: ChatSession, reason: string) => void,
): void {
  const existing = pending.get(session.id);
  if (existing) clearTimeout(existing);

  pending.set(
    session.id,
    setTimeout(() => {
      pending.delete(session.id);

      const write = backend
        .saveSession(session)
        .then((result) => {
          if (!result.ok) {
            console.error("[storage] save failed:", result.reason);
            onFailure?.(session, result.reason);
          }
          return result.ok;
        })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          console.error("[storage] save threw:", reason);
          onFailure?.(session, reason);
          return false;
        })
        .finally(() => {
          inFlight.delete(session.id);
        });

      inFlight.set(session.id, write);
    }, SAVE_DEBOUNCE_MS),
  );
}

export async function flushSessionSaves(sessions: ChatSession[]): Promise<void> {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();

  await Promise.all(
    sessions.map((session) =>
      backend.saveSession(session).catch(() => ({ ok: false, reason: "" })),
    ),
  );

  await Promise.all([...inFlight.values()]);
}

export function cancelSessionSave(id: string): void {
  const timer = pending.get(id);
  if (timer) clearTimeout(timer);
  pending.delete(id);
}

export function setStorageBackendForTesting(next: StorageBackend): void {
  backend = next;
}
