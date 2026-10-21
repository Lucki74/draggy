import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const sdServer = require("./sdServer.cjs");

/** A stand-in for sd-server speaking the pinned release's native API, so CI needs no binary or GPU. */
const FAKE_SERVER = String.raw`
const http = require("node:http");
const fs = require("node:fs");
const argv = process.argv;
const port = Number(argv[argv.indexOf("--listen-port") + 1]);
const mode = process.env.FAKE_SD_MODE || "normal";
const marker = process.env.FAKE_SD_MARKER || "";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const jobs = new Map();
let next = 1;
if (process.env.FAKE_SD_ARGS) fs.writeFileSync(process.env.FAKE_SD_ARGS, JSON.stringify(argv.slice(2)));
if (mode === "no-start") process.exit(1);
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/sdcpp/v1/capabilities") return send(res, 200, { limits: { min_width: 64, max_width: 1024, min_height: 64, max_height: 1024, max_queue_size: 4 }, features_by_mode: { img_gen: { cancel_queued: true, cancel_generating: false } } });
    if (req.method === "POST" && req.url === "/sdcpp/v1/img_gen") {
      if (mode === "queue-full") return send(res, 429, { error: { code: "queue_full", message: "queue full" } });
      if (mode === "crash-once" && !fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(3); }
      if (mode === "crash-always") process.exit(3);
      const id = "job_" + next++;
      jobs.set(id, { polls: 0, status: "queued", body: JSON.parse(raw) });
      if (process.env.FAKE_SD_BODY) fs.writeFileSync(process.env.FAKE_SD_BODY, raw);
      return send(res, 202, { id, kind: "img_gen", status: "queued", poll_url: "/sdcpp/v1/jobs/" + id });
    }
    const cancel = req.url.match(/^\/sdcpp\/v1\/jobs\/([^/]+)\/cancel$/);
    // Like the pinned build: a queued job can be cancelled, one already generating cannot.
    if (cancel) { const job = jobs.get(cancel[1]); if (job && job.status === "generating") return send(res, 409, { error: "job is generating" }); if (job) job.status = "cancelled"; return send(res, 200, {}); }
    const poll = req.url.match(/^\/sdcpp\/v1\/jobs\/([^/]+)$/);
    if (poll) {
      const job = jobs.get(poll[1]);
      if (!job) return send(res, 404, {});
      job.polls++;
      if (job.status !== "cancelled") {
        if (mode === "fail" && job.polls > 1) return send(res, 200, { id: poll[1], status: "failed", error: { code: "generation_failed", message: "boom" } });
        // The real server stops answering while it decodes; the fake holds one poll past the client's timeout.
        if (mode === "busy-decode" && job.polls === 3) return setTimeout(() => send(res, 200, { id: poll[1], status: "generating", queue_position: 0 }), 1500);
        const slow = mode === "slow" ? 25 : mode === "busy-decode" ? 5 : 2;
        job.status = job.polls < 2 ? "queued" : job.polls < slow ? "generating" : "completed";
      }
      return send(res, 200, {
        id: poll[1], status: job.status, queue_position: job.status === "queued" ? 1 : 0,
        result: job.status === "completed" ? { output_format: "png", images: [{ index: 0, b64_json: PNG }] } : null,
        error: job.status === "cancelled" ? { code: "cancelled", message: "job cancelled by client" } : null,
      });
    }
    send(res, 404, {});
  });
}).listen(port, "127.0.0.1");
`;

let dir;
let script;

function launchInfo(extra = {}) {
  return {
    binaryPath: process.execPath,
    env: { ...process.env, ...extra.env },
    modelsDir: dir,
    defaultModel: "file:fake.gguf",
    tmpDir: path.join(dir, "tmp"),
    runner: "vulkan",
    memory: async () => ({ freeVramGB: 8, freeRamGB: 16 }),
    log: { info() {}, debug() {}, warn() {}, error() {} },
    ...extra,
  };
}

function useFake(extra = {}) {
  const info = launchInfo(extra);
  sdServer.configure(async () => info);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-sd-"));
  script = path.join(dir, "fake-sd-server.cjs");
  fs.writeFileSync(script, FAKE_SERVER);
  fs.writeFileSync(path.join(dir, "fake.gguf"), "not a real model");
});

afterEach(() => {
  sdServer.stopSync();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The "binary" is Node, and the fake script has to come before the engine's own arguments. */
function fakeBinary() {
  return { binaryPath: process.execPath, prefix: [script] };
}

// Each test starts a real Node child, which the full suite on a busy machine can slow past the default.
describe("sd-server lifecycle against a fake server", { timeout: 45_000 }, () => {
  it("generates an image through submit and poll, and writes it to a temp file", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix });

    const states = [];
    const result = await sdServer.generate("req1", { prompt: "a cat", width: 500, height: 300 }, (p) => states.push(p.status));

    expect(fs.existsSync(result.tmpPath)).toBe(true);
    expect(fs.readFileSync(result.tmpPath).subarray(1, 4).toString()).toBe("PNG");
    // Sizes are rounded to multiples of 64 before they reach the engine.
    expect(result.width).toBe(512);
    expect(result.height).toBe(320);
    expect(states).toContain("loading-model");
    expect(states).toContain("generating");
    expect(sdServer.status().running).toBe(true);
  });

  it("starts the engine on 127.0.0.1 with a port of its own, never a fixed one", async () => {
    const argsFile = path.join(dir, "args.json");
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_ARGS: argsFile } });

    await sdServer.generate("req-args", { prompt: "x" });
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8"));
    expect(args[args.indexOf("--listen-ip") + 1]).toBe("127.0.0.1");
    expect(Number(args[args.indexOf("--listen-port") + 1])).toBeGreaterThan(0);
    expect(args).toContain("-m");
  });

  it("cancels a job that is generating", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "slow" } });

    const job = sdServer.generate("req-cancel", { prompt: "slow" }, (p) => {
      if (p.status === "generating") void sdServer.cancel("req-cancel");
    });
    await expect(job).rejects.toMatchObject({ code: "E_CANCELLED" });
  });

  it("stops a job that is already drawing, which the engine itself cannot cancel", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "slow" } });

    const started = Date.now();
    const job = sdServer.generate("req-cancel-drawing", { prompt: "slow" });
    setTimeout(() => void sdServer.cancel("req-cancel-drawing"), 2500);
    await expect(job).rejects.toMatchObject({ code: "E_CANCELLED" });
    // The fake takes ten seconds to finish; a stop that waited for it would take as long.
    expect(Date.now() - started).toBeLessThan(6000);
  });

  it("reports a full queue as busy", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "queue-full" } });
    await expect(sdServer.generate("req-busy", { prompt: "x" })).rejects.toMatchObject({ code: "E_BUSY" });
  });

  it("passes the engine's own failure on", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "fail" } });
    await expect(sdServer.generate("req-fail", { prompt: "x" })).rejects.toMatchObject({ code: "E_FAILED", message: "boom" });
  });

  it("restarts once after a crash mid-job, and succeeds", async () => {
    const fake = fakeBinary();
    const marker = path.join(dir, "crashed");
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "crash-once", FAKE_SD_MARKER: marker } });

    const result = await sdServer.generate("req-crash", { prompt: "x" });
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.existsSync(result.tmpPath)).toBe(true);
  });

  it("relaunches in safe mode after a crash", async () => {
    const argsFile = path.join(dir, "args-safe.json");
    const fake = fakeBinary();
    const marker = path.join(dir, "crashed-safe");
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "crash-once", FAKE_SD_MARKER: marker, FAKE_SD_ARGS: argsFile } });
    await sdServer.generate("req-safe", { prompt: "x" });
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8"));
    expect(args).toEqual(expect.arrayContaining(["--vae-tiling", "--diffusion-fa", "--offload-to-cpu"]));
  });

  it("gives up after a second crash instead of looping", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "crash-always" } });
    await expect(sdServer.generate("req-crash2", { prompt: "x" })).rejects.toMatchObject({ code: "E_CRASH" });
  });

  it("names an engine that never answered as a start failure", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "no-start" } });
    await expect(sdServer.generate("req-nostart", { prompt: "x" })).rejects.toMatchObject({ code: "E_ENGINE_START" });
  });

  it("refuses before starting anything when the memory is not there", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, memory: async () => ({ freeVramGB: 0.2, freeRamGB: 0.3 }) });
    await expect(sdServer.generate("req-vram", { prompt: "x" })).rejects.toMatchObject({ code: "E_VRAM" });
    expect(sdServer.status().running).toBe(false);
  });

  it("leaves weights to auto-fit and decodes in tiles when the GPU is short but RAM is not", async () => {
    const argsFile = path.join(dir, "args-offload.json");
    const fake = fakeBinary();
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      env: { FAKE_SD_ARGS: argsFile },
      memory: async () => ({ freeVramGB: 0.2, freeRamGB: 16 }),
    });
    await sdServer.generate("req-offload", { prompt: "x" });
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8"));
    expect(args).toContain("--vae-tiling");
    expect(args).not.toContain("--offload-to-cpu");
  });

  it("keeps waiting when the engine is too busy decoding to answer a poll", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "busy-decode" }, pollTimeoutMs: 500 });
    const result = await sdServer.generate("req-busy-decode", { prompt: "x" });
    expect(fs.existsSync(result.tmpPath)).toBe(true);
  });

  it("gives up on an engine that stays silent past its patience", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_MODE: "busy-decode" }, pollTimeoutMs: 500, pollPatienceMs: 100 });
    await expect(sdServer.generate("req-silent", { prompt: "x" })).rejects.toMatchObject({ code: "E_FAILED" });
  });

  it("stops the chat model rather than holding weights in RAM when that makes the model fit", async () => {
    const argsFile = path.join(dir, "args-unload.json");
    const fake = fakeBinary();
    let freed = 0;
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      env: { FAKE_SD_ARGS: argsFile },
      memory: async () => ({ freeVramGB: 0.4, loadedLlmGB: 5.6, freeRamGB: 16 }),
      freeChatModel: () => {
        freed += 1;
      },
    });
    await sdServer.generate("req-unload", { prompt: "x" });
    expect(freed).toBe(1);
    expect(JSON.parse(fs.readFileSync(argsFile, "utf8"))).not.toContain("--vae-tiling");
  });

  it("gives the chat model its memory back when it starts again, after the running picture", async () => {
    const fake = fakeBinary();
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      memory: async () => ({ freeVramGB: 0.4, loadedLlmGB: 5.6, freeRamGB: 16 }),
      freeChatModel: () => {},
    });
    const job = sdServer.generate("req-yield", { prompt: "x" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const yielded = sdServer.yieldToChat();
    await job;
    expect(await yielded).toBe(true);
    expect(sdServer.status().running).toBe(false);
  });

  it("reloads the chat model after image generation finishes when it was evicted", async () => {
    const fake = fakeBinary();
    let reloaded = 0;
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      memory: async () => ({ freeVramGB: 0.4, loadedLlmGB: 5.6, freeRamGB: 16 }),
      freeChatModel: () => {},
      reloadChatModel: () => {
        reloaded += 1;
      },
    });
    await sdServer.generate("req-reload", { prompt: "x" });
    expect(reloaded).toBe(1);
  });

  it("does not reload the chat model if it was never evicted", async () => {
    const fake = fakeBinary();
    let reloaded = 0;
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      memory: async () => ({ freeVramGB: 8, loadedLlmGB: 2, freeRamGB: 16 }),
      freeChatModel: () => {},
      reloadChatModel: () => {
        reloaded += 1;
      },
    });
    await sdServer.generate("req-no-evict", { prompt: "x" });
    expect(reloaded).toBe(0);
  });

  it("leaves the image engine alone when the chat model was never pushed out", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix });
    await sdServer.generate("req-no-yield", { prompt: "x" });
    expect(await sdServer.yieldToChat()).toBe(false);
    expect(sdServer.status().running).toBe(true);
  });

  it("stops the chat model before measuring when the user asked for that", async () => {
    const fake = fakeBinary();
    const order = [];
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      memory: async () => {
        order.push("measure");
        return { freeVramGB: 8, freeRamGB: 16 };
      },
      freeChatModel: () => order.push("free"),
    });
    await sdServer.generate("req-stop-chat", { prompt: "x", stopChat: true });
    expect(order).toEqual(["free", "measure"]);
    expect(await sdServer.yieldToChat()).toBe(true);
  });

  it("reuses a running engine without measuring its own memory against it", async () => {
    const fake = fakeBinary();
    let measured = 0;
    useFake({
      binaryPath: fake.binaryPath,
      argsPrefix: fake.prefix,
      memory: async () => {
        measured += 1;
        return measured === 1 ? { freeVramGB: 8, freeRamGB: 16 } : { freeVramGB: 0.1, freeRamGB: 0.1 };
      },
    });
    await sdServer.generate("req-first-run", { prompt: "x" });
    await sdServer.generate("req-second-run", { prompt: "y" });
    expect(measured).toBe(1);
  });

  it("stops the engine once idle, freeing its memory", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix });
    sdServer.setOptions({ idleTimeoutSec: 1 });
    await sdServer.generate("req-idle", { prompt: "x" });
    expect(sdServer.status().running).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(sdServer.status().running).toBe(false);
    sdServer.setOptions({ idleTimeoutSec: 300 });
  });

  it("stops the engine the moment its last picture is done when the timeout is 0", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix });
    sdServer.setOptions({ idleTimeoutSec: 0 });
    const first = sdServer.generate("req-now-a", { prompt: "a" });
    const second = sdServer.generate("req-now-b", { prompt: "b" });
    await first;
    expect(sdServer.status().running).toBe(true);
    await second;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sdServer.status().running).toBe(false);
    sdServer.setOptions({ idleTimeoutSec: 300 });
  });

  it("runs one job at a time, the second waiting its turn", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix });
    const second = [];
    const first = sdServer.generate("req-a", { prompt: "a" });
    const other = sdServer.generate("req-b", { prompt: "b" }, (p) => second.push(p.status));
    await Promise.all([first, other]);
    expect(second[0]).toBe("queued");
  });

  it("drops a queued request cancelled before its turn", async () => {
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix });
    const first = sdServer.generate("req-first", { prompt: "a" });
    const queued = sdServer.generate("req-queued", { prompt: "b" });
    await sdServer.cancel("req-queued");
    await first;
    await expect(queued).rejects.toMatchObject({ code: "E_CANCELLED" });
  });

  it("sends image-to-image and LoRA through the documented fields only", async () => {
    const bodyFile = path.join(dir, "body.json");
    const fake = fakeBinary();
    useFake({ binaryPath: fake.binaryPath, argsPrefix: fake.prefix, env: { FAKE_SD_BODY: bodyFile } });
    await sdServer.generate("req-body", {
      prompt: "x",
      initImage: "data:image/png;base64,AAAA",
      strength: 0.4,
      lora: [{ path: "style.safetensors", multiplier: 0.8 }],
      hires: true,
    });
    const body = JSON.parse(fs.readFileSync(bodyFile, "utf8"));
    expect(body.init_image).toBe("data:image/png;base64,AAAA");
    expect(body.strength).toBe(0.4);
    expect(body.lora).toEqual([{ path: "style.safetensors", multiplier: 0.8, is_high_noise: false }]);
    expect(body.hires.enabled).toBe(true);
    expect(body.prompt).toBe("x");
    expect(body.prompt).not.toMatch(/<lora:/);
  });
});

describe("request limits", () => {
  it("rounds sizes to multiples of 64 inside the engine's limits", () => {
    const out = sdServer.clampRequest({ prompt: "x", width: 5000, height: 10 }, { min_width: 64, max_width: 1024, min_height: 64, max_height: 1024 });
    expect(out.width).toBe(1024);
    expect(out.height).toBe(64);
  });

  it("refuses an empty prompt and caps steps and prompt length", () => {
    expect(() => sdServer.clampRequest({ prompt: "  " })).toThrow();
    const out = sdServer.clampRequest({ prompt: "y".repeat(10_000), steps: 9999 });
    expect(out.prompt.length).toBe(4000);
    expect(out.steps).toBe(150);
  });

  it("uses the model's defaults when the request leaves them out", () => {
    const out = sdServer.clampRequest({ prompt: "x" }, undefined, { width: 1024, height: 768, steps: 8, cfgScale: 1 });
    expect([out.width, out.height, out.steps, out.cfgScale]).toEqual([1024, 768, 8, 1]);
  });

  it("scales a size the chat model picked down to the image model's own, keeping its shape", () => {
    const sd15 = { width: 512, height: 512, steps: 20, cfgScale: 7, maxSide: 768 };
    const picked = sdServer.clampRequest({ prompt: "x", width: 1024, height: 1024, fitModel: true }, undefined, sd15);
    expect([picked.width, picked.height]).toEqual([768, 768]);
    const wide = sdServer.clampRequest({ prompt: "x", width: 1920, height: 1080, fitModel: true }, undefined, sd15);
    expect([wide.width, wide.height]).toEqual([768, 384]);
    const asked = sdServer.clampRequest({ prompt: "x", width: 1024, height: 1024 }, undefined, sd15);
    expect([asked.width, asked.height]).toEqual([1024, 1024]);
  });
});

describe("memory plan", () => {
  it("runs on the GPU when free VRAM covers the model", () => {
    expect(sdServer.planMemory({ needGB: 2.5, freeVramGB: 4, freeRamGB: 8 })).toBe("gpu");
  });

  it("offloads to RAM when the GPU is short and there is no chat model to stop", () => {
    expect(sdServer.planMemory({ needGB: 2.5, freeVramGB: 1, freeRamGB: 8 })).toBe("offload");
  });

  it("stops the chat model first when that alone makes room", () => {
    expect(sdServer.planMemory({ needGB: 2, freeVramGB: 1.2, loadedLlmGB: 5.6, freeRamGB: 16 })).toBe("unload-chat");
    expect(sdServer.planMemory({ needGB: 6, freeVramGB: 0.2, loadedLlmGB: 2, freeRamGB: 16 })).toBe("unload-chat");
    expect(sdServer.planMemory({ needGB: 6, freeVramGB: 0.2, loadedLlmGB: 0, freeRamGB: 16 })).toBe("offload");
  });

  it("fails when neither is enough", () => {
    expect(sdServer.planMemory({ needGB: 6, freeVramGB: 1, freeRamGB: 2 })).toBe("fail");
  });

  it("does not fail when total computer memory is sufficient even if free RAM is below requirement", () => {
    expect(sdServer.planMemory({ needGB: 9.5, freeVramGB: 2, loadedLlmGB: 0, freeRamGB: 6, totalRamGB: 32, totalVramGB: 8 })).toBe("offload");
  });

  it("fails only when total computer memory is insufficient", () => {
    expect(sdServer.planMemory({ needGB: 12, freeVramGB: 1, loadedLlmGB: 0, freeRamGB: 2, totalRamGB: 4, totalVramGB: 2 })).toBe("fail");
  });

  it("estimates free VRAM from the total and the loaded chat model when it cannot be measured", () => {
    expect(sdServer.planMemory({ needGB: 2.5, freeVramGB: null, totalVramGB: 12, loadedLlmGB: 9, freeRamGB: 1 })).toBe("gpu");
    expect(sdServer.planMemory({ needGB: 2.5, freeVramGB: null, totalVramGB: 12, loadedLlmGB: 10, freeRamGB: 8 })).toBe("unload-chat");
  });

  it("leaves an unknown GPU to the engine's own fitting", () => {
    expect(sdServer.planMemory({ needGB: 2.5, freeVramGB: null, totalVramGB: 0, freeRamGB: 0 })).toBe("gpu");
  });

  it("checks RAM alone on the CPU runner and on unified memory", () => {
    expect(sdServer.planMemory({ needGB: 3, runner: "cpu", freeRamGB: 2 })).toBe("fail");
    expect(sdServer.planMemory({ needGB: 3, unified: true, freeRamGB: 8 })).toBe("gpu");
  });
});
