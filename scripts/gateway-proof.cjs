// Proves, on the Electron this repo ships, what the draggy-ai:// gateway depends on. Dev only.
// Usage: electron scripts/gateway-proof.cjs [--llama <llama-server.exe> <model.gguf>]; exits 1 on a failure.
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, protocol } = require("electron");
const platform = require(path.join(__dirname, "..", "electron", "platform.cjs"));

protocol.registerSchemesAsPrivileged([
  {
    scheme: "draggy-ai",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  // Stands in for the app's own origin, which differs from draggy-ai:// just as app:// does.
  { scheme: "proofpage", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`[proof] ${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An endless SSE stream that notes when its client goes away. */
function mockUpstream() {
  const state = { closedAt: null, requests: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const timer = setInterval(() => res.write(`data: {"choices":[{"delta":{"content":"x"}}]}\n\n`), 30);
    req.on("close", () => {
      clearInterval(timer);
      state.closedAt = Date.now();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}

let upstreamUrl = "";
const handlerNotes = { hasSignal: null, signalAborted: false, bodyCancelled: false };

/** The prototype: proxies to one upstream, and aborts it when the response body is cancelled. */
async function gateway(request) {
  const origin = request.headers.get("origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  handlerNotes.hasSignal = Boolean(request.signal);
  request.signal?.addEventListener("abort", () => (handlerNotes.signalAborted = true));
  const controller = new AbortController();
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      signal: controller.signal,
    });
  } catch {
    // The engine is not there: the renderer must see a network failure, as it does today.
    return Response.error();
  }
  const reader = upstream.body.getReader();
  const body = new ReadableStream({
    async pull(stream) {
      try {
        const { done, value } = await reader.read();
        if (done) stream.close();
        else stream.enqueue(value);
      } catch (error) {
        stream.error(error);
      }
    },
    cancel() {
      handlerNotes.bodyCancelled = true;
      controller.abort();
    },
  });
  return new Response(body, { status: upstream.status, headers: { ...cors, "Content-Type": "text/event-stream" } });
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>proof</title><script>
window.streamThenAbort = async (body) => {
  const controller = new AbortController();
  const res = await fetch("draggy-ai://chat", { method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal });
  const reader = res.body.getReader();
  let chunks = 0;
  while (chunks < 3) { const { done } = await reader.read(); if (done) break; chunks++; }
  controller.abort();
  return { status: res.status, chunks, abortedAt: Date.now() };
};
window.fetchUnreachable = async () => {
  try {
    await fetch("draggy-ai://chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { rejected: false };
  } catch (error) {
    return { rejected: true, name: error.name, isTypeError: error instanceof TypeError, message: String(error.message) };
  }
};
</script>`;

async function waitFor(check, ms) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (check()) return true;
    await sleep(20);
  }
  return false;
}

async function llamaCheck(win, binary, model) {
  const port = 11499;
  const child = platform.spawnHidden(binary, ["-m", model, "--port", String(port), "--host", "127.0.0.1", "-c", "2048", "--parallel", "1", "-ngl", "0"], {
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const up = await waitFor(() => false, 0) || (await (async () => {
      for (let i = 0; i < 300; i++) {
        try {
          if ((await fetch(`${base}/health`)).ok) return true;
        } catch {
          /* not up yet */
        }
        await sleep(200);
      }
      return false;
    })());
    if (!up) return record("llama-server stops when the renderer aborts", false, "the engine never became healthy");

    upstreamUrl = `${base}/v1/chat/completions`;
    const request = JSON.stringify({
      stream: true,
      max_tokens: 4000,
      messages: [{ role: "user", content: "Count from one to four thousand in words, one per line." }],
    });
    const outcome = await win.webContents.executeJavaScript(`streamThenAbort(${JSON.stringify(request)})`);
    // With the slot freed, a second request is served at once instead of waiting behind the first.
    await sleep(300);
    const slots = await (await fetch(`${base}/slots`)).json().catch(() => null);
    const busy = Array.isArray(slots) ? slots.some((slot) => slot.is_processing) : null;
    record(
      "llama-server stops when the renderer aborts",
      outcome.chunks === 3 && busy === false,
      `chunks read ${outcome.chunks}, slot still processing 300 ms after abort: ${busy}`,
    );
  } finally {
    // Synchronous, or the quit that follows leaves the engine running.
    platform.killTreeSync(child);
  }
}

app.whenReady().then(async () => {
  const mock = await mockUpstream();
  upstreamUrl = `http://127.0.0.1:${mock.port}/v1/chat/completions`;
  protocol.handle("draggy-ai", gateway);
  protocol.handle("proofpage", () => new Response(PAGE, { headers: { "Content-Type": "text/html" } }));

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL("proofpage://app/index.html");

  // 1. Abort reaches the upstream request.
  const outcome = await win.webContents.executeJavaScript(`streamThenAbort("{}")`);
  const closed = await waitFor(() => mock.state.closedAt !== null, 3000);
  record(
    "aborting the renderer's fetch closes the upstream request",
    outcome.status === 200 && outcome.chunks === 3 && closed,
    closed ? `upstream closed ${mock.state.closedAt - outcome.abortedAt} ms after abort` : "upstream still open after 3 s",
  );
  record(
    "how the abort arrives",
    true,
    `request.signal present: ${handlerNotes.hasSignal}, signal aborted: ${handlerNotes.signalAborted}, body cancelled: ${handlerNotes.bodyCancelled}`,
  );
  record("CORS preflight from another origin passes", outcome.status === 200, `status ${outcome.status}`);

  // 2. An engine that is not running fails the fetch as a network error.
  mock.server.close();
  upstreamUrl = "http://127.0.0.1:9/v1/chat/completions";
  const unreachable = await win.webContents.executeJavaScript("fetchUnreachable()");
  record(
    "Response.error() reaches the renderer as a TypeError",
    unreachable.rejected && unreachable.isTypeError,
    JSON.stringify(unreachable),
  );

  // 3. The real engine, when one is given.
  const at = process.argv.indexOf("--llama");
  if (at !== -1) await llamaCheck(win, process.argv[at + 1], process.argv[at + 2]);

  console.log(`[proof] electron ${process.versions.electron}: ${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
  app.quit();
});
