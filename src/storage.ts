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

/** A conversation as it should look when the app opens. Nothing can be running yet: a turn or a
 * fold cut short by quitting would otherwise spin forever. */
export function settleSession(session: ChatSession): ChatSession {
  const hasRunningFold = session.messages?.some((message) => message.fold?.status === "running");

  return {
    ...session,
    isGenerating: false,
    ...(hasRunningFold
      ? {
          messages: session.messages.map((message) => {
            if (message.fold?.status !== "running") return message;
            const settled = { ...message };
            delete settled.fold;
            return settled;
          }),
        }
      : {}),
  };
}

function stripRuntimeFields(session: ChatSession) {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    workspaceId: session.workspaceId,
    plan: session.plan ?? null,
    isOutOfContext: Boolean(session.isOutOfContext),
    messages: session.messages,
  };
}

const sqliteBackend: StorageBackend = {
  kind: "sqlite",

  async loadSessions() {
    const result = await window.electronAPI!.db.loadChats();
    if (!result?.success || !result.chats) return [];
    return result.chats.map(settleSession);
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

  return parsed.map(settleSession);
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

const backend: StorageBackend = window.electronAPI?.db
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

type SaveFailure = (session: ChatSession, reason: string) => void;

interface QueuedSave {
  session: ChatSession;
  onFailure?: SaveFailure;
}

const pending = new Map<string, QueuedSave & { timer: ReturnType<typeof setTimeout> }>();
const inFlight = new Map<string, { session: ChatSession; write: Promise<boolean> }>();
/** The version of each conversation known to be on disk, so a flush skips it. */
const written = new Map<string, ChatSession>();

function writeSession({ session, onFailure }: QueuedSave): Promise<boolean> {
  const write: Promise<boolean> = backend
    .saveSession(session)
    .then((result) => {
      if (result.ok) {
        written.set(session.id, session);
      } else {
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
      if (inFlight.get(session.id)?.write === write) inFlight.delete(session.id);
    });

  inFlight.set(session.id, { session, write });
  return write;
}

export function queueSessionSave(session: ChatSession, onFailure?: SaveFailure): void {
  const existing = pending.get(session.id);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pending.delete(session.id);
    void writeSession({ session, onFailure });
  }, SAVE_DEBOUNCE_MS);

  pending.set(session.id, { session, onFailure, timer });
}

/** Conversations as they were loaded from disk, which a flush has no need to write back. */
export function markSessionsSaved(sessions: ChatSession[]): void {
  for (const session of sessions) written.set(session.id, session);
}

/** Writes every queued save now, and any of `sessions` never written, then waits for the writes
 * still under way. A queued save wins over `sessions`, which can lag a render behind. */
export async function flushSessionSaves(sessions: ChatSession[] = []): Promise<void> {
  const due = new Map<string, QueuedSave>();

  for (const [id, { session, onFailure, timer }] of pending) {
    clearTimeout(timer);
    due.set(id, { session, onFailure });
  }
  pending.clear();

  for (const session of sessions) {
    const known =
      due.has(session.id) ||
      written.get(session.id) === session ||
      inFlight.get(session.id)?.session === session;
    if (!known) due.set(session.id, { session });
  }

  const under = [...inFlight.values()].map(({ write }) => write);
  await Promise.all([...[...due.values()].map(writeSession), ...under]);
}

export function cancelSessionSave(id: string): void {
  const queued = pending.get(id);
  if (queued) clearTimeout(queued.timer);
  pending.delete(id);
  written.delete(id);
}
