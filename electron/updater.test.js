import EventEmitter from "node:events";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("disallows downgrades after channel resets in init and configure", () => {
    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, () => {});
    expect(fakeUpdater.allowDowngrade).toBe(false);

    updaterModule.configure({ automatic: false, channel: "release" });
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

  it("refuses to download or install when version is older than current", async () => {
    let downloadCalled = false;
    let installCalled = false;
    fakeUpdater.downloadUpdate = async () => {
      downloadCalled = true;
    };
    fakeUpdater.quitAndInstall = () => {
      installCalled = true;
    };

    const app = { isPackaged: true, getVersion: () => "2.1.0-rc2" };
    updaterModule.init(app, () => {});

    fakeUpdater.emit("update-available", { version: "2.0.4" });
    await updaterModule.download();
    expect(downloadCalled).toBe(false);

    updaterModule.install();
    expect(installCalled).toBe(false);
  });
});

