import type { ToolContext, ToolSpec } from "./registry";
import { registerTools } from "./registry";
import { logRendererEvent } from "../logger";
import type { BrowserResult } from "../types";

const api = () => window.electronAPI;

/** The failure line a browser tool hands the model: what happened and what to try next. */
const browserFailure = (result: BrowserResult<object> | undefined) =>
  result && !result.ok ? `${result.error.message} ${result.error.hint}` : "No answer from the browser.";

const webEnabled = (environment: { webMode: string }) => environment.webMode !== "off";

const PAGE_LINE_LIMIT = 500;

/** How many empty searches before searching is switched off for the turn. A model that gets one
 * empty answer rewords the same question indefinitely. */
const SEARCH_FAILURE_BUDGET = 3;

const SEARCH_MEMO = "search:asked";
const SEARCH_FAILURES = "search:failures";

function searchMemo(context: ToolContext): Map<string, string> {
  const existing = context.memo.get(SEARCH_MEMO) as Map<string, string> | undefined;
  if (existing) return existing;
  const fresh = new Map<string, string>();
  context.memo.set(SEARCH_MEMO, fresh);
  return fresh;
}

function normaliseQuery(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const searchWeb: ToolSpec = {
  name: "search_web",
  annotations: { readOnly: true, idempotent: true, openWorld: true },
  group: "web",
  description:
    "Search the web and return a list of results with titles, URLs and snippets.",
  parameters: { query: { type: "string", description: "The search query." } },
  required: ["query"],
  usage:
    '{"query": "your search query"} → a list of web results',
  available: webEnabled,
  run: async (args, ctx) => {
    const query = String(args.query);
    const asked = searchMemo(ctx);
    const key = normaliseQuery(query);

    const repeat = asked.get(key);
    if (repeat !== undefined) {
      return `TOOL RESULT (search_web): You already searched for "${query}" in this turn. Here is what it returned, unchanged:
${repeat}

Do not search for this again. Use what you have, or read one of the URLs.`;
    }

    const failures = (ctx.memo.get(SEARCH_FAILURES) as number) ?? 0;
    if (failures >= SEARCH_FAILURE_BUDGET) {
      return `TOOL RESULT (search_web): Web search is not answering right now, so it has been switched off for this reply. Do not call search_web again. Answer from your own knowledge and say plainly which parts you could not check.`;
    }

    const stepId = ctx.newId();
    ctx.pushStep({
      id: stepId,
      type: "searching",
      content: `${ctx.t("searchingFor")} **${query}**`,
      isComplete: false,
    });

    try {
      const outcome = await api()?.searchWebDetailed(query);

      if (!outcome) {
        ctx.patchStep(stepId, { isComplete: true, type: "error" });
        ctx.syncSteps();
        return `TOOL RESULT (search_web): Web search is unavailable in this build. Answer from your own knowledge.`;
      }

      const { results, status } = outcome;

      if (results.length === 0) {
        ctx.memo.set(SEARCH_FAILURES, failures + 1);
        ctx.patchStep(stepId, { isComplete: true, type: "error" });
        ctx.syncSteps();

        const remaining = SEARCH_FAILURE_BUDGET - failures - 1;

        // An engine that will not answer is an outage, not evidence that
        // nothing exists. Saying so stops the model inventing more queries.
        if (status === "unavailable") {
          return `TOOL RESULT (search_web): No search engine would answer just now (tried ${outcome.tried.join(", ") || "none"}). This is a temporary outage, not a sign that nothing exists on the subject.${remaining > 0 ? " Do not reword the question; if you retry at all, wait for a different question." : " Answer from your own knowledge and say which parts you could not check."}`;
        }

        return `TOOL RESULT (search_web): No results for "${query}".${remaining > 0 ? " Try one clearly different query, using fewer and more common words." : " Stop searching and answer from your own knowledge."}`;
      }

      // A hit clears the run of failures: the engines are evidently working.
      ctx.memo.set(SEARCH_FAILURES, 0);

      ctx.patchStep(stepId, {
        isComplete: true,
        content: `${ctx.t("searchedFor")} **${query}**`,
      });
      ctx.pushStep({
        id: ctx.newId(),
        type: "results",
        content: `${ctx.t("searchResultsFor")} **${query}**`,
        isComplete: true,
        results,
      });

      const summary = results
        .slice(0, 8)
        .map(
          (result, index) =>
            `[Result #${index + 1}] ${result.title}
URL: ${result.url}
Snippet: ${result.snippet}`,
        )
        .join("\n\n");

      asked.set(key, summary);

      return `TOOL RESULT (search_web):
${summary}

Read the most relevant URL(s) with read_url when you need the full text. If you already have enough to answer, stop calling tools and reply.`;
    } catch (error) {
      ctx.memo.set(SEARCH_FAILURES, failures + 1);
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      const reason = error instanceof Error ? error.message : String(error);
      logRendererEvent("renderer.tools", "ERROR", "search_web failed", {
        error: error instanceof Error ? error.name : "Error",
        message: reason,
        failures: failures + 1,
      }, ctx.correlationId);
      return `TOOL RESULT (search_web): The search could not be run (${reason}). Answer from your own knowledge.`;
    }
  },
};

const readUrl: ToolSpec = {
  name: "read_url",
  annotations: { readOnly: true, idempotent: true, openWorld: true },
  group: "web",
  description: "Read the readable text content of a web page.",
  parameters: {
    url: { type: "string", description: "Absolute URL of the page to read." },
  },
  required: ["url"],
  usage:
    '{"url": "https://example.com"} → the full text of a page',
  available: webEnabled,
  run: async (args, ctx) => {
    const url = String(args.url);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "opening",
      content: `${ctx.t("openingPage")} **${url}**`,
      isComplete: false,
    });

    try {
      const page = await api()?.readUrl(url);
      if (!page) throw new Error("No data");

      // An address the tools will not fetch. Saying so once, and why, is what
      // stops the model looking for a way around it.
      if (page.blocked === "refused") {
        ctx.patchStep(stepId, { isComplete: true, type: "error" });
        ctx.syncSteps();
        return `TOOL RESULT (read_url): ${page.reason || "That address cannot be opened."}`;
      }

      // A human-verification page is not worth retrying. Saying so once stops
      // the model trying the same URL five more ways.
      if (page.blocked === "human-verification") {
        ctx.patchStep(stepId, { isComplete: true, type: "error" });
        ctx.pushStep({
          id: ctx.newId(),
          type: "error",
          content: `${ctx.t("pageNeedsVerification")} ${url}`,
          isComplete: true,
        });
        ctx.syncSteps();

        return `TOOL RESULT (read_url): This page is behind a human-verification challenge (such as Cloudflare) and cannot be read automatically. Do not retry this URL or try to work around the check. Tell the user the page needs them to open it and pass the check themselves, and give them the link: ${url}`;
      }

      const lines = page.text.split("\n").filter((line) => line.trim().length > 0);
      const shown = Math.min(lines.length, PAGE_LINE_LIMIT);

      ctx.patchStep(stepId, {
        isComplete: true,
        content: `${ctx.t("openedPage")} **${url}**`,
      });
      ctx.pushStep({
        id: ctx.newId(),
        type: "reading",
        content: `**${page.title}** (${url}) (${ctx.t("lines")} 0-${shown} ${ctx.t("of")} ${lines.length})`,
        isComplete: true,
      });

      return `TOOL RESULT (read_url):\nTitle: ${page.title}\nContent:\n${lines.slice(0, shown).join("\n")}`;
    } catch (error) {
      // The message can echo the address, so only the error name is logged.
      logRendererEvent("renderer.tools", "ERROR", "read_url failed", {
        error: error instanceof Error ? error.name : "Error",
      }, ctx.correlationId);
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (read_url): Failed to read URL.`;
    }
  },
};

const browserNavigate: ToolSpec = {
  name: "browser_navigate",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "Open a URL in an interactive browser session that keeps its state between calls.",
  parameters: { url: { type: "string", description: "Absolute URL to open." } },
  required: ["url"],
  usage:
    '{"url": "https://example.com"} → opens a stateful browser session',
  available: webEnabled,
  run: async (args, ctx) => {
    const url = String(args.url);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "navigating",
      content: `${ctx.t("navigatingTo")} **${url}**`,
      isComplete: false,
    });

    const result = await api()?.browserNavigate(url);

    if (!result?.ok) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (browser_navigate): Failed - ${browserFailure(result)}`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("navigatedTo")} **${url}**`,
    });
    ctx.pushStep({
      id: ctx.newId(),
      type: "loaded",
      content: `${ctx.t("loadedPage")} **${result.title}** (${result.url})`,
      isComplete: true,
    });

    return `TOOL RESULT (browser_navigate): Opened "${result.title}" at ${result.url}. Use browser_get_elements to see interactive elements, or browser_get_text to read the page.`;
  },
};

const browserGetElements: ToolSpec = {
  name: "browser_get_elements",
  annotations: { readOnly: true, sandboxed: true },
  group: "browser",
  description:
    "List the clickable elements, links and inputs on the current browser page with their index numbers.",
  parameters: {},
  required: [],
  usage:
    "{} → indexed clickable elements, links and inputs",
  available: webEnabled,
  run: async (_args, ctx) => {
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "scanned",
      content: ctx.t("scanningPage"),
      isComplete: false,
    });

    const result = await api()?.browserGetElements();
    ctx.patchStep(stepId, {
      isComplete: true,
      content: ctx.t("foundElements").replace("{count}", `**${(result?.ok && result.elements.length) || 0}**`),
    });
    ctx.syncSteps();

    if (!result?.ok) return `TOOL RESULT (browser_get_elements): Failed: ${browserFailure(result)}`;
    if (result.elements.length === 0) {
      return `TOOL RESULT (browser_get_elements): No interactive elements found on the page.`;
    }

    const listing = result.elements
      .map(
        (element) =>
          `[${element.index}] ${element.type}: "${element.text}"${
            element.href ? ` -> ${element.href}` : ""
          }${element.value ? ` (value: "${element.value}")` : ""}`,
      )
      .join("\n");

    return `TOOL RESULT (browser_get_elements):\n${listing}`;
  },
};

/** Page text is written by whoever owns the page: fenced off as data to read, not orders to follow. */
const pageContent = (text: string) => `<page_content>\n${text}\n</page_content>`;

const browserSnapshot: ToolSpec = {
  name: "browser_snapshot",
  annotations: { readOnly: true, sandboxed: true },
  group: "browser",
  description:
    "List the controls, links, headings and inputs on the current browser page with a ref (e1, e2...) for each. Refs stay valid until the next snapshot or a navigation.",
  parameters: {
    scope: { type: "string", description: "Optional ref of a dialog or form to list only what is inside it." },
    maxItems: { type: "integer", description: "Optional cap on the number of items listed." },
  },
  required: [],
  usage: '{} → refs for everything on the page, or {"scope": "e4"} → only what is inside e4',
  available: webEnabled,
  run: async (args, ctx) => {
    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "scanned", content: ctx.t("scanningPage"), isComplete: false });

    const scope = typeof args.scope === "string" && args.scope ? args.scope : undefined;
    const maxItems = Number.isFinite(Number(args.maxItems)) && Number(args.maxItems) > 0 ? Number(args.maxItems) : undefined;
    const result = await api()?.browserSnapshot({ scope, maxItems });
    ctx.patchStep(stepId, {
      isComplete: true,
      content: ctx.t("foundElements").replace("{count}", `**${(result?.ok && result.total - result.omitted) || 0}**`),
    });
    ctx.syncSteps();

    if (!result?.ok) return `TOOL RESULT (browser_snapshot): Failed: ${browserFailure(result)}`;
    return `TOOL RESULT (browser_snapshot):\n${pageContent(result.text)}`;
  },
};

const browserScreenshot: ToolSpec = {
  name: "browser_screenshot",
  annotations: { readOnly: true, sandboxed: true },
  group: "browser",
  description:
    "Look at the current browser page as an image. Use it when the snapshot does not explain the page, such as a chart, a canvas or a layout question.",
  parameters: {
    mode: { type: "string", description: "viewport (default), full or element." },
    ref: { type: "string", description: "Ref from browser_snapshot, for mode element." },
    marks: { type: "boolean", description: "Draw each ref on the viewport image." },
  },
  required: [],
  usage: '{} → the visible part of the page, or {"mode": "element", "ref": "e3"} → one element',
  available: webEnabled,
  run: async (args, ctx) => {
    if (!ctx.vision || !ctx.attachImage) {
      return "TOOL RESULT (browser_screenshot): This model cannot look at images. Use browser_snapshot to read the page instead.";
    }
    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "reading", content: ctx.t("readingPage"), isComplete: false });

    const result = await api()?.browserScreenshot({
      mode: typeof args.mode === "string" ? (args.mode as "viewport" | "full" | "element") : undefined,
      ref: typeof args.ref === "string" ? args.ref : undefined,
      marks: args.marks === true,
    });
    ctx.patchStep(stepId, { isComplete: true, content: ctx.t("readPage") });
    ctx.syncSteps();

    if (!result?.ok) return `TOOL RESULT (browser_screenshot): Failed: ${browserFailure(result)}`;
    ctx.attachImage(result.data);
    return `TOOL RESULT (browser_screenshot): Captured ${result.width}x${result.height} of ${result.url}. The image follows this message.`;
  },
};

/** Hover, drag, scroll and coordinate clicks drive the page more freely than a ref click does, so
 * they wait for the user's say-so. */
const actionsOn = (environment: { webMode: string; browserActions?: boolean }) =>
  webEnabled(environment) && environment.browserActions === true;

const ACTIONS_OFF =
  "Failed: The extra browser actions are switched off. Use refs from browser_snapshot with browser_click, browser_type and browser_press_key, or ask the user to turn on Browser actions in Settings.";

/** What the model hears after an action: where the page is now and what changed. */
/** What the page did on its own during a step: a dialog it raised, files it saved, prompts it was refused. */
type SideEffects = {
  dialog?: { type: string; message: string };
  downloads?: { name: string; bytes: number }[];
  downloading?: number;
  permissionsRefused?: string[];
};

const sideEffects = (result: SideEffects) =>
  [
    result.dialog ? `A ${result.dialog.type} dialog is open: "${result.dialog.message}". Call browser_dialog to answer it.` : "",
    ...(result.downloads ?? []).map((d) => `Downloaded ${d.name} (${Math.max(1, Math.round(d.bytes / 1024))} KB). It was saved, not opened.`),
    result.downloading ? `${result.downloading} download(s) still running.` : "",
    result.permissionsRefused?.length ? `The page asked for ${result.permissionsRefused.join(", ")}, which was refused.` : "",
  ].filter(Boolean);

const pageAfter = (result: { title?: string; url?: string; changed?: string } & SideEffects) =>
  [result.title !== undefined ? `Page: "${result.title}" at ${result.url}.` : "", result.changed ?? "", ...sideEffects(result)]
    .filter(Boolean)
    .join(" ");

/** One browser action as a step in the transcript: running, then done or failed. */
async function browserAction<T extends { ok: boolean }>(
  ctx: ToolContext,
  label: string,
  call: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const stepId = ctx.newId();
  ctx.pushStep({ id: stepId, type: "clicking", content: `${ctx.t("browserActionRunning")} **${label}**`, isComplete: false });
  const result = await call();
  ctx.patchStep(stepId, result?.ok ? { isComplete: true, content: `${ctx.t("browserActionDone")} **${label}**` } : { isComplete: true, type: "error" });
  ctx.syncSteps();
  return result;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const number = (value: unknown) => (Number.isFinite(Number(value)) && value !== "" && value !== null && value !== undefined ? Number(value) : undefined);

/** A ref, or a point in the last screenshot, from the parameters starting with `prefix`. */
function pointArg(args: Record<string, unknown>, ref: string, x: string, y: string): string | { x: number; y: number } | undefined {
  const named = text(args[ref]);
  if (named) return named;
  const px = number(args[x]);
  const py = number(args[y]);
  return px !== undefined && py !== undefined ? { x: px, y: py } : undefined;
}

const browserClick: ToolSpec = {
  name: "browser_click",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "Click an element on the current browser page by its ref from browser_snapshot or its index from browser_get_elements. With browser actions on, you can also click a point in the last screenshot (x and y), use the right or middle button, double or triple click, and hold modifier keys.",
  parameters: {
    ref: { type: "string", description: "Ref from browser_snapshot, such as e7." },
    index: { type: "integer", description: "Index from browser_get_elements." },
    x: { type: "number", description: "Horizontal pixel in the last viewport browser_screenshot. Needs y." },
    y: { type: "number", description: "Vertical pixel in the last viewport browser_screenshot. Needs x." },
    button: { type: "string", description: "left (default), right or middle." },
    count: { type: "integer", description: "1 (default), 2 for a double click, 3 for a triple click." },
    modifiers: { type: "string", description: "Keys held during the click, comma separated: shift, control, alt, meta." },
  },
  required: [],
  usage:
    '{"ref": "e7"} → clicks that ref, {"index": 0} → clicks the element at that index, or {"x": 320, "y": 140} → clicks that point of the last screenshot',
  available: webEnabled,
  run: async (args, ctx) => {
    const ref = text(args.ref) ?? null;
    const x = number(args.x);
    const y = number(args.y);
    const modifiers = Array.isArray(args.modifiers)
      ? args.modifiers.map(String)
      : text(args.modifiers)?.split(",").map((m) => m.trim()).filter(Boolean);
    const extra = x !== undefined || y !== undefined || text(args.button) || number(args.count) !== undefined || modifiers?.length;
    if (extra && ctx.settings?.browserActions !== true) return `TOOL RESULT (browser_click): ${ACTIONS_OFF}`;

    const byPoint = x !== undefined && y !== undefined;
    const target = byPoint ? null : (ref ?? Number(args.index));
    const label = byPoint ? `(${x}, ${y})` : ref ?? `#${target}`;
    const options = extra ? { x, y, button: text(args.button), count: number(args.count), modifiers } : undefined;

    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "clicking", content: `${ctx.t("clickingElement")} **${label}**`, isComplete: false });

    const result = await (options ? api()?.browserClick(target, options) : api()?.browserClick(target as number | string));
    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("clickedElement")} ${label}${result?.ok && result.title ? ` → **${result.title}**` : ""}`,
    });
    ctx.syncSteps();

    return `TOOL RESULT (browser_click): ${result?.ok ? `Clicked. ${pageAfter(result)}` : `Failed: ${browserFailure(result)}`}`;
  },
};

const browserType: ToolSpec = {
  name: "browser_type",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "Type text into a field on the current browser page, by its ref from browser_snapshot or its index from browser_get_elements. The reply says what the field holds afterwards.",
  parameters: {
    ref: { type: "string", description: "Ref from browser_snapshot, such as e4." },
    index: { type: "integer", description: "Index from browser_get_elements." },
    text: { type: "string", description: "Text to type." },
    clear: { type: "boolean", description: "Replace what is in the field instead of adding to it." },
    submit: { type: "boolean", description: "Press Enter after typing." },
    slowly: { type: "boolean", description: "Type one character at a time, for fields that react to each key." },
  },
  required: ["text"],
  usage:
    '{"ref": "e4", "text": "hello", "clear": true, "submit": true} → replaces the field with hello and presses Enter',
  available: webEnabled,
  run: async (args, ctx) => {
    const ref = text(args.ref);
    const target = ref ?? Number(args.index);
    const typed = String(args.text ?? "");
    const snippet = `${typed.substring(0, 30)}${typed.length > 30 ? "…" : ""}`;
    const label = ref ?? `#${target}`;
    const stepId = ctx.newId();

    ctx.pushStep({ id: stepId, type: "typing", content: `${ctx.t("typingInto")} **${label}**: "${snippet}"`, isComplete: false });

    const result = await api()?.browserType(target, typed, {
      clear: args.clear === true,
      submit: args.submit === true,
      slowly: args.slowly === true,
    });
    ctx.patchStep(
      stepId,
      result?.ok
        ? { isComplete: true, content: `${ctx.t("typedInto")} **${label}**: "${snippet}"` }
        : { isComplete: true, type: "error" },
    );
    ctx.syncSteps();

    if (!result?.ok) return `TOOL RESULT (browser_type): Failed: ${browserFailure(result)}`;
    if (result.landed === false) {
      return `TOOL RESULT (browser_type): The text did not land. The field holds "${result.value ?? ""}". Click the field and try again, or check it is the right one.`;
    }
    return `TOOL RESULT (browser_type): Text entered.${result.value !== undefined ? ` The field now holds "${result.value}".` : ""}`;
  },
};

const browserPressKey: ToolSpec = {
  name: "browser_press_key",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "Press a key in the browser session: Enter, Tab, Escape, Backspace, an arrow, Home, End, PageUp, PageDown, F1 to F12, a character, or a chord such as Control+A or Shift+Tab.",
  parameters: {
    key: { type: "string", description: "Key or chord to press." },
    repeat: { type: "integer", description: "How many times, at most 20." },
  },
  required: ["key"],
  usage: '{"key": "Enter"} → presses a key, or {"key": "ArrowDown", "repeat": 3} → presses it three times',
  available: webEnabled,
  run: async (args, ctx) => {
    const key = String(args.key);
    const repeat = number(args.repeat);
    const result = await browserAction(ctx, key, async () =>
      repeat !== undefined && repeat > 1 ? api()?.browserPressKey(key, { repeat }) : api()?.browserPressKey(key),
    );
    return `TOOL RESULT (browser_press_key): ${result?.ok ? `Pressed "${key}". ${result.changed ?? ""}`.trim() : `Failed: ${browserFailure(result)}`}`;
  },
};

const browserHover: ToolSpec = {
  name: "browser_hover",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description: "Move the pointer over an element or a point, to open a menu or tooltip that appears on hover.",
  parameters: {
    ref: { type: "string", description: "Ref from browser_snapshot." },
    x: { type: "number", description: "Horizontal pixel in the last viewport browser_screenshot. Needs y." },
    y: { type: "number", description: "Vertical pixel in the last viewport browser_screenshot. Needs x." },
  },
  required: [],
  usage: '{"ref": "e3"} → hovers that ref',
  available: actionsOn,
  run: async (args, ctx) => {
    const target = pointArg(args, "ref", "x", "y");
    if (!target) return "TOOL RESULT (browser_hover): Failed: Give a ref, or x and y.";
    const result = await browserAction(ctx, typeof target === "string" ? target : `(${target.x}, ${target.y})`, async () => api()?.browserHover(target));
    return `TOOL RESULT (browser_hover): ${result?.ok ? `Hovered. ${pageAfter(result)}` : `Failed: ${browserFailure(result)}`}`;
  },
};

const browserDrag: ToolSpec = {
  name: "browser_drag",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description: "Drag from one element or point to another, for sliders, sortable lists and drop zones.",
  parameters: {
    from: { type: "string", description: "Ref to press on." },
    from_x: { type: "number", description: "Horizontal start pixel in the last screenshot. Needs from_y." },
    from_y: { type: "number", description: "Vertical start pixel in the last screenshot. Needs from_x." },
    to: { type: "string", description: "Ref to release on." },
    to_x: { type: "number", description: "Horizontal end pixel in the last screenshot. Needs to_y." },
    to_y: { type: "number", description: "Vertical end pixel in the last screenshot. Needs to_x." },
  },
  required: [],
  usage: '{"from": "e2", "to": "e8"} → drags e2 onto e8',
  available: actionsOn,
  run: async (args, ctx) => {
    const from = pointArg(args, "from", "from_x", "from_y");
    const to = pointArg(args, "to", "to_x", "to_y");
    if (!from || !to) return "TOOL RESULT (browser_drag): Failed: Give a start and an end, each a ref or an x and y pair.";
    const result = await browserAction(ctx, "drag", async () => api()?.browserDrag(from, to));
    return `TOOL RESULT (browser_drag): ${result?.ok ? `Dragged. ${pageAfter(result)}` : `Failed: ${browserFailure(result)}`}`;
  },
};

const browserScroll: ToolSpec = {
  name: "browser_scroll",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "Scroll the page. dy is pixels down (negative goes up), dx is pixels right, to jumps to the top or bottom, and ref brings an element into view. The reply gives the position and the furthest it can go.",
  parameters: {
    dy: { type: "number", description: "Pixels to scroll down. Negative scrolls up." },
    dx: { type: "number", description: "Pixels to scroll right. Negative scrolls left." },
    to: { type: "string", description: "top or bottom." },
    ref: { type: "string", description: "Ref from browser_snapshot to bring into view." },
  },
  required: [],
  usage: '{"dy": 600} → one screen down, or {"to": "bottom"} → the end of the page',
  available: actionsOn,
  run: async (args, ctx) => {
    const result = await browserAction(ctx, "scroll", async () =>
      api()?.browserScroll({ ref: text(args.ref), dx: number(args.dx), dy: number(args.dy), to: text(args.to) as "top" | "bottom" | undefined }),
    );
    return `TOOL RESULT (browser_scroll): ${
      result?.ok ? `Scrolled to ${result.scroll.y} of ${result.scroll.max} pixels.` : `Failed: ${browserFailure(result)}`
    }`;
  },
};

const browserSelectOption: ToolSpec = {
  name: "browser_select_option",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description: "Choose an option in a dropdown by its visible label or its value.",
  parameters: {
    ref: { type: "string", description: "Ref of the dropdown from browser_snapshot." },
    label: { type: "string", description: "The option's visible text." },
    value: { type: "string", description: "The option's value, if the label is not known." },
  },
  required: ["ref"],
  usage: '{"ref": "e5", "label": "Large"} → chooses Large',
  available: actionsOn,
  run: async (args, ctx) => {
    const ref = text(args.ref);
    if (!ref) return "TOOL RESULT (browser_select_option): Failed: Give the ref of the dropdown.";
    const result = await browserAction(ctx, ref, async () => api()?.browserSelectOption(ref, { label: text(args.label), value: text(args.value) }));
    return `TOOL RESULT (browser_select_option): ${
      result?.ok ? `Chose "${result.chosen}". ${result.changed ?? ""}`.trim() : `Failed: ${browserFailure(result)}`
    }`;
  },
};

const browserWait: ToolSpec = {
  name: "browser_wait",
  annotations: { readOnly: true, sandboxed: true },
  group: "browser",
  description:
    "Wait for text to appear on the page, for the address to contain something, or for a short pause. Gives up after the timeout, at most 15 seconds.",
  parameters: {
    text: { type: "string", description: "Text that should appear on the page." },
    url: { type: "string", description: "Part of the address the page should reach." },
    ms: { type: "integer", description: "A plain pause in milliseconds, at most 10000." },
    timeout_ms: { type: "integer", description: "How long to wait for text or url. Default 10000." },
  },
  required: [],
  usage: '{"text": "Order confirmed"} → waits until that text shows',
  available: actionsOn,
  run: async (args, ctx) => {
    const result = await browserAction(ctx, text(args.text) ?? text(args.url) ?? "pause", async () =>
      api()?.browserWait({ text: text(args.text), url: text(args.url), ms: number(args.ms), timeoutMs: number(args.timeout_ms) }),
    );
    return `TOOL RESULT (browser_wait): ${result?.ok ? "Done waiting." : `Failed: ${browserFailure(result)}`}`;
  },
};

const browserHistory: ToolSpec = {
  name: "browser_history",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description: "Go back or forward one page in the browser's history, or reload the current page.",
  parameters: { action: { type: "string", description: "back, forward or reload." } },
  required: ["action"],
  usage: '{"action": "back"} → the previous page',
  available: actionsOn,
  run: async (args, ctx) => {
    const action = String(args.action) as "back" | "forward" | "reload";
    const result = await browserAction(ctx, action, async () => api()?.browserHistory(action));
    return `TOOL RESULT (browser_history): ${result?.ok ? `Done. ${pageAfter(result)}` : `Failed: ${browserFailure(result)}`}`;
  },
};

const browserTabs: ToolSpec = {
  name: "browser_tabs",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "List the browser's tabs, open a new one, switch to one or close one. A link that opens a new window arrives as a new tab. After switching, call browser_snapshot: refs belong to one tab.",
  parameters: {
    action: { type: "string", description: "list, new, select or close." },
    index: { type: "integer", description: "Tab number from the list, for select and close." },
    url: { type: "string", description: "Address to open, for new." },
  },
  required: ["action"],
  usage: '{"action": "new", "url": "https://example.com"} → opens a tab, or {"action": "select", "index": 0}',
  available: actionsOn,
  run: async (args, ctx) => {
    const action = String(args.action);
    const result = await browserAction(ctx, action, async () =>
      api()?.browserTabs(action as "list" | "new" | "select" | "close", { index: number(args.index), url: text(args.url) }),
    );
    if (!result?.ok) return `TOOL RESULT (browser_tabs): Failed: ${browserFailure(result)}`;
    const lines = result.tabs.map((t) => `${t.index}${t.active ? " (open)" : ""}: "${t.title}" at ${t.url}`);
    return `TOOL RESULT (browser_tabs): ${lines.join("\n")}`;
  },
};

const traceTool = (name: "browser_console" | "browser_network", kind: "console" | "network", description: string): ToolSpec => ({
  name,
  annotations: { readOnly: true, sandboxed: true },
  group: "browser",
  description,
  parameters: {
    limit: { type: "integer", description: "How many of the latest entries to return. Default 50." },
    ...(kind === "network" ? { onlyFailed: { type: "boolean", description: "Only requests that failed or answered 400 and above." } } : {}),
  },
  required: [],
  usage: kind === "console" ? "{} → the latest console lines" : '{"onlyFailed": true} → requests that failed',
  available: webEnabled,
  run: async (args, ctx) => {
    const result = await browserAction(ctx, kind, async () =>
      api()?.browserTrace(kind, { limit: number(args.limit), onlyFailed: args.onlyFailed === true }),
    );
    if (!result?.ok) return `TOOL RESULT (${name}): Failed: ${browserFailure(result)}`;
    if (!result.entries.length) return `TOOL RESULT (${name}): Nothing recorded since the pane opened.`;
    const lines = result.entries.map((e) =>
      kind === "console"
        ? `[${e.level}] ${e.text}`
        : `${e.method} ${e.url} ${e.failed ? `failed: ${e.failed}` : (e.status ?? "pending")}`,
    );
    return `TOOL RESULT (${name}):\n${pageContent(lines.join("\n"))}`;
  },
});

const browserConsole = traceTool("browser_console", "console", "Read the latest console messages and errors the current page logged. Use it to debug a web app.");
const browserNetwork = traceTool("browser_network", "network", "Read the latest network requests the current page made, with their status. Query strings are left out.");

const browserDialog: ToolSpec = {
  name: "browser_dialog",
  annotations: { sandboxed: true, openWorld: true },
  group: "browser",
  description:
    "Answer an alert, confirm or prompt dialog the page has opened. Until it is answered the page is frozen and other browser tools fail. Accept leaves or agrees; dismiss cancels.",
  parameters: {
    action: { type: "string", description: "accept or dismiss." },
    text: { type: "string", description: "Text to type into a prompt dialog, with accept." },
  },
  required: ["action"],
  usage: '{"action": "accept"} → presses OK on the open dialog',
  available: webEnabled,
  run: async (args, ctx) => {
    const action = String(args.action) as "accept" | "dismiss";
    const result = await browserAction(ctx, action, async () => api()?.browserDialog(action, text(args.text)));
    return `TOOL RESULT (browser_dialog): ${
      result?.ok ? `Answered the ${result.answered} dialog. ${pageAfter(result)}` : `Failed: ${browserFailure(result)}`
    }`;
  },
};

const browserGetText: ToolSpec = {
  name: "browser_get_text",
  annotations: { readOnly: true, sandboxed: true },
  group: "browser",
  description: "Read the text content of the current browser page, or of one part of it.",
  parameters: {
    ref: { type: "string", description: "Optional ref from browser_snapshot to read only that element." },
    selector: { type: "string", description: "Optional CSS selector to read only the first match." },
  },
  required: [],
  usage:
    '{} → the text of the current browser page, or {"ref": "e5"} → the text of that element',
  available: webEnabled,
  run: async (args, ctx) => {
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "reading",
      content: ctx.t("readingPage"),
      isComplete: false,
    });

    const ref = typeof args.ref === "string" && args.ref ? args.ref : undefined;
    const selector = typeof args.selector === "string" && args.selector ? args.selector : undefined;
    const result = await api()?.browserGetText(ref || selector ? { ref, selector } : undefined);
    ctx.patchStep(stepId, {
      isComplete: true,
      content: result?.ok ? `${ctx.t("readPage")} **${result.title}** (${result.url})` : ctx.t("readPage"),
    });
    ctx.syncSteps();

    if (!result?.ok) return `TOOL RESULT (browser_get_text): Failed: ${browserFailure(result)}`;

    return `TOOL RESULT (browser_get_text):\nTitle: ${result.title}\nURL: ${result.url}\nContent:\n${pageContent(result.text)}`;
  },
};

const browserClose: ToolSpec = {
  name: "browser_close",
  annotations: { sandboxed: true, idempotent: true },
  group: "browser",
  description: "Close the interactive browser session.",
  parameters: {},
  required: [],
  usage:
    "{} → closes the browser session",
  available: webEnabled,
  run: async () => {
    await api()?.browserClose();
    return `TOOL RESULT (browser_close): Browser session closed.`;
  },
};

const createFile: ToolSpec = {
  name: "create_file",
  annotations: { sandboxed: true },
  group: "files",
  description: "Create a file for the user and save it to disk.",
  parameters: {
    filename: {
      type: "string",
      description:
        "File name with extension, for example report.docx or notes.md. Executable and script extensions are refused.",
    },
    content: {
      type: "string",
      description:
        "File body. Markdown or HTML for .docx, .pptx, .xlsx, and .pdf (use HTML for custom styling like colors, sizes, column widths), raw code otherwise.",
    },
  },
  required: ["filename", "content"],
  usage:
    '{"filename": "report.docx", "content": "# Title\\n\\nBody"} → writes a file the user can open',
  // Chat makes files for the user; Code writes into the project with write_file instead.
  available: (environment) => !environment.hasFolder,
  run: async (args, ctx) => {
    const filename = String(args.filename);
    const content = String(args.content);
    const existing = ctx.findStep?.((s) => s.type === "create_file" && !s.isComplete);
    const stepId = existing ? existing.id : ctx.newId();

    if (!existing) {
      ctx.pushStep({
        id: stepId,
        type: "create_file",
        content: `${ctx.t("creatingFile")} **${filename}**`,
        isComplete: false,
        filename,
        fileContent: content,
        filepath: "",
      });
    } else {
      ctx.patchStep(stepId, {
        filename,
        fileContent: content,
        content: `${ctx.t("creatingFile")} **${filename}**`,
      });
    }

    const result = await api()?.createFile(filename, content);


    if (!result?.success) {
      ctx.patchStep(stepId, {
        content: `${ctx.t("createFileFailed")} **${filename}**`,
        isComplete: true,
        type: "error",
      });
      ctx.syncSteps();
      return `TOOL RESULT (create_file): Failed to create file: ${result?.error}`;
    }

    ctx.patchStep(stepId, {
      filepath: result.filepath,
      content: `${ctx.t("createdFile")} **${filename}**`,
      isComplete: true,
    });
    ctx.syncSteps();

    return `TOOL RESULT (create_file): Saved to ${result.filepath}. Mention the file in your reply so the user knows it was created.`;
  },
};

const searchLibrary: ToolSpec = {
  name: "search_library",
  annotations: { readOnly: true, idempotent: true },
  group: "library",
  description:
    "Search the user's own indexed documents and return the most relevant passages. Use this before searching the web whenever the question could be about the user's own files, notes or projects.",
  parameters: {
    query: {
      type: "string",
      description: "What to look for, phrased as a question or a set of keywords.",
    },
    source: {
      type: "string",
      description:
        "Optional. The name of one indexed folder to search, when the user named one. Leave it out to search everything.",
    },
  },
  required: ["query"],
  usage:
    '{"query": "the deadline in the vendor contract"} → passages from the user\'s own documents',
  available: (environment) => environment.libraryReady,
  run: async (args, ctx) => {
    const query = String(args.query);
    const source = args.source ? String(args.source) : undefined;
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "library",
      content: `${ctx.t("searchingLibrary")} **${query}**`,
      isComplete: false,
    });

    const result = await api()?.library.search(query, 6, undefined, {
      source,
      workspaceId: ctx.workspaceId,
    });

    // A folder the user named that is not indexed is worth saying plainly:
    // searching everything instead would quietly answer a different question.
    if (result?.unknownSource) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (search_library): There is no indexed folder called "${source}". The folders available are: ${
        result.sources?.join(", ") || "none"
      }. Search again without the source argument, or ask the user which folder they mean.`;
    }

    if (!result?.success) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (search_library): Failed - ${result?.error || "the index is unavailable"}.`;
    }

    if (!result.results || result.results.length === 0) {
      ctx.patchStep(stepId, {
        isComplete: true,
        content: `${ctx.t("noLibraryMatches")} **${query}**`,
      });
      ctx.syncSteps();
      return `TOOL RESULT (search_library): Nothing in the user's document library matches "${query}". Say so rather than inventing an answer, and offer to search the web instead.`;
    }

    ctx.patchStep(stepId, {
      isComplete: true,
      content: `${ctx.t("libraryMatches")} **${result.results.length}**: ${query}`,
      libraryHits: result.results.map((hit) => ({
        name: hit.name,
        path: hit.path,
        score: hit.score,
      })),
    });
    ctx.syncSteps();

    const passages = result.results
      .map(
        (hit, index) =>
          `[Passage #${index + 1}] ${hit.name}${hit.heading ? `: ${hit.heading}` : ""}\n${hit.text}`,
      )
      .join("\n\n");

    return `TOOL RESULT (search_library):\n${passages}\n\nAnswer from these passages and name the file each fact came from. If they do not contain the answer, say so.`;
  },
};

const RUN_CODE_TIMEOUT_MS = 20000;

const runCode: ToolSpec = {
  name: "run_code",
  annotations: { sandboxed: true },
  group: "code",
  description:
    "Run a short Python or JavaScript program on this machine and return its output. Use it to check calculations and verify that code you wrote actually works before presenting it.",
  parameters: {
    language: { type: "string", description: 'Either "python" or "javascript".' },
    source: { type: "string", description: "The complete program to run. Print results to stdout." },
  },
  required: ["language", "source"],
  usage:
    '{"language": "python", "source": "print(2 + 2)"} → runs the program and returns its output',
  available: (environment) => environment.codeExecution,
  run: async (args, ctx) => {
    const language = String(args.language);
    const source = String(args.source);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "run_code",
      content: `${ctx.t("runningCode")} (${language})`,
      isComplete: false,
      fileContent: source,
      language,
    });

    const result = await api()?.runner.run(language, source, RUN_CODE_TIMEOUT_MS);

    if (!result) {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (run_code): The code runner is unavailable.`;
    }

    if (result.error && result.exitCode === undefined) {
      ctx.patchStep(stepId, {
        isComplete: true,
        type: "error",
        content: `${ctx.t("codeFailed")}: ${result.error}`,
      });
      ctx.syncSteps();
      return `TOOL RESULT (run_code): Could not run - ${result.error}`;
    }

    const output = [
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    ctx.patchStep(stepId, {
      isComplete: true,
      content: result.timedOut
        ? `${ctx.t("codeTimedOut")} (${language})`
        : result.success
          ? `${ctx.t("codeRan")} (${language}, ${result.durationMs} ms)`
          : `${ctx.t("codeFailed")} (${language}, exit ${result.exitCode})`,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    ctx.syncSteps();

    if (result.timedOut) {
      return `TOOL RESULT (run_code): The program was still running after ${RUN_CODE_TIMEOUT_MS / 1000} seconds and was stopped.\n\n${output}`;
    }

    return `TOOL RESULT (run_code): exit code ${result.exitCode}${
      result.truncated ? " (output truncated)" : ""
    }\n\n${output || "(the program produced no output)"}`;
  },
};

export const BUILTIN_TOOLS: ToolSpec[] = [
  searchLibrary,
  searchWeb,
  readUrl,
  browserNavigate,
  browserSnapshot,
  browserGetElements,
  browserScreenshot,
  browserClick,
  browserType,
  browserPressKey,
  browserHover,
  browserDrag,
  browserScroll,
  browserSelectOption,
  browserWait,
  browserHistory,
  browserTabs,
  browserDialog,
  browserConsole,
  browserNetwork,
  browserGetText,
  browserClose,
  createFile,
  runCode,
];

export function registerBuiltinTools(): void {
  registerTools(BUILTIN_TOOLS);
}
