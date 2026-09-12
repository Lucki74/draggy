import { vi } from "vitest";

/**
 * A stand-in for the preload bridge. Component tests need the whole surface to
 * exist, and only ever care about two or three calls of it.
 */

type Listener<T> = (value: T) => void;

/** One channel, with the disposer semantics the real preload has. */
export class Channel<T> {
  private listeners = new Set<Listener<T>>();

  subscribe = (callback: Listener<T>) => {
    this.listeners.add(callback);
    // Returning the Set's boolean would hand React something it cannot call.
    return () => {
      this.listeners.delete(callback);
    };
  };

  emit(value: T) {
    for (const listener of [...this.listeners]) listener(value);
  }

  get count() {
    return this.listeners.size;
  }
}

export interface FakeApi {
  updater: Channel<Record<string, unknown>>;
  mcp: Channel<Record<string, unknown>>;
  updaterState: Record<string, unknown>;
  install: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  created: { filename: string; content: string }[];
}

/**
 * Anything not spelled out below answers with an empty result rather than
 * throwing, so a component can call the parts of the bridge it likes.
 */
function stub(): unknown {
  return new Proxy(() => {}, {
    get: (_target, key) => {
      if (key === "then") return undefined;
      return stub();
    },
    apply: () => Promise.resolve({}),
  });
}

export function installFakeElectronApi(): FakeApi {
  const updater = new Channel<Record<string, unknown>>();
  const mcp = new Channel<Record<string, unknown>>();
  const fake: FakeApi = {
    updater,
    mcp,
    updaterState: { status: "idle", version: null, percent: 0, error: null },
    install: vi.fn(async () => ({})),
    check: vi.fn(async () => ({})),
    created: [],
  };

  const api = {
    updater: {
      state: async () => fake.updaterState,
      configure: async () => ({}),
      check: fake.check,
      download: async () => ({}),
      install: fake.install,
      onState: updater.subscribe,
    },
    mcp: {
      catalogue: async () => ({ servers: [] }),
      config: async () => ({ config: {} }),
      running: async () => ({ servers: [] }),
      save: async () => ({}),
      start: async () => ({}),
      stop: async () => ({}),
      startEnabled: async () => ({ servers: [] }),
      enabled: async () => ({ success: true, ids: [] }),
      setEnabled: async () => ({ success: true, ids: [] }),
      search: async () => ({ success: true, entries: [] }),
      signIn: async () => ({ success: true }),
      signOut: async () => ({ success: true }),
      call: async () => ({}),
      onState: mcp.subscribe,
    },
    createFile: async (filename: string, content: string) => {
      fake.created.push({ filename, content });
      return { success: true, filepath: `C:\files\${filename}` };
    },
    // Subscriptions have to hand back a disposer: React calls what an effect
    // returns, and the catch-all below answers with a promise.
    onBootModel: () => () => {},
    onDownloadProgress: () => () => {},
    appInfo: async () => ({ version: "1.2.4", packaged: true }),
    library: { stats: async () => ({ stats: null }), onProgress: () => () => {} },
    db: { stats: async () => ({ stats: null }) },
  };

  (window as unknown as { electronAPI: unknown }).electronAPI = new Proxy(api, {
    get: (target, key) =>
      key in target ? target[key as keyof typeof api] : stub(),
  });

  return fake;
}

export function clearFakeElectronApi() {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}
