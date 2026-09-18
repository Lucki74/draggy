import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSession, MessageVersion } from "../types";
import {
  cancelSessionSave,
  flushSessionSaves,
  markSessionsSaved,
  migrateFromLocalStorage,
  queueSessionSave,
  storageBackend,
} from "../storage";
import { workspaceIdOf } from "../workspaces";

/** The conversations and their persistence. Everything here is about state on disk; what a running
 * turn does to a conversation lives in the task manager. */
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
  /** Deletes the conversations that match, and keeps the rest. */
  deleteSessionsWhere: (matches: (session: ChatSession) => boolean) => void;
  /** After a project is removed: the database has already deleted its sessions. */
  forgetWorkspace: (workspaceId: string) => void;
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

      markSessionsSaved(restored);
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
    const flush = () => flushSessionSaves(sessionsRef.current);
    const onUnload = () => void flush();

    // Main waits for this before it closes storage; beforeunload alone is not waited for.
    const stopQuit = window.electronAPI?.onBeforeQuit?.(flush);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      stopQuit?.();
      window.removeEventListener("beforeunload", onUnload);
    };
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
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === chatId);
        if (idx === -1) return prev;

        const updated = updater(prev[idx]);
        if (updated === prev[idx]) return prev;

        const next = prev.slice();
        next[idx] = updated;
        // Queued here: React runs a batched updater only at render, after this call has returned.
        persistSession(updated);
        return next;
      });
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

  const deleteSessionsWhere = useCallback(
    (matches: (session: ChatSession) => boolean) => {
      const doomed = sessionsRef.current.filter(matches);
      if (doomed.length === 0) return;

      if (doomed.length === sessionsRef.current.length) {
        clearSessions();
        return;
      }

      for (const session of doomed) deleteSession(session.id);
    },
    [clearSessions, deleteSession],
  );

  const forgetWorkspace = useCallback((workspaceId: string) => {
    // A save still queued would write a removed session back.
    for (const session of sessionsRef.current) {
      if (workspaceIdOf(session) === workspaceId) cancelSessionSave(session.id);
    }
    setSessions((prev) => prev.filter((session) => workspaceIdOf(session) !== workspaceId));
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
    deleteSessionsWhere,
    forgetWorkspace,
  };
}
