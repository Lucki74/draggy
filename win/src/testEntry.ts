/** Entry for /test (see scripts/testHarness.ts): the real app in a plain browser. The real preload runs
 * against a fake electron module whose calls go to the dev server, which stands in for the main process. */

const realFetch = window.fetch.bind(window);

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const response = await realFetch("/__test/ipc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, args }),
  });
  const body = (await response.json()) as { value?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.value ?? null;
}

const listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
const ipcRenderer = {
  invoke,
  send: () => {},
  on: (channel: string, listener: (event: unknown, value: unknown) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
  },
  removeListener: (channel: string, listener: (event: unknown, value: unknown) => void) => {
    listeners.get(channel)?.delete(listener);
  },
};

/** Lets the test page push an event the way the main process would. */
(window as unknown as { __emit: (channel: string, value: unknown) => void }).__emit = (channel, value) => {
  for (const listener of listeners.get(channel) ?? []) listener({}, value);
};

window.fetch = (input, init) =>
  typeof input === "string" && input.startsWith("draggy-ai://chat") ? realFetch("/__test/llm", init) : realFetch(input, init);

const source = await realFetch("/__test/preload.cjs").then((r) => r.text());
const electron = {
  ipcRenderer,
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      (window as unknown as Record<string, unknown>)[name] = api;
    },
  },
  webFrame: { setZoomFactor: () => {} },
};
new Function("require", "module", "process", source)(
  (id: string) => (id === "electron" ? electron : {}),
  { exports: {} },
  { platform: "win32", env: {}, versions: {} },
);

const bootModel = new URLSearchParams(window.location.search).get("model") ?? "gguf:Qwen3.8-27B-Uncensored-Q4_K_M.gguf";
(window as unknown as { __emit: (c: string, v: unknown) => void }).__emit("boot-model", bootModel);

await import("./main");
