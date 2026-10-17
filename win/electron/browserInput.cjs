const { log } = require("./logger.cjs");
const { RefError } = require("./browserSnapshot.cjs");
const { sensitiveField } = require("./browserSafety.cjs");

/** Real input for the pane: keys, typing, clicks with options, hover, drag and scroll. Like the observer
 * it talks through `send(method, params)` for the page and `contents.sendInputEvent` for pointer and
 * keys, so it can be tested without Electron. Typed text and field values are never logged. */

const NAMED_KEYS = {
  enter: "Return",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  space: " ",
  insert: "Insert",
  up: "Up",
  arrowup: "Up",
  down: "Down",
  arrowdown: "Down",
  left: "Left",
  arrowleft: "Left",
  right: "Right",
  arrowright: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

const MODIFIERS = {
  control: "control",
  ctrl: "control",
  shift: "shift",
  alt: "alt",
  option: "alt",
  meta: "meta",
  cmd: "meta",
  command: "meta",
};

const BUTTONS = new Set(["left", "right", "middle"]);
const MAX_REPEAT = 20;
const MAX_CLICKS = 3;
const MAX_TYPED = 5000;
const POLL_MS = 250;
const DEFAULT_WAIT_MS = 10000;
const MAX_WAIT_MS = 15000;
const MAX_PAUSE_MS = 10000;
const DRAG_STEPS = 8;

const invalid = (message) => new RefError("invalid_input", message);

function modifiersOf(list = []) {
  return list.map((name) => {
    const known = MODIFIERS[String(name).toLowerCase()];
    if (!known) throw invalid(`"${name}" is not a modifier key.`);
    return known;
  });
}

/** `"Control+A"` becomes the key and the modifiers held with it. */
function parseKey(spec) {
  const text = String(spec ?? "").trim();
  if (!text) throw new RefError("invalid_key", "No key was given.");
  const parts = text.length > 1 && text.endsWith("+") ? [...text.slice(0, -2).split("+"), "+"] : text.split("+");
  const keyPart = parts.pop().trim();
  const modifiers = parts.filter(Boolean).map((name) => {
    const known = MODIFIERS[name.trim().toLowerCase()];
    if (!known) throw new RefError("invalid_key", `"${name}" is not a modifier key.`);
    return known;
  });
  const lower = keyPart.toLowerCase();
  if (NAMED_KEYS[lower]) return { keyCode: NAMED_KEYS[lower], modifiers, char: lower === "space" ? " " : null };
  if (/^f([1-9]|1[0-2])$/.test(lower)) return { keyCode: lower.toUpperCase(), modifiers, char: null };
  if ([...keyPart].length === 1) return { keyCode: keyPart, modifiers, char: keyPart };
  throw new RefError("invalid_key", `"${keyPart}" is not a key Draggy knows.`);
}

/** What a page looks like from outside: enough to tell whether an action did anything. */
const SIGNATURE_EXPRESSION = `({
  url: location.href,
  title: document.title || '',
  nodes: document.getElementsByTagName('*').length,
  text: document.body ? document.body.innerText.length : 0,
})`;

function summarizeChange(before, after) {
  if (!before || !after) return "";
  if (before.url !== after.url) return `The page navigated to ${after.url}.`;
  if (before.title !== after.title || before.nodes !== after.nodes || before.text !== after.text) {
    return "The page changed in place. Call browser_snapshot to see what is new.";
  }
  return "Nothing visibly changed on the page.";
}

const EDITABLE_FN = `function() {
  const tag = this.tagName;
  const kinds = ['checkbox', 'radio', 'button', 'submit', 'file', 'image', 'reset', 'range', 'color'];
  const field = tag === 'TEXTAREA' || (tag === 'INPUT' && !kinds.includes(this.type));
  return Boolean((field || this.isContentEditable) && !this.disabled && !this.readOnly);
}`;

const SELECT_ALL_FN = `function() {
  if (typeof this.select === 'function') { this.select(); return true; }
  const range = document.createRange();
  range.selectNodeContents(this);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}`;

/** What the page says about a field, enough to tell whether it takes a password or a card number. */
const ATTRS_FN = `function() {
  const label = this.labels && this.labels[0] ? this.labels[0].textContent : this.getAttribute("aria-label");
  return {
    type: this.type || "",
    autocomplete: this.getAttribute("autocomplete") || "",
    name: this.name || "",
    id: this.id || "",
    placeholder: this.placeholder || "",
    label: label || "",
  };
}`;

const READ_BACK_FN = `function() {
  if (this.type === 'password') return { hidden: true };
  return { value: this.value !== undefined ? this.value : (this.innerText || '') };
}`;

const CHOOSE_FN = `function(want) {
  if (this.tagName !== 'SELECT') return { notSelect: true };
  const options = Array.from(this.options);
  const index = options.findIndex((o) => (want.value !== undefined && o.value === want.value) || (want.label !== undefined && o.text.trim() === want.label));
  if (index < 0) return { missing: true, options: options.map((o) => o.text.trim()).slice(0, 30) };
  this.selectedIndex = index;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { chosen: options[index].text.trim(), value: options[index].value };
}`;

const CONTAINS_FN = `function(other) { return this === other || this.contains(other) || other.contains(this); }`;

function createInput({ send, observer, contents, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const evalValue = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true });
    return r.result ? r.result.value : undefined;
  };

  async function objectOf(entry) {
    const { object } = await send("DOM.resolveNode", { backendNodeId: entry.backendNodeId });
    return object.objectId;
  }

  const callOn = async (objectId, functionDeclaration, args = []) => {
    const r = await send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    return r.result ? r.result.value : undefined;
  };

  /** A ref, or a point in the last screenshot. */
  async function where(target) {
    if (typeof target === "string" && /^e\d+$/.test(target)) return observer.pointOf(target);
    if (target && typeof target === "object" && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      return observer.shotPoint(target.x, target.y);
    }
    throw invalid("Give a ref from browser_snapshot, or x and y from the last screenshot.");
  }

  async function pressKey(spec, repeat = 1, stopped = () => false) {
    const key = parseKey(spec);
    const times = Math.min(Math.max(Math.floor(Number(repeat)) || 1, 1), MAX_REPEAT);
    const mods = key.modifiers.length ? { modifiers: key.modifiers } : {};
    // A chord with control or meta is a command, not text, so no character is typed for it.
    const types = key.char && !key.modifiers.some((m) => m === "control" || m === "meta");
    for (let i = 0; i < times; i += 1) {
      if (stopped()) return;
      contents.sendInputEvent({ type: "keyDown", keyCode: key.keyCode, ...mods });
      if (types) contents.sendInputEvent({ type: "char", keyCode: key.char, ...mods });
      await pause(40);
      contents.sendInputEvent({ type: "keyUp", keyCode: key.keyCode, ...mods });
      await pause(40);
    }
  }

  async function typeInto(ref, text, { clear = false, submit = false, slowly = false } = {}, stopped = () => false) {
    const entry = await observer.resolve(ref);
    const objectId = await objectOf(entry);
    if (!(await callOn(objectId, EDITABLE_FN))) throw new RefError("not_editable", "That element is not a text field.");
    const sensitive = sensitiveField(await callOn(objectId, ATTRS_FN));
    if (sensitive) {
      throw new RefError("needs_user", `That is ${sensitive}. Ask the user to fill it in themselves in the browser pane.`);
    }
    await send("DOM.scrollIntoViewIfNeeded", { backendNodeId: entry.backendNodeId }).catch((e) =>
      log.swallow("window.browser.control.input", "scroll into view failed", e),
    );
    await send("DOM.focus", { backendNodeId: entry.backendNodeId });
    if (clear) {
      await callOn(objectId, SELECT_ALL_FN);
      await pressKey("Backspace");
    }
    const body = String(text ?? "").slice(0, MAX_TYPED);
    if (slowly) {
      for (const ch of body) {
        if (stopped()) break;
        await send("Input.insertText", { text: ch });
        await pause(40);
      }
    } else if (body) {
      await send("Input.insertText", { text: body });
    }
    if (submit && !stopped()) await pressKey("Enter");
    const read = (await callOn(objectId, READ_BACK_FN)) || {};
    if (read.hidden) return { value: "(hidden)", landed: true };
    const value = String(read.value ?? "");
    return { value: value.slice(0, 200), landed: clear ? value === body : value.includes(body) };
  }

  /** Null when the click would land on the target, otherwise what would take it. */
  async function blockedBy(ref, x, y) {
    let hit;
    try {
      ({ backendNodeId: hit } = await send("DOM.getNodeForLocation", { x, y }));
    } catch (e) {
      log.swallow("window.browser.control.input", "hit test unavailable", e);
      return null;
    }
    const entry = await observer.resolve(ref);
    if (!hit || hit === entry.backendNodeId) return null;
    const [target, other] = await Promise.all([objectOf(entry), objectOf({ backendNodeId: hit })]);
    const r = await send("Runtime.callFunctionOn", {
      objectId: target,
      functionDeclaration: CONTAINS_FN,
      arguments: [{ objectId: other }],
      returnByValue: true,
    });
    if (r.result && r.result.value) return null;
    const { node } = await send("DOM.describeNode", { backendNodeId: hit });
    const attrs = node.attributes || [];
    const pick = (name) => {
      const at = attrs.indexOf(name);
      return at >= 0 ? ` ${name}="${String(attrs[at + 1]).slice(0, 60)}"` : "";
    };
    return `A <${String(node.nodeName).toLowerCase()}${pick("id")}${pick("class")}> would receive the click instead.`;
  }

  async function clickAt(x, y, { button = "left", count = 1, modifiers = [] } = {}, stopped = () => false) {
    if (!BUTTONS.has(button)) throw invalid(`"${button}" is not a mouse button.`);
    const mods = modifiersOf(modifiers);
    const extra = mods.length ? { modifiers: mods } : {};
    const clicks = Math.min(Math.max(Math.floor(Number(count)) || 1, 1), MAX_CLICKS);
    contents.sendInputEvent({ type: "mouseMove", x, y });
    await pause(50);
    for (let i = 1; i <= clicks; i += 1) {
      if (stopped()) return;
      contents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: i, ...extra });
      await pause(50);
      contents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: i, ...extra });
      await pause(50);
    }
  }

  async function hover(target) {
    const { x, y } = await where(target);
    contents.sendInputEvent({ type: "mouseMove", x, y });
    await pause(150);
    return { x, y };
  }

  async function drag(from, to, stopped = () => false) {
    const a = await where(from);
    const b = await where(to);
    contents.sendInputEvent({ type: "mouseMove", x: a.x, y: a.y });
    await pause(60);
    contents.sendInputEvent({ type: "mouseDown", x: a.x, y: a.y, button: "left", clickCount: 1 });
    for (let i = 1; i <= DRAG_STEPS; i += 1) {
      if (stopped()) break;
      await pause(30);
      contents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(a.x + ((b.x - a.x) * i) / DRAG_STEPS),
        y: Math.round(a.y + ((b.y - a.y) * i) / DRAG_STEPS),
        button: "left",
      });
    }
    await pause(60);
    contents.sendInputEvent({ type: "mouseUp", x: b.x, y: b.y, button: "left", clickCount: 1 });
  }

  const POSITION = "({ y: Math.round(scrollY), max: Math.max(0, Math.round(document.documentElement.scrollHeight - innerHeight)) })";

  async function scroll({ ref, dx = 0, dy = 0, to } = {}) {
    if (to) {
      if (to !== "top" && to !== "bottom") throw invalid('"to" is top or bottom.');
      await send("Runtime.evaluate", {
        expression: `window.scrollTo(0, ${to === "top" ? 0 : "document.documentElement.scrollHeight"})`,
      });
    } else if (ref) {
      await observer.pointOf(ref);
    } else if (Number(dx) || Number(dy)) {
      const [width, height] = await evalValue("[innerWidth, innerHeight]");
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.round(width / 2),
        y: Math.round(height / 2),
        deltaX: Number(dx) || 0,
        deltaY: Number(dy) || 0,
      });
    } else {
      throw invalid("Say where to scroll: a ref, dy or dx, or to top or bottom.");
    }
    await pause(150);
    return evalValue(POSITION);
  }

  async function selectOption(ref, { value, label } = {}) {
    if (value === undefined && label === undefined) throw invalid("Give the value or the label of the option.");
    const entry = await observer.resolve(ref);
    const result = (await callOn(await objectOf(entry), CHOOSE_FN, [{ value, label }])) || {};
    if (result.notSelect) throw new RefError("not_editable", "That element is not a dropdown. Click it instead.");
    if (result.missing) {
      throw new RefError("element_not_found", `No such option. The options are: ${result.options.join(", ")}.`);
    }
    return { chosen: result.chosen, value: result.value };
  }

  async function wait({ text, url, ms, timeoutMs = DEFAULT_WAIT_MS } = {}) {
    if (ms !== undefined) {
      const spent = Math.min(Math.max(Number(ms) || 0, 0), MAX_PAUSE_MS);
      await pause(spent);
      return { waited: true, ms: spent };
    }
    let expression;
    if (text) expression = `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(String(text))}))`;
    else if (url) expression = `location.href.includes(${JSON.stringify(String(url))})`;
    else throw invalid("Say what to wait for: text, url or ms.");
    const limit = Math.min(Math.max(Number(timeoutMs) || DEFAULT_WAIT_MS, POLL_MS), MAX_WAIT_MS);
    for (let spent = 0; spent <= limit; spent += POLL_MS) {
      if (await evalValue(expression)) return { waited: true, ms: spent };
      await pause(POLL_MS);
    }
    throw new RefError("wait_timeout", `Still not there after ${Math.round(limit / 1000)} seconds.`);
  }

  const signature = () => evalValue(SIGNATURE_EXPRESSION);

  return { where, pressKey, typeInto, blockedBy, clickAt, hover, drag, scroll, selectOption, wait, signature };
}

module.exports = { createInput, parseKey, summarizeChange };
