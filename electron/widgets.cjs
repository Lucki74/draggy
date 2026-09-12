const crypto = require("node:crypto");

/**
 * MCP Apps: a tool that answers with a small interface instead of a line of
 * text. The markup is written by whoever wrote the server, so Draggy treats it
 * the way it treats a web page rather than the way it treats its own code.
 *
 * The isolation is an origin, not a sandbox flag. A frame sandboxed into an
 * opaque origin inherits the embedder's content policy, which would leave the
 * widget unable to run its own script in a packaged build while giving it the
 * app's policy in exchange. So each widget is served from widget://<token>/,
 * an origin of its own that shares nothing with the app, under a policy of its
 * own that forbids it from reaching the network at all.
 */

/** How much markup a widget may be before it is treated as a mistake. */
const MAX_WIDGET_CHARS = 256 * 1024;

/** How many widgets stay reachable at once. Oldest goes when the room runs out. */
const MAX_STAGED = 32;

/**
 * The policy a widget document is served under. `default-src 'none'` is the
 * important line: no fetch, no socket, no image from a tracker, nothing that
 * could carry what the widget was shown out of the machine.
 */
const WIDGET_BODY_POLICY =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob:; " +
  "font-src data:; " +
  "form-action 'none'; " +
  "base-uri 'none'";

/**
 * The header adds the one rule a meta tag cannot carry: only Draggy itself may
 * put a widget in a frame. The rest is repeated in the document so the policy
 * still holds if the response is ever read some other way.
 */
const WIDGET_POLICY =
  `${WIDGET_BODY_POLICY}; frame-ancestors app: draggy: http://127.0.0.1:5173`;

/** The document a widget is put inside, with its own script to report height. */
function wrapWidget(html) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${WIDGET_BODY_POLICY}">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 12px; font: 14px system-ui, sans-serif; }
</style>
</head>
<body>
${String(html || "")}
<script>
  // Tells the app how much room this needs, so the frame is the widget's own
  // size rather than a guess.
  var report = function () {
    parent.postMessage(
      { type: "resize", height: document.documentElement.scrollHeight },
      "*",
    );
  };
  new ResizeObserver(report).observe(document.documentElement);
  report();
</script>
</body>
</html>`;
}

/** token -> the document served at widget://token/ */
const staged = new Map();

/**
 * Puts a widget somewhere the frame can load it from and returns its address.
 * The token is the host, so two widgets never share an origin and therefore
 * never share storage either.
 */
function stage(html) {
  const markup = String(html || "");

  if (!markup.trim()) return null;
  if (markup.length > MAX_WIDGET_CHARS) return null;

  const token = crypto.randomBytes(16).toString("hex");
  staged.set(token, wrapWidget(markup));

  while (staged.size > MAX_STAGED) {
    const oldest = staged.keys().next().value;
    staged.delete(oldest);
  }

  return { token, url: `widget://${token}/` };
}

/** Forgets a widget, so a reply scrolled out of sight stops being reachable. */
function release(token) {
  return staged.delete(String(token || ""));
}

function forgetAll() {
  staged.clear();
}

/** The host of a widget url, or null if that is not what this is. */
function tokenFromUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "widget:") return null;
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

/** Serves a staged widget, and nothing else: there is no path to traverse. */
function serve(request) {
  const token = tokenFromUrl(request?.url);
  const document = token ? staged.get(token) : null;

  if (!document) {
    return new Response("No such widget", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(document, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": WIDGET_POLICY,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

module.exports = {
  MAX_WIDGET_CHARS,
  WIDGET_BODY_POLICY,
  MAX_STAGED,
  WIDGET_POLICY,
  wrapWidget,
  stage,
  release,
  forgetAll,
  tokenFromUrl,
  serve,
};
