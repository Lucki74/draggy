import { logRendererEvent, logSwallow } from "../../logger";

export const DB_NAME = "draggy_db";
export const DB_VERSION = 1;
export const STORE_NAME = "questionSessions";

let migrationRan = false;

function logMigration(): void {
  if (!migrationRan) {
    logRendererEvent("store", "INFO", "Added question sessions storage");
    migrationRan = true;
  }
}

/**
 * Checks if questionSessions table/store exists in IndexedDB (or fallback),
 * creates it if missing, and logs "Added question sessions storage".
 */
export async function runAddQuestionSessionsMigration(): Promise<boolean> {
  if (typeof globalThis.indexedDB !== "undefined") {
    return new Promise((resolve) => {
      try {
        const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("chatId", "chatId", { unique: false });
            store.createIndex("workspaceId", "workspaceId", { unique: false });
            store.createIndex("status", "status", { unique: false });
            store.createIndex("createdAt", "startedAt", { unique: false });
            logMigration();
          }
        };

        req.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            // Need a version bump to add the store
            const newVersion = db.version + 1;
            db.close();
            const upgradeReq = globalThis.indexedDB.open(DB_NAME, newVersion);
            upgradeReq.onupgradeneeded = (e) => {
              const upgradedDb = (e.target as IDBOpenDBRequest).result;
              if (!upgradedDb.objectStoreNames.contains(STORE_NAME)) {
                const store = upgradedDb.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("chatId", "chatId", { unique: false });
                store.createIndex("workspaceId", "workspaceId", { unique: false });
                store.createIndex("status", "status", { unique: false });
                store.createIndex("createdAt", "startedAt", { unique: false });
                logMigration();
              }
            };
            upgradeReq.onsuccess = (e) => {
              (e.target as IDBOpenDBRequest).result.close();
              resolve(true);
            };
            upgradeReq.onerror = () => resolve(false);
          } else {
            db.close();
            logMigration();
            resolve(true);
          }
        };

        req.onerror = (e) => {
          logSwallow("addQuestionSessionsMigration", e, "idb open error");
          logMigration();
          resolve(false);
        };
      } catch (error) {
        logSwallow("addQuestionSessionsMigration", error, "idb open exception");
        logMigration();
        resolve(false);
      }
    });
  }

  // Fallback when indexedDB is unavailable (e.g. node runtime)
  logMigration();
  return true;
}
