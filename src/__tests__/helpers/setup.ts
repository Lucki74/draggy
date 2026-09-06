/**
 * Node 25 exposes its own `localStorage` global, unusable without a file, and
 * it shadows the one jsdom installs. Component tests get a working one here.
 */
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length() {
    return this.entries.size;
  }

  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.entries.set(key, String(value));
  }

  removeItem(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  [name: string]: unknown;
}

const broken = typeof globalThis.localStorage?.setItem !== "function";

if (broken) {
  const storage = new MemoryStorage();
  for (const target of [globalThis, globalThis.window].filter(Boolean)) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}

/**
 * The handful of browser APIs jsdom leaves out that the interface calls
 * without checking. Each is a no-op: none of them decide anything under test.
 */
if (typeof window !== "undefined") {
  Element.prototype.scrollIntoView ??= () => {};

  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
