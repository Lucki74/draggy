import type {
  QuestionSession,
  UserAnswer,
  UserQuestion,
} from "../chat/questionTypes";
import { DB_NAME, runAddQuestionSessionsMigration, STORE_NAME } from "./migrations/add-question-sessions";
import { logSwallow } from "../logger";

const LOCAL_STORAGE_KEY = "draggy_question_sessions";

export type SessionChangeListener = (session: QuestionSession) => void;

class QuestionSessionStore {
  private cache = new Map<string, QuestionSession>();
  private listeners = new Set<SessionChangeListener>();
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await runAddQuestionSessionsMigration();
    } catch (error) {
      logSwallow("questionSessionStore", error, "migration failure");
    }

    // Load existing sessions from IndexedDB or localStorage
    if (typeof globalThis.indexedDB !== "undefined") {
      try {
        await new Promise<void>((resolve) => {
          const req = globalThis.indexedDB.open(DB_NAME);
          req.onsuccess = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.close();
              this.loadFromLocalStorage();
              resolve();
              return;
            }
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              if (Array.isArray(getAllReq.result)) {
                for (const item of getAllReq.result) {
                  this.cache.set(item.id, item);
                }
              }
              db.close();
              resolve();
            };
            getAllReq.onerror = () => {
              db.close();
              this.loadFromLocalStorage();
              resolve();
            };
          };
          req.onerror = () => {
            this.loadFromLocalStorage();
            resolve();
          };
        });
      } catch (error) {
        logSwallow("questionSessionStore", error, "idb open error");
        this.loadFromLocalStorage();
      }
    } else {
      this.loadFromLocalStorage();
    }
  }

  private loadFromLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            this.cache.set(s.id, s);
          }
        }
      }
    } catch (error) {
      logSwallow("questionSessionStore", error, "local storage read error");
    }
  }

  private async persist(session: QuestionSession): Promise<void> {
    this.cache.set(session.id, session);
    this.notify(session);

    // Save to localStorage as quick fallback
    if (typeof localStorage !== "undefined") {
      try {
        const all = Array.from(this.cache.values());
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
      } catch (error) {
        logSwallow("questionSessionStore", error, "local storage write error");
      }
    }

    // Save to IndexedDB if available
    if (typeof globalThis.indexedDB !== "undefined") {
      try {
        const req = globalThis.indexedDB.open(DB_NAME);
        req.onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.close();
            return;
          }
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          store.put(session);
          tx.oncomplete = () => db.close();
          tx.onerror = () => db.close();
        };
      } catch (error) {
        logSwallow("questionSessionStore", error, "idb put error");
      }
    }
  }

  private notify(session: QuestionSession): void {
    for (const listener of this.listeners) {
      try {
        listener(session);
      } catch (error) {
        logSwallow("questionSessionStore", error, "listener error");
      }
    }
  }

  subscribe(listener: SessionChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createSession(
    chatId: string,
    workspaceId: string = "default",
    metadata?: Record<string, unknown>,
    messageId?: string,
  ): Promise<QuestionSession> {
    await this.ensureInitialized();
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: QuestionSession = {
      id,
      chatId,
      workspaceId,
      messageId: messageId ?? (typeof metadata?.messageId === "string" ? metadata.messageId : undefined),
      status: "active",
      questions: [],
      answers: [],
      currentIndex: 0,
      startedAt: Date.now(),
      metadata,
    };
    await this.persist(session);
    return session;
  }

  async updateSession(sessionId: string, partial: Partial<QuestionSession>): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);
    Object.assign(session, partial);
    await this.persist(session);
    return session;
  }

  async getSession(sessionId: string): Promise<QuestionSession | null> {
    await this.ensureInitialized();
    return this.cache.get(sessionId) ?? null;
  }

  async addQuestion(sessionId: string, question: UserQuestion): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);

    // Avoid duplicates
    if (!session.questions.some((q) => q.id === question.id)) {
      session.questions.push(question);
      await this.persist(session);
    }
    return session;
  }

  async submitAnswer(sessionId: string, answer: UserAnswer): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);

    const existingIdx = session.answers.findIndex((a) => a.questionId === answer.questionId);
    if (existingIdx >= 0) {
      session.answers[existingIdx] = answer;
    } else {
      session.answers.push(answer);
    }

    // Auto-advance currentIndex if not at the end
    if (session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1;
    }

    // If all questions are answered, mark completed
    if (
      session.questions.length > 0 &&
      session.questions.every((q) => session.answers.some((a) => a.questionId === q.id))
    ) {
      session.status = "completed";
      session.completedAt = Date.now();
    }

    await this.persist(session);
    return session;
  }

  async skipQuestion(sessionId: string, questionId: string): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);

    const q = session.questions.find((item) => item.id === questionId);
    if (q?.required) {
      throw new Error(`Question ${questionId} is required and cannot be skipped`);
    }

    // Advance if current question was skipped
    const currentQ = session.questions[session.currentIndex];
    if (currentQ?.id === questionId && session.currentIndex < session.questions.length - 1) {
      session.currentIndex += 1;
    }

    // Check if everything is answered or skipped
    const answeredOrSkippedCount = session.answers.length + 1;
    if (answeredOrSkippedCount >= session.questions.length && session.answers.length === 0) {
      session.status = "skipped";
      session.completedAt = Date.now();
    } else if (answeredOrSkippedCount >= session.questions.length) {
      session.status = "completed";
      session.completedAt = Date.now();
    }

    await this.persist(session);
    return session;
  }

  async setCurrentIndex(sessionId: string, index: number): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);
    session.currentIndex = Math.max(0, Math.min(index, Math.max(0, session.questions.length - 1)));
    await this.persist(session);
    return session;
  }

  async completeSession(sessionId: string): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);
    session.status = "completed";
    session.completedAt = Date.now();
    await this.persist(session);
    return session;
  }

  async expireSession(sessionId: string): Promise<QuestionSession> {
    await this.ensureInitialized();
    const session = this.cache.get(sessionId);
    if (!session) throw new Error(`Question session not found: ${sessionId}`);
    session.status = "expired";
    session.completedAt = Date.now();
    await this.persist(session);
    return session;
  }

  async getAllSessions(chatId: string): Promise<QuestionSession[]> {
    await this.ensureInitialized();
    return Array.from(this.cache.values())
      .filter((s) => s.chatId === chatId)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  async getActiveSession(chatId: string): Promise<QuestionSession | null> {
    await this.ensureInitialized();
    const active = Array.from(this.cache.values()).find(
      (s) => s.chatId === chatId && s.status === "active",
    );
    return active ?? null;
  }

  async clearSessions(chatId: string): Promise<void> {
    await this.ensureInitialized();
    for (const [id, session] of this.cache.entries()) {
      if (session.chatId === chatId) {
        this.cache.delete(id);
      }
    }

    if (typeof localStorage !== "undefined") {
      try {
        const remaining = Array.from(this.cache.values());
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
      } catch (error) {
        logSwallow("questionSessionStore", error, "local storage clear error");
      }
    }

    if (typeof globalThis.indexedDB !== "undefined") {
      try {
        const req = globalThis.indexedDB.open(DB_NAME);
        req.onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.close();
            return;
          }
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const index = store.index("chatId");
          const getReq = index.getAllKeys(chatId);
          getReq.onsuccess = () => {
            if (Array.isArray(getReq.result)) {
              for (const key of getReq.result) {
                store.delete(key);
              }
            }
          };
          tx.oncomplete = () => db.close();
          tx.onerror = () => db.close();
        };
      } catch (error) {
        logSwallow("questionSessionStore", error, "idb delete error");
      }
    }
  }

  // Clear all cache (useful for testing)
  _clearAll(): void {
    this.cache.clear();
    this.listeners.clear();
    this.initialized = false;
  }
}

export const questionSessionStore = new QuestionSessionStore();
