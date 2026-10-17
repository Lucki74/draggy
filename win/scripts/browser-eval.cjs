// Scripted run of the agent's browser tools against a local fixture site, in a real (hidden) Electron
// page. Dev only; not packaged and not part of `npm test`, which has no Electron.
// Usage: EVAL_OUT=../scratch/eval.log npx electron scripts/browser-eval.cjs
const fs = require("node:fs");
const http = require("node:http");
const { app, BrowserWindow } = require("electron");
const { createObserver, formatSnapshot } = require("../electron/browserSnapshot.cjs");
const { createInput } = require("../electron/browserInput.cjs");
const { createDialogs } = require("../electron/browserDialogs.cjs");
const { createTrace } = require("../electron/browserTrace.cjs");

const FRAME = `<button id="inner">Inside frame</button>`;
const PAGE = `<!doctype html><meta charset="utf-8"><title>Eval fixture</title>
<style>body{font:16px sans-serif;margin:16px} #feed div{height:60px}</style>
<h1>Fixture</h1>
<form onsubmit="return false">
  <label>Name <input id="name" /></label>
  <label>Controlled <input id="controlled" /></label>
  <label>Password <input id="pw" type="password" /></label>
  <label>Colour <select id="colour"><option value="r">Red</option><option value="b">Blue</option></select></label>
</form>
<button id="count" onclick="this.dataset.n=(+this.dataset.n||0)+1">Count</button>
<button id="alert" onclick="alert('hello')">Alert</button>
<iframe id="frame" srcdoc='${FRAME}' width="200" height="40"></iframe>
<div id="host"></div>
<canvas id="cv" width="120" height="60"></canvas>
<div id="feed"></div>
<script>
  // A controlled input: its value is held in state and rewritten after every event, so assigning
  // .value without an input event is lost.
  let state = "";
  const c = document.getElementById("controlled");
  c.addEventListener("input", () => { state = c.value; });
  setInterval(() => { c.value = state; }, 20);
  const root = document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = '<button id="deep">Shadow button</button>';
  const cx = document.getElementById("cv").getContext("2d"); cx.fillStyle = "#c33"; cx.fillRect(0, 0, 120, 60);
  const feed = document.getElementById("feed");
  const more = () => { for (let i = 0; i < 20; i++) feed.append(document.createElement("div")); };
  more();
  // Polled, because a hidden window does not fire scroll events until it paints.
  setInterval(() => { if (innerHeight + scrollY > document.body.scrollHeight - 100) more(); }, 30);
  console.log("fixture ready");
  fetch("/missing").catch(() => {});
</script>`;

// An Electron app on Windows has no console to print to, so results also go to a file.
const OUT = process.env.EVAL_OUT || "browser-eval.log";
fs.writeFileSync(OUT, "");
const say = (line) => {
  console.log(line);
  fs.appendFileSync(OUT, `${line}
`);
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  say(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(PAGE);
    } else {
      res.statusCode = 404;
      res.end("no");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  const contents = win.webContents;
  await contents.loadURL("about:blank");
  const dbg = contents.debugger;
  dbg.attach("1.3");
  const send = (method, params) => dbg.sendCommand(method, params);
  const trace = createTrace();
  const dialogs = createDialogs({ send, onError: () => {} });
  dbg.on("message", (_e, method, params) => {
    dialogs.handle(method, params);
    trace.handle(method, params);
  });
  for (const domain of ["Page", "Runtime", "Network"]) await send(`${domain}.enable`, {});

  const observer = createObserver({ send });
  const input = createInput({ send, observer, contents, pause: sleep });
  await contents.loadURL(url);
  await sleep(300);

  const snap = await observer.snapshot({});
  const text = formatSnapshot({ ...snap, title: "Eval fixture", url });
  const refOf = (pattern) => text.split("\n").find((line) => pattern.test(line))?.match(/\be\d+\b/)?.[0];
  const rowFor = (pattern) => {
    const ref = refOf(pattern);
    return ref;
  };

  check("snapshot lists form controls", /textbox/.test(text) && /combobox|select/i.test(text), text.slice(0, 200));
  check("snapshot reaches into an iframe", /Inside frame/.test(text));
  check("snapshot reaches into shadow DOM", /Shadow button/.test(text));

  const name = rowFor(/Name/);
  await input.typeInto(name, "Ada", { clear: true });
  check("types into a plain field", (await send("Runtime.evaluate", { expression: "document.getElementById('name').value", returnByValue: true })).result.value === "Ada");

  const controlled = rowFor(/Controlled/);
  await input.typeInto(controlled, "kept", { clear: true });
  await sleep(100);
  check("typing survives a controlled input", (await send("Runtime.evaluate", { expression: "document.getElementById('controlled').value", returnByValue: true })).result.value === "kept");

  let refused = null;
  try {
    await input.typeInto(rowFor(/Password/), "x", {});
  } catch (e) {
    refused = e.code;
  }
  check("refuses a password field", refused === "needs_user", String(refused));

  await input.selectOption(rowFor(/Colour/), { label: "Blue" });
  check("picks a dropdown option", (await send("Runtime.evaluate", { expression: "document.getElementById('colour').value", returnByValue: true })).result.value === "b");

  const count = rowFor(/Count/);
  const at = await observer.pointOf(count);
  await input.clickAt(at.x, at.y, {});
  await sleep(100);
  check("clicks with real input", (await send("Runtime.evaluate", { expression: "document.getElementById('count').dataset.n", returnByValue: true })).result.value === "1");

  const alertPoint = await observer.pointOf(rowFor(/Alert/));
  const opened = dialogs.opened();
  input.clickAt(alertPoint.x, alertPoint.y, {}).catch(() => {});
  const dialog = await Promise.race([opened, sleep(3000).then(() => null)]);
  check("sees an alert and answers it", Boolean(dialog) && dialog.message === "hello" && (await dialogs.answer({ accept: true })).type === "alert", JSON.stringify(dialog));

  const before = (await send("Runtime.evaluate", { expression: "document.getElementById('feed').children.length", returnByValue: true })).result.value;
  await input.scroll({ to: "bottom" });
  await sleep(200);
  const after = (await send("Runtime.evaluate", { expression: "document.getElementById('feed').children.length", returnByValue: true })).result.value;
  check("infinite scroll loads more", after > before, `${before} -> ${after}`);

  const shot = await contents.capturePage();
  check("canvas page can be captured", shot.getSize().width > 0);

  check("console is captured", trace.console().some((l) => /fixture ready/.test(l.text)));
  check("failed request is captured", trace.network(50, true).some((r) => /missing/.test(r.url) && r.status === 404));

  server.close();
  win.destroy();
  const failed = results.filter((r) => !r.ok).length;
  say(`\n${results.length - failed}/${results.length} passed`);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(main).catch((e) => {
  say(`ERROR ${e && e.stack}`);
  app.exit(1);
});
