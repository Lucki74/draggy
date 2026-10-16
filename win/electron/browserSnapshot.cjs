/** What the agent sees of a page: the accessibility tree as a short list with refs, a screenshot,
 * and the box a ref sits in. It talks to the page through one `send(method, params)` function
 * so it can be tested without Electron. Nothing here writes to disk or the log beyond counts. */

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "treeitem",
  "listbox",
]);
const LANDMARK = new Set(["heading", "dialog", "alertdialog", "alert", "img"]);
const STATES = ["checked", "expanded", "disabled", "selected", "required", "pressed", "invalid"];
const DEFAULT_MAX_ITEMS = 80;
const HARD_MAX_ITEMS = 300;
const MAX_SHOT_WIDTH = 1280;
const MAX_SHOT_HEIGHT = 4000;

const property = (node, name) => {
  const found = (node.properties || []).find((p) => p.name === name);
  return found ? found.value && found.value.value : undefined;
};

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** A ref the model can read back, or null when the node is not worth listing. */
function describeNode(node) {
  if (node.ignored || !node.backendDOMNodeId) return null;
  const role = node.role && node.role.value;
  if (!INTERACTIVE.has(role) && !LANDMARK.has(role)) return null;
  const name = String((node.name && node.name.value) || "").replace(/\s+/g, " ").trim().slice(0, 100);
  // An unnamed picture or heading says nothing; an unnamed control still has a place on the page.
  if (!name && !INTERACTIVE.has(role)) return null;
  const item = { role, name, backendNodeId: node.backendDOMNodeId };
  const value = node.value && node.value.value;
  if (value !== undefined && value !== "") item.value = String(value).slice(0, 80);
  const states = {};
  for (const state of STATES) {
    const v = property(node, state);
    if (v === true || v === "true" || v === "mixed") states[state] = v === "mixed" ? "mixed" : true;
  }
  if (Object.keys(states).length) item.states = states;
  const level = property(node, "level");
  if (role === "heading" && level) item.level = level;
  const url = property(node, "url");
  if (role === "link" && url) item.host = hostOf(url);
  return item;
}

/** Collects the node ids under `rootId` (the root included), following ignored wrappers. */
function subtreeIds(nodes, rootId) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    for (const child of byId.get(id).childIds || []) walk(child);
  };
  walk(rootId);
  return seen;
}

/** The frames of the page in document order, main frame first. */
function framesOf(tree) {
  const out = [];
  const walk = (entry) => {
    out.push({ id: entry.frame.id, url: entry.frame.url || "" });
    for (const child of entry.childFrames || []) walk(child);
  };
  walk(tree.frameTree);
  return out;
}

/** One line per item. `offscreen` and `hidden` tell the model it has to scroll or look elsewhere. */
function formatItem(item) {
  let line = `[${item.ref}] ${item.role}`;
  if (item.level) line += ` L${item.level}`;
  if (item.name) line += ` "${item.name}"`;
  if (item.value !== undefined) line += ` value="${item.value}"`;
  if (item.host) line += ` -> ${item.host}`;
  const flags = Object.entries(item.states || {}).map(([k, v]) => (v === true ? k : `${k}=${v}`));
  if (item.visibility && item.visibility !== "visible") flags.push(item.visibility);
  if (flags.length) line += ` (${flags.join(", ")})`;
  return line;
}

function formatSnapshot(snapshot) {
  const lines = [`Page: ${snapshot.title} (${snapshot.url})`];
  let frame = null;
  for (const item of snapshot.items) {
    if (item.frame !== frame) {
      frame = item.frame;
      if (frame) lines.push(`-- frame ${frame} --`);
    }
    lines.push(formatItem(item));
  }
  if (snapshot.omitted > 0) {
    lines.push(`(${snapshot.omitted} more not shown. Pass scope with a ref, or a higher maxItems, to see them.)`);
  }
  if (snapshot.skippedFrames > 0) lines.push(`(${snapshot.skippedFrames} frame(s) could not be read.)`);
  if (snapshot.items.length === 0) lines.push("(nothing interactive found. The page may still be loading, or it is a canvas.)");
  return lines.join("\n");
}

class RefError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {{ send: (method: string, params?: object) => Promise<any> }} cdp
 */
function createObserver(cdp) {
  const send = (method, params) => cdp.send(method, params);
  let table = new Map();
  let counter = 0;

  /** Refs belong to one snapshot of one document. A navigation ends them. */
  function forget() {
    table = new Map();
  }

  async function boxOf(backendNodeId) {
    try {
      const { model } = await send("DOM.getBoxModel", { backendNodeId });
      const q = model.content;
      const xs = [q[0], q[2], q[4], q[6]];
      const ys = [q[1], q[3], q[5], q[7]];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    } catch {
      return null;
    }
  }

  async function viewport() {
    const m = await send("Page.getLayoutMetrics");
    const v = m.cssVisualViewport || m.visualViewport;
    let dpr = 1;
    try {
      const r = await send("Runtime.evaluate", { expression: "window.devicePixelRatio", returnByValue: true });
      if (r.result && r.result.value > 0) dpr = r.result.value;
    } catch {
      // Without the ratio the picture may be larger than needed, never wrong.
    }
    return { width: v.clientWidth, height: v.clientHeight, pageX: v.pageX, pageY: v.pageY, dpr, content: m.cssContentSize || m.contentSize };
  }

  const visibilityOf = (box, vp) => {
    if (!box || box.width <= 0 || box.height <= 0) return "hidden";
    const inside = box.x < vp.width && box.y < vp.height && box.x + box.width > 0 && box.y + box.height > 0;
    return inside ? "visible" : "offscreen";
  };

  /** @param {{ scope?: string, maxItems?: number }} options */
  async function snapshot({ scope, maxItems } = {}) {
    const limit = Math.min(Math.max(Number.parseInt(maxItems, 10) || DEFAULT_MAX_ITEMS, 1), HARD_MAX_ITEMS);
    const scoped = scope ? table.get(scope) : null;
    if (scope && !scoped) throw new RefError("stale_ref", "That ref is not in the current snapshot.");

    const frames = framesOf(await send("Page.getFrameTree"));
    const found = [];
    let skippedFrames = 0;
    for (const [i, frame] of frames.entries()) {
      if (scoped && frame.id !== scoped.frameId) continue;
      let nodes;
      try {
        ({ nodes } = await send("Accessibility.getFullAXTree", { frameId: frame.id }));
      } catch {
        skippedFrames += 1;
        continue;
      }
      let allowed = null;
      if (scoped) {
        const root = nodes.find((n) => n.backendDOMNodeId === scoped.backendNodeId);
        if (!root) throw new RefError("stale_ref", "The element behind that ref is gone.");
        allowed = subtreeIds(nodes, root.nodeId);
      }
      for (const node of nodes) {
        if (allowed && !allowed.has(node.nodeId)) continue;
        const item = describeNode(node);
        if (item) found.push({ ...item, frameId: frame.id, frame: i === 0 ? "" : hostOf(frame.url) || "embedded" });
      }
    }

    const vp = await viewport();
    const shown = found.slice(0, limit);
    const boxes = await Promise.all(shown.map((item) => boxOf(item.backendNodeId)));
    forget();
    const items = shown.map((item, i) => {
      counter += 1;
      const ref = `e${counter}`;
      const visibility = visibilityOf(boxes[i], vp);
      table.set(ref, { backendNodeId: item.backendNodeId, frameId: item.frameId, role: item.role });
      const { backendNodeId, frameId, ...rest } = item;
      return { ref, ...rest, visibility };
    });

    return {
      items,
      total: found.length,
      omitted: Math.max(found.length - items.length, 0),
      skippedFrames,
    };
  }

  /** Looks a ref up and proves its node still exists. */
  async function resolve(ref) {
    const entry = table.get(String(ref));
    if (!entry) throw new RefError("stale_ref", "That ref is not in the current snapshot.");
    try {
      await send("DOM.describeNode", { backendNodeId: entry.backendNodeId });
    } catch {
      table.delete(String(ref));
      throw new RefError("stale_ref", "The element behind that ref is gone.");
    }
    return entry;
  }

  /** Scrolls the node into view and returns where its middle is, in viewport pixels. */
  async function pointOf(ref) {
    const entry = await resolve(ref);
    try {
      await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: entry.backendNodeId });
    } catch {
      // A node with no box cannot be scrolled to; the box lookup below says so.
    }
    const box = await boxOf(entry.backendNodeId);
    if (!box || box.width <= 0 || box.height <= 0) throw new RefError("element_not_found", "That element has no visible box.");
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), box };
  }

  /** Text of one element, taken from the page itself without touching it. */
  async function textOf(ref) {
    const entry = await resolve(ref);
    const { object } = await send("DOM.resolveNode", { backendNodeId: entry.backendNodeId });
    const result = await send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function() { return (this.innerText || this.textContent || '').trim(); }",
      returnByValue: true,
    });
    return String((result.result && result.result.value) || "");
  }

  /** @param {{ mode?: "viewport"|"full"|"element", ref?: string, marks?: boolean }} options */
  async function screenshot({ mode = "viewport", ref } = {}) {
    const vp = await viewport();
    let clip;
    let capturesBeyond = false;
    if (mode === "element") {
      const entry = await resolve(ref);
      await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: entry.backendNodeId }).catch(() => {});
      const box = await boxOf(entry.backendNodeId);
      if (!box || box.width <= 0 || box.height <= 0) throw new RefError("element_not_found", "That element has no visible box.");
      const pad = 8;
      clip = {
        x: Math.max(box.x + vp.pageX - pad, 0),
        y: Math.max(box.y + vp.pageY - pad, 0),
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      };
      capturesBeyond = true;
    } else if (mode === "full") {
      clip = { x: 0, y: 0, width: vp.content.width, height: Math.min(vp.content.height, MAX_SHOT_HEIGHT) };
      capturesBeyond = true;
    } else {
      clip = { x: vp.pageX, y: vp.pageY, width: vp.width, height: vp.height };
    }
    // The capture scale multiplies the screen's pixel ratio, so divide it out: one pixel per css pixel at most.
    const pixels = Math.min(1, MAX_SHOT_WIDTH / clip.width);
    const { data } = await send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 60,
      clip: { ...clip, scale: pixels / vp.dpr },
      captureBeyondViewport: capturesBeyond,
    });
    return { data, width: Math.round(clip.width * pixels), height: Math.round(clip.height * pixels) };
  }

  /** Boxes for labelling interactive refs that are on screen right now. */
  async function marks(limit = 60) {
    const out = [];
    for (const [ref, entry] of table) {
      if (out.length >= limit) break;
      if (!INTERACTIVE.has(entry.role)) continue;
      const box = await boxOf(entry.backendNodeId);
      if (!box || box.width <= 0 || box.height <= 0) continue;
      const vp = await viewport();
      if (visibilityOf(box, vp) !== "visible") continue;
      out.push({ ref, ...box });
    }
    return out;
  }

  return { snapshot, resolve, pointOf, textOf, screenshot, marks, forget, refs: () => table.size };
}

/** Draws the ref labels in an isolated world, above the page, then takes itself away. */
const MARKS_ATTR = "data-draggy-marks";
const marksScript = (marks) => `
  (() => {
    document.querySelectorAll('[${MARKS_ATTR}]').forEach((el) => el.remove());
    const host = document.createElement('div');
    host.setAttribute('${MARKS_ATTR}', '');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const marks = ${JSON.stringify(marks)};
    for (const m of marks) {
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid #e11d48;left:' + m.x + 'px;top:' + m.y + 'px;width:' + m.width + 'px;height:' + m.height + 'px;';
      const tag = document.createElement('span');
      tag.textContent = m.ref;
      tag.style.cssText = 'position:absolute;left:-2px;top:-16px;background:#e11d48;color:#fff;font:700 11px/14px sans-serif;padding:0 3px;';
      box.appendChild(tag);
      root.appendChild(box);
    }
    (document.documentElement || document.body).appendChild(host);
    return marks.length;
  })();
`;
const hideMarksScript = () => `
  (() => {
    document.querySelectorAll('[${MARKS_ATTR}]').forEach((el) => el.remove());
    return true;
  })();
`;

module.exports = {
  createObserver,
  describeNode,
  formatSnapshot,
  formatItem,
  framesOf,
  marksScript,
  hideMarksScript,
  RefError,
  DEFAULT_MAX_ITEMS,
};
