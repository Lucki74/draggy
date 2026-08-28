import type { ToolContext, ToolSpec } from "./registry";
import { registerTools } from "./registry";

const api = () => window.electronAPI;

const webEnabled = (environment: { webMode: string }) => environment.webMode !== "off";

const PAGE_LINE_LIMIT = 500;

/**
 * How many searches may come back empty before searching is switched off for
 * the rest of the turn. Without this a model that gets one empty answer will
 * reword the same question indefinitely, which is both slow and useless.
 */
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
      content: `${ctx.t("searchingFor")} **${query}**...`,
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

        // A search engine that will not answer is a temporary outage, not
        // evidence that nothing exists. Saying which one it was stops the model
        // concluding the subject is unknown and inventing more queries.
        if (status === "unavailable") {
          return `TOOL RESULT (search_web): No search engine would answer just now (tried ${outcome.tried.join(", ") || "none"}). This is a temporary outage, not a sign that nothing exists on the subject.${remaining > 0 ? " Do not reword the question; if you retry at all, wait for a different question." : " Answer from your own knowledge and say which parts you could not check."}`;
        }

        return `TOOL RESULT (search_web): No results for "${query}".${remaining > 0 ? " Try one clearly different query, using fewer and more common words." : " Stop searching and answer from your own knowledge."}`;
      }

      // A hit clears the run of failures: the engines are evidently working.
      ctx.memo.set(SEARCH_FAILURES, 0);

      ctx.patchStep(stepId, { isComplete: true });
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
      return `TOOL RESULT (search_web): The search could not be run (${reason}). Answer from your own knowledge.`;
    }
  },
};

const readUrl: ToolSpec = {
  name: "read_url",
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

      const lines = page.text.split("\n").filter((line) => line.trim().length > 0);
      const shown = Math.min(lines.length, PAGE_LINE_LIMIT);

      ctx.patchStep(stepId, { isComplete: true });
      ctx.pushStep({
        id: ctx.newId(),
        type: "reading",
        content: `**${page.title}** (${url}) (${ctx.t("lines")} 0-${shown} ${ctx.t("of")} ${lines.length})`,
        isComplete: true,
      });

      return `TOOL RESULT (read_url):\nTitle: ${page.title}\nContent:\n${lines.slice(0, shown).join("\n")}`;
    } catch {
      ctx.patchStep(stepId, { isComplete: true, type: "error" });
      ctx.syncSteps();
      return `TOOL RESULT (read_url): Failed to read URL.`;
    }
  },
};

const browserNavigate: ToolSpec = {
  name: "browser_navigate",
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
      content: `Navigating to **${url}**`,
      isComplete: false,
    });

    const result = await api()?.browserNavigate(url);
    ctx.patchStep(stepId, { isComplete: true });

    if (!result?.success) {
      ctx.syncSteps();
      return `TOOL RESULT (browser_navigate): Failed - ${result?.error || "Unknown error"}`;
    }

    ctx.pushStep({
      id: ctx.newId(),
      type: "loaded",
      content: `Loaded **${result.title}** (${result.url})`,
      isComplete: true,
    });

    return `TOOL RESULT (browser_navigate): Opened "${result.title}" at ${result.url}. Use browser_get_elements to see interactive elements, or browser_get_text to read the page.`;
  },
};

const browserGetElements: ToolSpec = {
  name: "browser_get_elements",
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
      content: "Scanning page for interactive elements...",
      isComplete: false,
    });

    const result = await api()?.browserGetElements();
    ctx.patchStep(stepId, {
      isComplete: true,
      content: `Found **${result?.elements?.length || 0}** interactive elements`,
    });
    ctx.syncSteps();

    if (!result?.success || result.elements.length === 0) {
      return `TOOL RESULT (browser_get_elements): ${
        result?.error ? `Failed: ${result.error}` : "No interactive elements found on the page."
      }`;
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

const browserClick: ToolSpec = {
  name: "browser_click",
  group: "browser",
  description: "Click an element on the current browser page by its index.",
  parameters: {
    index: { type: "integer", description: "Index from browser_get_elements." },
  },
  required: ["index"],
  usage:
    '{"index": 0} → clicks the element at that index',
  available: webEnabled,
  run: async (args, ctx) => {
    const index = Number(args.index);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "clicking",
      content: `Clicking element **#${index}**...`,
      isComplete: false,
    });

    const result = await api()?.browserClick(index);
    ctx.patchStep(stepId, {
      isComplete: true,
      content: `Clicked element #${index}${result?.title ? ` -> **${result.title}**` : ""}`,
    });
    ctx.syncSteps();

    return `TOOL RESULT (browser_click): ${
      result?.success
        ? `Clicked. Page: "${result.title}" at ${result.url}`
        : `Failed: ${result?.error}`
    }`;
  },
};

const browserType: ToolSpec = {
  name: "browser_type",
  group: "browser",
  description: "Type text into an input on the current browser page by its index.",
  parameters: {
    index: { type: "integer", description: "Index from browser_get_elements." },
    text: { type: "string", description: "Text to type." },
  },
  required: ["index", "text"],
  usage:
    '{"index": 0, "text": "hello"} → types into that input',
  available: webEnabled,
  run: async (args, ctx) => {
    const index = Number(args.index);
    const text = String(args.text);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "typing",
      content: `Typing "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}" into element **#${index}**`,
      isComplete: false,
    });

    const result = await api()?.browserType(index, text);
    ctx.patchStep(stepId, { isComplete: true });
    ctx.syncSteps();

    return `TOOL RESULT (browser_type): ${
      result?.success ? "Text entered." : `Failed: ${result?.error}`
    }`;
  },
};

const browserPressKey: ToolSpec = {
  name: "browser_press_key",
  group: "browser",
  description: "Press a key in the browser session, such as Enter, Tab or Escape.",
  parameters: { key: { type: "string", description: "Key name to press." } },
  required: ["key"],
  usage:
    '{"key": "Enter"} → presses a key',
  available: webEnabled,
  run: async (args) => {
    const key = String(args.key);
    const result = await api()?.browserPressKey(key);
    return `TOOL RESULT (browser_press_key): ${
      result?.success ? `Pressed "${key}".` : `Failed: ${result?.error}`
    }`;
  },
};

const browserGetText: ToolSpec = {
  name: "browser_get_text",
  group: "browser",
  description: "Read the text content of the current browser page.",
  parameters: {},
  required: [],
  usage:
    "{} → the text of the current browser page",
  available: webEnabled,
  run: async (_args, ctx) => {
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "reading",
      content: "Reading page content...",
      isComplete: false,
    });

    const result = await api()?.browserGetText();
    ctx.patchStep(stepId, {
      isComplete: true,
      content: `Read **${result?.title}** (${result?.url})`,
    });
    ctx.syncSteps();

    if (!result?.success) return `TOOL RESULT (browser_get_text): Failed to read page.`;

    return `TOOL RESULT (browser_get_text):\nTitle: ${result.title}\nURL: ${result.url}\nContent:\n${result.text}`;
  },
};

const browserClose: ToolSpec = {
  name: "browser_close",
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
        "File body. Markdown for .docx and .pptx, CSV for .xlsx, raw code otherwise.",
    },
  },
  required: ["filename", "content"],
  usage:
    '{"filename": "report.docx", "content": "# Title\\n\\nBody"} → writes a file the user can open',
  run: async (args, ctx) => {
    const filename = String(args.filename);
    const content = String(args.content);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "create_file",
      content: `Creating **${filename}**...`,
      isComplete: false,
      filename,
      fileContent: content,
      filepath: "",
    });

    const result = await api()?.createFile(filename, content);

    if (!result?.success) {
      ctx.patchStep(stepId, {
        content: `Failed to create **${filename}**`,
        isComplete: true,
        type: "error",
      });
      ctx.syncSteps();
      return `TOOL RESULT (create_file): Failed to create file: ${result?.error}`;
    }

    ctx.patchStep(stepId, {
      filepath: result.filepath,
      content: `Created **${filename}**`,
      isComplete: true,
    });
    ctx.syncSteps();

    return `TOOL RESULT (create_file): Saved to ${result.filepath}. Mention the file in your reply so the user knows it was created.`;
  },
};

const searchLibrary: ToolSpec = {
  name: "search_library",
  group: "library",
  description:
    "Search the user's own indexed documents and return the most relevant passages. Use this before searching the web whenever the question could be about the user's own files, notes or projects.",
  parameters: {
    query: {
      type: "string",
      description: "What to look for, phrased as a question or a set of keywords.",
    },
  },
  required: ["query"],
  usage:
    '{"query": "the deadline in the vendor contract"} → passages from the user\'s own documents',
  available: (environment) => environment.libraryReady,
  run: async (args, ctx) => {
    const query = String(args.query);
    const stepId = ctx.newId();

    ctx.pushStep({
      id: stepId,
      type: "library",
      content: `${ctx.t("searchingLibrary")} **${query}**...`,
      isComplete: false,
    });

    const result = await api()?.library.search(query, 6);

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
      content: `${ctx.t("libraryMatches")} **${result.results.length}** — ${query}`,
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
          `[Passage #${index + 1}] ${hit.name}${hit.heading ? ` — ${hit.heading}` : ""}\n${hit.text}`,
      )
      .join("\n\n");

    return `TOOL RESULT (search_library):\n${passages}\n\nAnswer from these passages and name the file each fact came from. If they do not contain the answer, say so.`;
  },
};

const RUN_CODE_TIMEOUT_MS = 20000;

const runCode: ToolSpec = {
  name: "run_code",
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
        content: `${ctx.t("codeFailed")} — ${result.error}`,
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
  browserGetElements,
  browserClick,
  browserType,
  browserPressKey,
  browserGetText,
  browserClose,
  createFile,
  runCode,
];

export function registerBuiltinTools(): void {
  registerTools(BUILTIN_TOOLS);
}
