import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createEngineHost } = require("./engineHost.cjs");

function fakeEngine() {
  const engine = { running: false, stops: 0 };
  engine.stopSync = () => {
    engine.stops += 1;
    engine.running = false;
  };
  engine.status = () => ({ running: engine.running, port: engine.running ? 1 : null, model: engine.running ? "m" : null });
  return engine;
}

describe("engine host", () => {
  it("stops the other engine before starting one", async () => {
    const llamacpp = fakeEngine();
    const colibri = fakeEngine();
    const host = createEngineHost({ llamacpp, colibri });
    await host.start("llamacpp", async () => ((llamacpp.running = true), { success: true }));
    await host.start("colibri", async () => ((colibri.running = true), { success: true }));
    expect(llamacpp.stops).toBe(1);
    expect(host.status()).toMatchObject({ kind: "colibri", running: true });
    expect(host.active).toBe("colibri");
  });

  it("leaves nothing active when a start fails", async () => {
    const host = createEngineHost({ llamacpp: fakeEngine(), colibri: fakeEngine() });
    const result = await host.start("colibri", async () => ({ success: false, kind: "colibri-nomem" }));
    expect(result.kind).toBe("colibri-nomem");
    expect(host.active).toBeNull();
    expect(host.status().running).toBe(false);
  });

  it("stops both on quit and rejects an unknown engine", async () => {
    const llamacpp = fakeEngine();
    const colibri = fakeEngine();
    const host = createEngineHost({ llamacpp, colibri });
    host.stop();
    expect([llamacpp.stops, colibri.stops]).toEqual([1, 1]);
    await expect(host.start("vllm", async () => ({}))).rejects.toThrow(/Unknown engine/);
  });
});
