/** Installs `window.electronAPI` when the page runs inside Tauri. Electron's preload does it there,
 * so this does nothing outside Tauri. Import it before anything reads the API. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { createElectronApi } from "./electronApi";
import type { IpcLike } from "./electronApi";
import { logRendererEvent } from "../logger";

type Listener = (event: unknown, value: unknown) => void;

/** Tauri rejects with a bare string; callers expect an Error like Electron's. */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** `listen` is async but `removeListener` is not, so a removal before the subscription lands
 * is remembered and applied the moment it does. */
function createTauriIpc(): IpcLike {
  const active = new Map<string, Map<Listener, { unlisten?: UnlistenFn; removed: boolean }>>();
  return {
    invoke: (channel, ...args) => invoke("ipc_invoke", { channel, args }).catch((reason) => {
      throw asError(reason);
    }),
    send: (channel, ...args) => {
      invoke("ipc_send", { channel, args }).catch((reason) => {
        // The log's own channels failing must not log through themselves.
        if (channel.startsWith("logs:")) return;
        logRendererEvent("ipc", "WARN", "send failed", { channel, error: asError(reason).message });
      });
    },
    on: (channel, listener) => {
      const entry: { unlisten?: UnlistenFn; removed: boolean } = { removed: false };
      if (!active.has(channel)) active.set(channel, new Map());
      active.get(channel)!.set(listener, entry);
      listen(channel, (event) => listener({}, event.payload))
        .then((unlisten) => {
          if (entry.removed) unlisten();
          else entry.unlisten = unlisten;
        })
        .catch((reason) => logRendererEvent("ipc", "WARN", "listen failed", { channel, error: asError(reason).message }));
    },
    removeListener: (channel, listener) => {
      const entry = active.get(channel)?.get(listener);
      if (!entry) return;
      entry.removed = true;
      entry.unlisten?.();
      active.get(channel)!.delete(listener);
    },
  };
}

if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
  window.electronAPI = createElectronApi(createTauriIpc());
}
