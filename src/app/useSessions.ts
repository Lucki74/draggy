import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSession, MessageVersion } from "../types";
import {
  cancelSessionSave,
  flushSessionSaves,
  migrateFromLocalStorage,
  queueSessionSave,
  storageBackend,
} from "../storage";

/**
 * The conversations and their persistence. Everything here is about state on
 * disk; what a running turn does to a conversation lives in the task manager.
 */
export interface SessionStore {
  sessions: ChatSession[];
  hydrated: boolean;
  storageWarning: string | null;
  setStorageWarning: (warning: string | null) => void;
  getSession: (chatId: string) => ChatSession | undefined;
  addSession: (session: ChatSession) => void;
  updateSession: (
    chatId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  patchActiveMessage: (
    chatId: string,
    patch: Partial<MessageVersion>,
    sessionPatch?: Partial<ChatSession>,
  ) => void;
  deleteSession: (chatId: string) => void;
  clearSessions: () => void;
}

export function useSessions(): SessionStore {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const sessionsRef = useRef(sessions);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await migrateFromLocalStorage();
      const restored = await storageBackend().loadSessions();
      if (cancelled) return;

      setSessions(restored);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persistSession = useCallback((session: ChatSession) => {
    queueSessionSave(session, (_saved, reason) =>
      setStorageWarning(
        reason
          ? `Could not save this conversation: ${reason}`
          : "Could not save this conversation to disk.",
      ),
    );
  }, []);

  useEffect(() => {
    const flush = () => {
      void flushSessionSaves(sessionsRef.current);
    };

    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  const getSession = useCallback(
    (chatId: string) => sessionsRef.current.find((s) => s.id === chatId),
    [],
  );

  const addSession = useCallback((session: ChatSession) => {
    setSessions((prev) =>
      prev.some((s) => s.id === session.id) ? prev : [session, ...prev],
    );
  }, []);

  const updateSession = useCallback(
    (chatId: string, updater: (session: ChatSession) => ChatSession) => {
      let changed: ChatSession | null = null;

      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === chatId);
        if (idx === -1) return prev;

        const updated = updater(prev[idx]);
        if (updated === prev[idx]) return prev;

        const next = prev.slice();
        next[idx] = updated;
        changed = updated;
        return next;
      });

      if (changed) persistSession(changed);
    },
    [persistSession],
  );

  const patchActiveMessage = useCallback(
    (
      chatId: string,
      patch: Partial<MessageVersion>,
      sessionPatch?: Partial<ChatSession>,
    ) => {
      updateSession(chatId, (s) => {
        if (s.messages.length === 0) {
          return sessionPatch ? { ...s, ...sessionPatch } : s;
        }

        const msgs = s.messages.slice();
        const lastIdx = msgs.length - 1;
        const last = msgs[lastIdx];
        const vIdx = last.currentVersionIndex;

        if (last.versions && vIdx !== undefined && vIdx < last.versions.length) {
          const versions = last.versions.slice();
          versions[vIdx] = { ...versions[vIdx], ...patch };
          msgs[lastIdx] = { ...last, versions };
        } else {
          msgs[lastIdx] = { ...last, ...patch };
        }

        return { ...s, messages: msgs, ...sessionPatch };
      });
    },
    [updateSession],
  );

  const deleteSession = useCallback((chatId: string) => {
    cancelSessionSave(chatId);
    setSessions((prev) => prev.filter((s) => s.id !== chatId));
    storageBackend()
      .deleteSession(chatId)
      .catch(() => undefined);
  }, []);

  const clearSessions = useCallback(() => {
    for (const session of sessionsRef.current) cancelSessionSave(session.id);
    setSessions([]);
    storageBackend()
      .clearSessions()
      .catch(() => undefined);
  }, []);

  return {
    sessions,
    hydrated,
    storageWarning,
    setStorageWarning,
    getSession,
    addSession,
    updateSession,
    patchActiveMessage,
    deleteSession,
    clearSessions,
  };
}
