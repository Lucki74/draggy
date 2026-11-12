// Scripted run of the agent's browser tools against a local fixture site, in the Tauri app's Browser pane.
// Dev only; not part of `npm test`. Launches the app over WebView2 CDP (tauri-app.cjs) and drives window.draggy.
// Usage: EVAL_OUT=../scratch/eval.log node scripts/browser-eval.cjs [--exe path/to/draggy-win.exe]
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { launch, sleep } = require("./tauri-app.cjs");

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
<p>Typed <span id="typed"></span> / echo <span id="echo"></span> / picked <span id="picked"></span></p>
<p>Clicks <span id="clicks">0</span> / rows <span id="fedn">0</span></p>
<button id="count" onclick="const s=document.getElementById('clicks'); s.textContent=+s.textContent+1">Count</button>
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
  c.addEventListener("input", () => { state = c.value; document.getElementById("echo").textContent = state; });
  setInterval(() => { c.value = state; }, 20);
  document.getElementById("name").addEventListener("input", (e) => { document.getElementById("typed").textContent = e.target.value; });
  document.getElementById("colour").addEventListener("change", (e) => { document.getElementById("picked").textContent = e.target.value; });
  const root = document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = '<button id="deep">Shadow button</button>';
  const cx = document.getElementById("cv").getContext("2d"); cx.fillStyle = "#c33"; cx.fillRect(0, 0, 120, 60);
  const feed = document.getElementById("feed");
  const more = () => { for (let i = 0; i < 20; i++) feed.append(document.createElement("div")); document.getElementById("fedn").textContent = feed.children.length; };
  more();
  // Polled, because a hidden window does not fire scroll events until it paints.
  setInterval(() => { if (innerHeight + scrollY > document.body.scrollHeight - 100) more(); }, 30);
  console.log("fixture ready");
  fetch("/missing").catch(() => {});
</script>`;

if (process.argv.includes("--help")) {
  console.log("usage: EVAL_OUT=file node scripts/browser-eval.cjs [--exe path/to/draggy-win.exe]");
  process.exit(0);
}
const exeArg = process.argv.indexOf("--exe");
const exe = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : undefined;

// The app has no console to print to, so results also go to a file.
const OUT = process.env.EVAL_OUT || "browser-eval.log";
fs.writeFileSync(OUT, "");
const say = (line) => {
  console.log(line);
  fs.appendFileSync(OUT, `${line}\n`);
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  say(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
};

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

  const app = await launch({ exe, prefix: "draggy-eval-" });
  // Every bridge call runs inside the app page and returns the BrowserResult as data.
  const call = (name, ...args) => app.page.evaluate(async ([fn, a]) => window.draggy[fn](...a), [name, args]);
  const text = async (selector) => {
    const res = await call("browserGetText", { selector });
    return res.ok ? res.text.trim() : `ERROR ${res.error?.code}`;
  };
  try {
    await call("browserNavigate", url);
    await sleep(300);

    const snap = await call("browserSnapshot", {});
    const tree = snap.text ?? "";
    const refOf = (pattern) => tree.split("\n").find((line) => pattern.test(line))?.match(/\be\d+\b/)?.[0];

    check("snapshot lists form controls", /textbox/.test(tree) && /combobox|select/i.test(tree), tree.slice(0, 200));
    check("snapshot reaches into an iframe", /Inside frame/.test(tree));
    check("snapshot reaches into shadow DOM", /Shadow button/.test(tree));

    const name = refOf(/Name/);
    await call("browserType", name, "Ada", { clear: true });
    check("types into a plain field", (await text("#typed")) === "Ada", await text("#typed"));

    await call("browserType", refOf(/Controlled/), "kept", { clear: true });
    await sleep(100);
    check("typing survives a controlled input", (await text("#echo")) === "kept", await text("#echo"));

    const refused = await call("browserType", refOf(/Password/), "x", {});
    check("refuses a password field", !refused.ok && refused.error?.code === "needs_user", JSON.stringify(refused.error ?? refused));

    await call("browserSelectOption", refOf(/Colour/), { label: "Blue" });
    check("picks a dropdown option", (await text("#picked")) === "b", await text("#picked"));

    await call("browserClick", refOf(/Count/), {});
    await sleep(100);
    check("clicks with real input", (await text("#clicks")) === "1", await text("#clicks"));

    // The alert blocks the page until answered, so the click is left pending while the dialog is answered.
    const pendingClick = call("browserClick", refOf(/Alert/), {}).catch(() => null);
    const dialog = await Promise.race([call("browserDialog", "accept"), sleep(3000).then(() => null)]);
    await Promise.race([pendingClick, sleep(3000)]);
    check("sees an alert and answers it", Boolean(dialog?.ok) && /hello/.test(JSON.stringify(dialog)), JSON.stringify(dialog));

    const before = Number(await text("#fedn"));
    await call("browserScroll", { to: "bottom" });
    await sleep(200);
    const after = Number(await text("#fedn"));
    check("infinite scroll loads more", after > before, `${before} -> ${after}`);

    const shot = await call("browserScreenshot", { mode: "viewport" });
    check("canvas page can be captured", Boolean(shot.ok) && shot.width > 0, JSON.stringify(shot.error ?? {}));

    const consoleLog = await call("browserTrace", "console", { limit: 50 });
    check("console is captured", consoleLog.ok && /fixture ready/.test(JSON.stringify(consoleLog.entries)));
    const failed = await call("browserTrace", "network", { limit: 50, onlyFailed: true });
    check("failed request is captured", failed.ok && /\/missing/.test(JSON.stringify(failed.entries)));
  } finally {
    await call("browserClose", {}).catch(() => {});
    await app.close();
    server.close();
  }

  const failedCount = results.filter((r) => !r.ok).length;
  say(`\n${results.length - failedCount}/${results.length} passed`);
  process.exitCode = failedCount ? 1 : 0;
}

main().catch((err) => {
  say(`ERROR ${err && err.stack}`);
  process.exitCode = 1;
});
