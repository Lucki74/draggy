import EventEmitter from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

/** Fakes electron-updater to verify update guards without network or binary dependencies. */
class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this._channel = null;
    this.allowDowngrade = false;
    this.allowPrerelease = false;
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.logger = null;
    this.feeds = [];
  }

  setFeedURL(feed) {
    this.feeds.push(feed);
  }

  get channel() {
    return this._channel;
  }

  set channel(value) {
    this._channel = value;
    // Mirrors electron-updater's AppUpdater behavior which flips allowDowngrade to true.
    this.allowDowngrade = true;
  }

  async checkForUpdates() {}
  async downloadUpdate() {}
  quitAndInstall() {}
}

describe("updater version comparisons", () => {
  it("rejects versions older than or equal to current", () => {
    const { isNewer } = require("./updater.cjs");
    expect(isNewer("2.0.4", "2.1.0-rc2")).toBe(false);
    expect(isNewer("2.1.0-rc", "2.1.0-rc2")).toBe(false);
    expect(isNewer("2.1.0-rc2", "2.1.0-rc2")).toBe(false);
    expect(isNewer("2.0.0", "2.1.0-rc2")).toBe(false);
    expect(isNewer(null, "2.1.0-rc2")).toBe(false);
    expect(isNewer("invalid", "2.1.0-rc2")).toBe(false);
  });

  it("accepts versions strictly newer than current", () => {
    const { isNewer } = require("./updater.cjs");
    expect(isNewer("2.1.0-rc3", "2.1.0-rc2")).toBe(true);
    expect(isNewer("2.1.0", "2.1.0-rc2")).toBe(true);
    expect(isNewer("v2.1.0", "2.1.0-rc2")).toBe(true);
    expect(isNewer("2.2.0", "2.1.0-rc2")).toBe(true);
  });
});

describe("updater downgrade protection", () => {
  let fakeUpdater;
  let originalCache;
  let updaterModule;
  const updaterPath = require.resolve("./updater.cjs");
  const electronUpdaterPath = require.resolve("electron-updater");

  beforeEach(() => {
    fakeUpdater = new FakeAutoUpdater();
    originalCache = require.cache[electronUpdaterPath];
    require.cache[electronUpdaterPath] = {
      id: electronUpdaterPath,
      filename: electronUpdaterPath,
      loaded: true,
      exports: { autoUpdater: fakeUpdater },
    };
    delete require.cache[updaterPath];
    updaterModule = require("./updater.cjs");
  });

  afterEach(() => {
    if (originalCache) require.cache[electronUpdaterPath] = originalCache;
    else delete require.cache[electronUpdaterPath];
    delete require.cache[updaterPath];
  });

  it("disallows downgrades after init", () => {
    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, () => {});
    expect(fakeUpdater.allowDowngrade).toBe(false);
  });

  it("ignores update-available events for older releases like 2.0.4 on 2.1.0-rc2", () => {
    const published = [];
    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, (state) => published.push(state));

    fakeUpdater.emit("update-available", { version: "2.0.4", releaseNotes: "Older release" });
    expect(published.length).toBeGreaterThan(0);
    const last = published[published.length - 1];
    expect(last.status).toBe("current");
    expect(last.version).not.toBe("2.0.4");
  });

  it("accepts update-available events for newer releases like 2.1.0-rc3 on 2.1.0-rc2", () => {
    const published = [];
    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, (state) => published.push(state));

    fakeUpdater.emit("update-available", { version: "2.1.0-rc3", releaseNotes: "Newer rc" });
    expect(published.length).toBeGreaterThan(0);
    const last = published[published.length - 1];
    expect(last.status).toBe("available");
    expect(last.version).toBe("2.1.0-rc3");
  });

  it("ignores update-downloaded events for older releases", () => {
    const published = [];
    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, (state) => published.push(state));

    fakeUpdater.emit("update-downloaded", { version: "2.0.4" });
    const last = published[published.length - 1];
    expect(last.status).toBe("current");
    expect(last.status).not.toBe("ready");
  });

  it("refuses to install when version is older than current", async () => {
    let installCalled = false;
    fakeUpdater.quitAndInstall = () => {
      installCalled = true;
    };

    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, () => {});

    fakeUpdater.emit("update-available", { version: "2.0.4" });
    updaterModule.install();
    expect(installCalled).toBe(false);
  });
});

const release = (tag, { prerelease = false, draft = false } = {}) => ({ tag_name: tag, prerelease, draft });

describe("choosing which build to update to", () => {
  it("takes the highest build number, compared as a number, whatever order GitHub lists them in", () => {
    const { pickBuildTag } = require("./updater.cjs");
    const builds = [release("b-9"), release("b-10"), release("b-2")];
    expect(pickBuildTag(builds)).toBe("b-10");
    expect(pickBuildTag([...builds].reverse())).toBe("b-10");
  });

  it("skips drafts, prereleases and tags that are not builds", () => {
    const { pickBuildTag } = require("./updater.cjs");
    const messy = [
      release("b-99", { draft: true }),
      release("b-98", { prerelease: true }),
      release("v2.4.0"),
      release("b-7x"),
      release("b-3"),
    ];
    expect(pickBuildTag(messy)).toBe("b-3");
    expect(pickBuildTag([])).toBeNull();
    expect(pickBuildTag(null)).toBeNull();
  });
});

describe("checking for updates", () => {
  let fakeUpdater;
  let originalCache;
  let updaterModule;
  const updaterPath = require.resolve("./updater.cjs");
  const electronUpdaterPath = require.resolve("electron-updater");

  beforeEach(() => {
    fakeUpdater = new FakeAutoUpdater();
    originalCache = require.cache[electronUpdaterPath];
    require.cache[electronUpdaterPath] = {
      id: electronUpdaterPath,
      filename: electronUpdaterPath,
      loaded: true,
      exports: { autoUpdater: fakeUpdater },
    };
    delete require.cache[updaterPath];
    updaterModule = require("./updater.cjs");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DRAGGY_UPDATE_FEED;
    if (originalCache) require.cache[electronUpdaterPath] = originalCache;
    else delete require.cache[electronUpdaterPath];
    delete require.cache[updaterPath];
  });

  /** Serves GitHub's release list one page per `page=` query value; pages past the last are empty. */
  const githubReturns = (...pages) => {
    const fetchMock = vi.fn(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return { ok: true, json: async () => pages[page - 1] ?? [] };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const fullPage = (prefix) => Array.from({ length: 100 }, (_, index) => release(`${prefix}-${index}`));
  const buildFeed = { provider: "generic", url: "https://github.com/Lucki74/draggy/releases/download/b-12" };

  it("reads latest.yml from the newest build's release", async () => {
    githubReturns([release("b-4"), release("b-12"), release("b-11")]);
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, () => {});

    await updaterModule.check();

    expect(fakeUpdater.feeds.at(-1)).toEqual({
      provider: "generic",
      url: "https://github.com/Lucki74/draggy/releases/download/b-12",
    });
  });

  it("never sets GitHub's own latest release as the feed when the list cannot be read", async () => {
    const published = [];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, (state) => published.push(state));

    await updaterModule.check();

    expect(fakeUpdater.feeds).toEqual([]);
    expect(fakeUpdater.feeds.some((feed) => feed.provider === "github")).toBe(false);
    expect(published.some((state) => state.status === "error")).toBe(false);
  });

  it("stays quiet when a check cannot read the list", async () => {
    const published = [];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, (state) => published.push(state));

    await updaterModule.check();

    expect(fakeUpdater.feeds).toEqual([]);
    expect(published.some((state) => state.status === "error")).toBe(false);
  });

  it("finds a build that sits after 40 non-build releases on the same page", async () => {
    const macos = Array.from({ length: 40 }, (_, index) => release(`macos-b-${index + 1}`));
    const fetchMock = githubReturns([...macos, release("b-12")]);
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, () => {});

    await updaterModule.check();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeUpdater.feeds.at(-1)).toEqual(buildFeed);
  });

  it("reads the next page when the first is full of non-build releases", async () => {
    const fetchMock = githubReturns(fullPage("other"), [release("b-12")]);
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, () => {});

    await updaterModule.check();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fakeUpdater.feeds.at(-1)).toEqual(buildFeed);
  });

  it("gives up after five full pages without a build and publishes no error", async () => {
    const published = [];
    const fetchMock = githubReturns(
      fullPage("one"),
      fullPage("two"),
      fullPage("three"),
      fullPage("four"),
      fullPage("five"),
      [release("b-12")],
    );
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, (state) => published.push(state));

    await updaterModule.check();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fakeUpdater.feeds).toEqual([]);
    expect(published.some((state) => state.status === "error")).toBe(false);
  });

  it("uses DRAGGY_UPDATE_FEED without asking GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.DRAGGY_UPDATE_FEED = "http://127.0.0.1:8123/feed";
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, () => {});

    await updaterModule.check();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeUpdater.feeds.at(-1)).toEqual({ provider: "generic", url: "http://127.0.0.1:8123/feed" });
  });

  it("publishes release notes as one string, from a string or a per-version list", () => {
    const published = [];
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, (state) => published.push(state));

    fakeUpdater.emit("update-available", { version: "3.0.5", releaseNotes: "  Faster start.  " });
    expect(published.at(-1).notes).toBe("Faster start.");

    fakeUpdater.emit("update-available", {
      version: "3.0.6",
      releaseNotes: [{ version: "3.0.6", note: "One" }, { version: "3.0.5", note: "Two" }],
    });
    expect(published.at(-1).notes).toBe("One\n\nTwo");

    fakeUpdater.emit("update-available", { version: "3.0.7" });
    expect(published.at(-1).notes).toBeNull();
  });

  it("publishes an error only while an update is pending, so the update window can close", async () => {
    const published = [];
    fakeUpdater.checkForUpdates = async () => {
      fakeUpdater.emit("error", new Error("boom"));
    };
    githubReturns([release("b-5")]);
    updaterModule.init({ isPackaged: true, getVersion: () => "3.0.4" }, (state) => published.push(state));

    await updaterModule.check();
    expect(published.some((state) => state.status === "error")).toBe(false);

    fakeUpdater.emit("update-available", { version: "3.0.5" });
    fakeUpdater.emit("error", new Error("boom"));
    expect(published.at(-1)).toMatchObject({ status: "error", error: "boom" });
  });
});

describe("updater signature check logging", () => {
  const updaterPath = require.resolve("./updater.cjs");
  const electronUpdaterPath = require.resolve("electron-updater");
  const packagePath = require.resolve("../package.json");
  const logger = require("./logger.cjs");

  let fakeUpdater;
  let updaterModule;
  let infoSpy;

  beforeEach(() => {
    fakeUpdater = new FakeAutoUpdater();
    require.cache[electronUpdaterPath] = {
      id: electronUpdaterPath,
      filename: electronUpdaterPath,
      loaded: true,
      exports: { autoUpdater: fakeUpdater },
    };
    delete require.cache[updaterPath];
    updaterModule = require("./updater.cjs");
    infoSpy = vi.spyOn(logger.log, "info");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[electronUpdaterPath];
    delete require.cache[updaterPath];
    delete require.cache[packagePath];
  });

  const signatureLines = () => infoSpy.mock.calls.filter(([scope, msg]) => scope === "updater" && msg === "signature check");

  it("logs the signature check as skipped when package.json turns it off", () => {
    updaterModule.init({ isPackaged: true, getVersion: () => "2.1.0-rc2" }, () => {});
    fakeUpdater.emit("update-downloaded", { version: "2.1.0-rc3" });

    const lines = signatureLines();
    expect(lines).toHaveLength(1);
    expect(lines[0][2]).toEqual({ verified: "skipped", reason: "verifyUpdateCodeSignature is false in package.json" });
  });

  it("reports the signature check as verified when it is on", () => {
    expect(updaterModule.signatureCheck(true)).toMatchObject({ verified: true });
  });

  it("repeats the package.json setting the packaged app cannot read", () => {
    const configured = require("../package.json").build?.win?.verifyUpdateCodeSignature;
    expect(updaterModule.signatureCheck()).toEqual(updaterModule.signatureCheck(configured === true));
  });

  it("logs nothing about the signature for an update that is not newer", () => {
    updaterModule.init({ isPackaged: true, getVersion: () => "2.1.0-rc2" }, () => {});
    fakeUpdater.emit("update-downloaded", { version: "2.0.4" });

    expect(signatureLines()).toHaveLength(0);
  });
});

describe("launch check", () => {
  let fakeUpdater;
  let originalCache;
  let updaterModule;
  const updaterPath = require.resolve("./updater.cjs");
  const electronUpdaterPath = require.resolve("electron-updater");
  const app = { isPackaged: true, getVersion: () => "3.0.4" };

  beforeEach(() => {
    fakeUpdater = new FakeAutoUpdater();
    originalCache = require.cache[electronUpdaterPath];
    require.cache[electronUpdaterPath] = {
      id: electronUpdaterPath,
      filename: electronUpdaterPath,
      loaded: true,
      exports: { autoUpdater: fakeUpdater },
    };
    delete require.cache[updaterPath];
    updaterModule = require("./updater.cjs");
  });

  afterEach(() => {
    updaterModule.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.DRAGGY_UPDATE_FEED;
    if (originalCache) require.cache[electronUpdaterPath] = originalCache;
    else delete require.cache[electronUpdaterPath];
    delete require.cache[updaterPath];
  });

  const releasesFetch = () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [release("b-12")] }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("returns none straight away when there is no updater", async () => {
    updaterModule.init({ isPackaged: false, getVersion: () => "3.0.4" }, () => {});
    await expect(updaterModule.checkAtLaunch()).resolves.toBe("none");
  });

  it("returns timeout when the check outlasts the budget", async () => {
    vi.useFakeTimers();
    releasesFetch();
    fakeUpdater.checkForUpdates = () => new Promise(() => {});
    updaterModule.init(app, () => {});

    const pending = updaterModule.checkAtLaunch({ budgetMs: 4000 });
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toBe("timeout");
  });

  it("returns downloading when an update is found in time", async () => {
    releasesFetch();
    fakeUpdater.checkForUpdates = async () => fakeUpdater.emit("update-available", { version: "3.0.5" });
    updaterModule.init(app, () => {});

    await expect(updaterModule.checkAtLaunch()).resolves.toBe("downloading");
  });

  it("returns ready when the update is already downloaded in time", async () => {
    releasesFetch();
    fakeUpdater.checkForUpdates = async () => {
      fakeUpdater.emit("update-available", { version: "3.0.5" });
      fakeUpdater.emit("update-downloaded", { version: "3.0.5" });
    };
    updaterModule.init(app, () => {});

    await expect(updaterModule.checkAtLaunch()).resolves.toBe("ready");
  });

  it("returns none when no newer build exists", async () => {
    releasesFetch();
    fakeUpdater.checkForUpdates = async () => fakeUpdater.emit("update-not-available");
    updaterModule.init(app, () => {});

    await expect(updaterModule.checkAtLaunch()).resolves.toBe("none");
  });

  it("returns none on error and publishes no error", async () => {
    const published = [];
    releasesFetch();
    fakeUpdater.checkForUpdates = async () => fakeUpdater.emit("error", new Error("offline"));
    updaterModule.init(app, (state) => published.push(state));

    await expect(updaterModule.checkAtLaunch()).resolves.toBe("none");
    expect(published.some((state) => state.status === "error")).toBe(false);
  });

  it("schedules the six-hour check once across repeated launch checks", async () => {
    vi.useFakeTimers();
    const fetchMock = releasesFetch();
    updaterModule.init(app, () => {});

    await updaterModule.checkAtLaunch();
    await updaterModule.checkAtLaunch();
    const callsBefore = fetchMock.mock.calls.length;

    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(fetchMock.mock.calls.length - callsBefore).toBe(1);
  });
});
